import os
import time
import sqlite3
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "iot.db"
start_time = time.time()

app = Flask(__name__, static_folder="public", static_url_path="")
CORS(app)


def get_db():
    """Return a SQLite connection stored on the Flask `g` object."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    # Usamos uma conexão direta aqui para não depender de contexto do Flask.
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_id TEXT NOT NULL,
            type TEXT,
            value REAL NOT NULL,
            timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_readings_sensor_time
            ON readings (sensor_id, timestamp);
        """
    )
    conn.commit()
    conn.close()


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "uptime": time.time() - start_time})


@app.route("/api/sensor/data", methods=["POST"])
def receive_data():
    payload = request.get_json(silent=True) or {}
    sensor_id = payload.get("sensorId")
    value = payload.get("value")
    timestamp = payload.get("timestamp")
    sensor_type = payload.get("type")

    if not sensor_id or not isinstance(value, (int, float)) or not timestamp:
        return (
            jsonify(
                {
                    "error": "sensorId, value (number) e timestamp sao obrigatorios.",
                }
            ),
            400,
        )

    db = get_db()
    db.execute(
        "INSERT INTO readings (sensor_id, type, value, timestamp) VALUES (?, ?, ?, ?)",
        (sensor_id, sensor_type, float(value), str(timestamp)),
    )
    db.commit()

    return jsonify({"message": "Leitura registrada."})


@app.route("/api/readings")
def list_readings():
    limit = min(int(request.args.get("limit", 100)), 500)
    db = get_db()
    rows = db.execute(
        """
        SELECT id, sensor_id AS sensorId, type, value, timestamp
        FROM readings
        ORDER BY datetime(timestamp) DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/readings/latest")
def latest_by_sensor():
    db = get_db()
    rows = db.execute(
        """
        SELECT r.id, r.sensor_id AS sensorId, r.type, r.value, r.timestamp
        FROM readings r
        INNER JOIN (
            SELECT sensor_id, MAX(timestamp) AS max_ts
            FROM readings
            GROUP BY sensor_id
        ) latest
        ON latest.sensor_id = r.sensor_id AND latest.max_ts = r.timestamp
        ORDER BY r.sensor_id
        """
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/stats")
def stats():
    db = get_db()
    total_readings = db.execute("SELECT COUNT(*) as count FROM readings").fetchone()["count"]
    total_sensors = (
        db.execute("SELECT COUNT(DISTINCT sensor_id) as count FROM readings").fetchone()["count"]
    )
    by_type_rows = db.execute(
        'SELECT COALESCE(type, "unknown") AS type, COUNT(*) as count FROM readings GROUP BY type'
    ).fetchall()
    by_type = [dict(r) for r in by_type_rows]
    return jsonify(
        {
            "totalReadings": total_readings,
            "totalSensors": total_sensors,
            "byType": by_type,
        }
    )


@app.route("/api/readings/<int:reading_id>")
def get_reading(reading_id):
    db = get_db()
    row = db.execute(
        """
        SELECT id, sensor_id AS sensorId, type, value, timestamp
        FROM readings
        WHERE id = ?
        """,
        (reading_id,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Leitura nao encontrada."}), 404
    return jsonify(dict(row))


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    # Serve arquivos estáticos e faz fallback para index.html para rotas desconhecidas (exceto /api/*).
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404

    full_path = BASE_DIR / "public" / path
    if path and full_path.is_file():
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


def create_app():
    init_db()
    return app


if __name__ == "__main__":
    init_db()
    start_time = time.time()
    app.run(host="0.0.0.0", port=8080, debug=False)
