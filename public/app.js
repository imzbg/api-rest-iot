const statusPill = document.getElementById('status-pill');
const statReadings = document.getElementById('stat-readings');
const statSensors = document.getElementById('stat-sensors');
const statUpdated = document.getElementById('stat-updated');
const latestBody = document.getElementById('latest-body');
const historyBody = document.getElementById('history-body');
const chartsGrid = document.getElementById('charts-grid');
const refreshBtn = document.getElementById('refresh-btn');

const chartColors = ['#2dd4bf', '#f59f00', '#4dabf7', '#e64980', '#94d82d'];

const formatTimestamp = (ts) => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('pt-BR', {
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatValue = (val) => {
  if (typeof val !== 'number') return val;
  const isInt = Number.isInteger(val);
  return isInt ? val.toString() : val.toFixed(2);
};

const setStatus = (ok, msg = '') => {
  if (ok) {
    statusPill.textContent = 'API ativa';
    statusPill.style.background = 'rgba(34,197,94,0.2)';
    statusPill.style.color = '#d1fae5';
  } else {
    statusPill.textContent = 'API offline';
    statusPill.style.background = 'rgba(220,38,38,0.25)';
    statusPill.style.color = '#fecdd3';
    if (msg) console.warn(msg);
  }
};

const fetchJSON = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Falha ao buscar ${path}: ${res.status}`);
  return res.json();
};

const renderStats = (stats, lastUpdate) => {
  statReadings.textContent = stats?.totalReadings ?? 0;
  statSensors.textContent = stats?.totalSensors ?? 0;
  statUpdated.textContent = lastUpdate ? formatTimestamp(lastUpdate) : '–';
};

const renderLatest = (rows = []) => {
  if (!rows.length) {
    latestBody.innerHTML = '<tr><td colspan="4" class="muted">Sem leituras ainda.</td></tr>';
    return;
  }

  const sorted = [...rows].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  latestBody.innerHTML = sorted
    .map(
      (r) => `
      <tr>
        <td><code>${r.sensorId}</code></td>
        <td>${r.type || '—'}</td>
        <td>${formatValue(r.value)}</td>
        <td>${formatTimestamp(r.timestamp)}</td>
      </tr>`
    )
    .join('');
};

const renderHistory = (rows = []) => {
  if (!rows.length) {
    historyBody.innerHTML = '<tr><td colspan="5" class="muted">Sem dados armazenados.</td></tr>';
    return;
  }

  const sorted = [...rows].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  historyBody.innerHTML = sorted
    .slice(0, 100)
    .map(
      (r) => `
      <tr>
        <td>${r.id}</td>
        <td><code>${r.sensorId}</code></td>
        <td>${r.type || '—'}</td>
        <td>${formatValue(r.value)}</td>
        <td>${formatTimestamp(r.timestamp)}</td>
      </tr>`
    )
    .join('');
};

const drawLineChart = (canvas, points, color) => {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth * dpr;
  const height = canvas.clientHeight * dpr;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);

  if (points.length === 0) {
    ctx.fillStyle = 'rgba(231,236,247,0.3)';
    ctx.font = `${14 * dpr}px 'Space Grotesk'`;
    ctx.fillText('Sem dados', 8 * dpr, 22 * dpr);
    return;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const xStep = width / Math.max(points.length - 1, 1);
  const padding = 12 * dpr;

  ctx.beginPath();
  points.forEach((p, idx) => {
    const x = idx * xStep;
    const y = height - padding - ((p.value - min) / span) * (height - padding * 2);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();

  ctx.fillStyle = `${color}33`;
  ctx.lineTo(width, height - padding);
  ctx.lineTo(0, height - padding);
  ctx.closePath();
  ctx.fill();
};

const renderCharts = (rows = []) => {
  if (!rows.length) {
    chartsGrid.innerHTML = '<p class="muted">Aguardando leituras...</p>';
    return;
  }

  const grouped = rows.reduce((acc, row) => {
    if (!acc[row.sensorId]) acc[row.sensorId] = [];
    acc[row.sensorId].push(row);
    return acc;
  }, {});

  const sensors = Object.keys(grouped).sort();
  chartsGrid.innerHTML = '';

  sensors.forEach((sensorId, idx) => {
    const color = chartColors[idx % chartColors.length];
    const points = grouped[sensorId]
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map((r) => ({ value: r.value, timestamp: r.timestamp }));

    const lastValue = points.at(-1)?.value ?? '—';
    const card = document.createElement('article');
    card.className = 'chart-card';
    card.innerHTML = `
      <div class="chart-header">
        <p class="chart-title"><code>${sensorId}</code></p>
        <p class="chart-meta">último: ${formatValue(lastValue)}</p>
      </div>
      <canvas></canvas>
    `;
    chartsGrid.appendChild(card);
    const canvas = card.querySelector('canvas');
    drawLineChart(canvas, points, color);
  });
};

let lastUpdate = null;
let cachedReadings = [];

const loadData = async () => {
  try {
    const [stats, latest, readings] = await Promise.all([
      fetchJSON('/api/stats'),
      fetchJSON('/api/readings/latest'),
      fetchJSON('/api/readings?limit=200'),
    ]);

    setStatus(true);
    lastUpdate = new Date();
    cachedReadings = readings;
    renderStats(stats, lastUpdate);
    renderLatest(latest);
    renderHistory(readings);
    renderCharts(readings);
  } catch (err) {
    setStatus(false, err.message);
    console.error('Falha ao carregar dados:', err);
  }
};

refreshBtn?.addEventListener('click', () => loadData());

loadData();
setInterval(loadData, 5000);
window.addEventListener('resize', () => renderCharts(cachedReadings));
