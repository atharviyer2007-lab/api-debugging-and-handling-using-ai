const API = 'http://127.0.0.1:5000';

// ─── OpenRouter Key (works on GitHub, free) ────────────────────────
// Get free key at https://openrouter.ai → API Keys
// Paste your key below (starts with sk-or-v1-...)
const OPENROUTER_KEY = 'sk-or-v1-bfc96cf9d396fe38600381cddadfb278a847eeca2bf37e78a64b29fe1ba17cd';

// ─── State ─────────────────────────────────────────────────────────
let latencyHistory  = Array.from({length:20}, () => Math.floor(Math.random()*30)+10);
let errorHistory    = Array.from({length:20}, () => parseFloat((Math.random()*0.8).toFixed(2)));
let logEntries      = [];
let incidentActive  = false;
let incidentStart   = null;
let incidentTimerId = null;
let logFilter       = 'ALL';
let currentScenario = 'deployment-regression';
let activeTab       = 'realtime';
let baselineLatency = 0;
let baselineError   = 0;
let baselineSamples = 0;

// SLA / threshold reference
const SLA_LATENCY  = 300;
const SLA_ERROR    = 5;

// ─── Theme ─────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('neuralops-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('btnTheme').textContent = saved === 'dark' ? '☀' : '◐';
  updateChartTheme();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('neuralops-theme', next);
  document.getElementById('btnTheme').textContent = next === 'dark' ? '☀' : '◐';
  updateChartTheme();
}
function getThemeColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid:    dark ? 'rgba(28,45,63,0.7)' : 'rgba(180,190,210,0.4)',
    tick:    dark ? '#3a5570' : '#8a9db0',
    tooltip: dark ? { bg:'#151f2b', border:'#263f56', title:'#7090ae', body:'#dff0ff' }
                  : { bg:'#ffffff', border:'#d4dae4', title:'#4a6070', body:'#0d1822' },
  };
}
function updateChartTheme() {
  [latencyChart, errorChart, latencyCmpChart, errorCmpChart].forEach(chart => {
    const tc = getThemeColors();
    chart.options.scales.x.grid.color  = tc.grid;
    chart.options.scales.y.grid.color  = tc.grid;
    chart.options.scales.x.ticks.color = tc.tick;
    chart.options.scales.y.ticks.color = tc.tick;
    chart.options.plugins.tooltip.backgroundColor = tc.tooltip.bg;
    chart.options.plugins.tooltip.borderColor     = tc.tooltip.border;
    chart.options.plugins.tooltip.titleColor      = tc.tooltip.title;
    chart.options.plugins.tooltip.bodyColor       = tc.tooltip.body;
    chart.update('none');
  });
}

// ─── Clock ─────────────────────────────────────────────────────────
function updateClock() {
  document.getElementById('sysClock').textContent =
    new Date().toLocaleTimeString('en-US',{hour12:false});
}
setInterval(updateClock, 1000); updateClock();

// ─── Incident Timer ────────────────────────────────────────────────
function startIncidentTimer() {
  incidentStart = Date.now();
  incidentTimerId = setInterval(() => {
    const secs = Math.floor((Date.now() - incidentStart) / 1000);
    const m = String(Math.floor(secs/60)).padStart(2,'0');
    const s = String(secs % 60).padStart(2,'0');
    document.getElementById('bannerTime').textContent = `${m}:${s}`;
  }, 1000);
}
function stopIncidentTimer() {
  clearInterval(incidentTimerId);
  incidentTimerId = null;
  incidentStart = null;
}

// ─── Chart Factory ─────────────────────────────────────────────────
function makeChartOpts() {
  const tc = getThemeColors();
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend:{display:false}, tooltip:{
      backgroundColor: tc.tooltip.bg, borderColor: tc.tooltip.border, borderWidth: 1,
      titleColor: tc.tooltip.title, bodyColor: tc.tooltip.body,
      bodyFont:{family:'IBM Plex Mono',size:11}
    }},
    scales: {
      x: { grid:{color:tc.grid,drawBorder:false}, ticks:{color:tc.tick,font:{family:'IBM Plex Mono',size:9},maxTicksLimit:8} },
      y: { grid:{color:tc.grid,drawBorder:false}, ticks:{color:tc.tick,font:{family:'IBM Plex Mono',size:9}} }
    },
    animation:{duration:220}
  };
}

const latencyChart = new Chart(document.getElementById('latencyChart').getContext('2d'), {
  type:'line',
  data:{
    labels: latencyHistory.map((_,i)=>`${i}s`),
    datasets:[{data:[...latencyHistory],borderColor:'#00dff5',backgroundColor:'rgba(0,223,245,0.04)',
      borderWidth:1.5,pointRadius:0,pointHoverRadius:3,fill:true,tension:0.35}]
  },
  options:{...makeChartOpts()}
});

const errorChart = new Chart(document.getElementById('errorChart').getContext('2d'), {
  type:'line',
  data:{
    labels: errorHistory.map((_,i)=>`${i}s`),
    datasets:[{data:[...errorHistory],borderColor:'#00e076',backgroundColor:'rgba(0,224,118,0.04)',
      borderWidth:1.5,pointRadius:0,pointHoverRadius:3,fill:true,tension:0.35}]
  },
  options:{...makeChartOpts()}
});

// Comparison charts
const latencyCmpChart = new Chart(document.getElementById('latencyCmpChart').getContext('2d'), {
  type:'line',
  data:{
    labels: latencyHistory.map((_,i)=>`${i}s`),
    datasets:[
      {label:'Latency',data:[...latencyHistory],borderColor:'#00dff5',backgroundColor:'rgba(0,223,245,0.04)',borderWidth:1.5,pointRadius:0,fill:true,tension:0.35},
      {label:'SLA',    data: Array(latencyHistory.length).fill(SLA_LATENCY), borderColor:'rgba(245,194,0,0.5)',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false}
    ]
  },
  options:{...makeChartOpts()}
});

const errorCmpChart = new Chart(document.getElementById('errorCmpChart').getContext('2d'), {
  type:'line',
  data:{
    labels: errorHistory.map((_,i)=>`${i}s`),
    datasets:[
      {label:'Error Rate',data:[...errorHistory],borderColor:'#00e076',backgroundColor:'rgba(0,224,118,0.04)',borderWidth:1.5,pointRadius:0,fill:true,tension:0.35},
      {label:'Threshold', data: Array(errorHistory.length).fill(SLA_ERROR), borderColor:'rgba(255,56,85,0.5)',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false}
    ]
  },
  options:{...makeChartOpts()}
});

function pushChart(value, history, realChart, cmpChart, refLine) {
  history.push(value);
  if(history.length > 40) history.shift();
  const labels = history.map((_,i)=>`${i}s`);
  realChart.data.labels = labels;
  realChart.data.datasets[0].data = [...history];
  realChart.update('none');

  cmpChart.data.labels = labels;
  cmpChart.data.datasets[0].data = [...history];
  cmpChart.data.datasets[1].data = Array(history.length).fill(refLine);
  cmpChart.update('none');
}

// ─── Chart Tabs ────────────────────────────────────────────────────
function switchChartTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.chart-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('tabRealtime').classList.toggle('hidden', tab !== 'realtime');
  document.getElementById('tabComparison').classList.toggle('hidden', tab !== 'comparison');
}

// ─── Scenario Picker ───────────────────────────────────────────────
const SCENARIO_META = {
  'deployment-regression': { label: '⚡ Deployment Regression', timeline: deploymentTimeline },
  'db-overload':           { label: '🗄 DB Overload',           timeline: dbOverloadTimeline },
  'memory-leak':           { label: '💾 Memory Leak',           timeline: memoryLeakTimeline },
};

function openScenario() {
  document.getElementById('scenarioModal').classList.add('open');
  document.querySelectorAll('.scenario-card').forEach(c => {
    c.classList.toggle('active', c.dataset.key === currentScenario);
  });
}
function closeScenarioDirect() { document.getElementById('scenarioModal').classList.remove('open'); }
function closeScenario(e) { if(e.target===document.getElementById('scenarioModal')) closeScenarioDirect(); }

function selectScenario(key) {
  currentScenario = key;
  document.getElementById('scenarioLabel').textContent = SCENARIO_META[key]?.label || key;
  closeScenarioDirect();
  if(incidentActive) {
    resolveIncident();
    showToast('info','↻','Scenario changed — incident resolved. Re-simulate to test new scenario.');
  } else {
    showToast('info','✓', `Scenario set: ${SCENARIO_META[key]?.label || key}`);
  }
}

// ─── Metrics Fetch ─────────────────────────────────────────────────
async function fetchMetrics() {
  try {
    const res  = await fetch(`${API}/metrics`, {signal: AbortSignal.timeout(2000)});
    const data = await res.json();
    applyMetrics(data);
  } catch(e) { simulateMetricsFallback(); }
}

function applyMetrics(data) {
  const lat = data.avg_latency;
  const err = data.error_rate;

  document.getElementById('avgLatency').textContent = `${lat}ms`;
  document.getElementById('errorRate').textContent  = `${err}%`;
  document.getElementById('uptime').textContent     = `${data.uptime}%`;
  document.getElementById('reqPerMin').textContent  = data.requests_per_min.toLocaleString();

  updateDelta('latencyDelta', lat, baselineLatency, 'ms');
  updateDelta('errorDelta',   err, baselineError,   '%');

  const count = data.active_incidents;
  const el = document.getElementById('incidentCount');
  el.textContent = count;
  el.className = 'metric-value incident-count' + (count>0?' has-incidents':'');
  document.getElementById('incidentSub').textContent = count>0 ? `${count} active` : 'no issues';
  document.getElementById('latencyTrend').textContent = lat>200 ? '↑ degraded' : '↓ stable';
  document.getElementById('errorTrend').textContent   = err>SLA_ERROR ? '↑ elevated' : '↓ normal';

  pushChart(lat, latencyHistory, latencyChart, latencyCmpChart, SLA_LATENCY);
  pushChart(err, errorHistory,   errorChart,   errorCmpChart,   SLA_ERROR);

  const bad = err > SLA_ERROR || lat > SLA_LATENCY;
  latencyChart.data.datasets[0].borderColor = bad ? '#f5c200' : '#00dff5';
  errorChart.data.datasets[0].borderColor   = bad ? '#ff3855' : '#00e076';
  latencyChart.update('none'); errorChart.update('none');

  document.getElementById('errorBadge').classList.toggle('alert', bad);
  document.getElementById('latencyBadge').classList.toggle('alert', bad);

  updateSlaBadge(lat, err);
  if(data.services) updateServiceCards(data.services);
  setSystemHealth(count>0 || bad);
}

function updateDelta(id, current, baseline, unit) {
  const el = document.getElementById(id);
  if(!baseline || baseline === 0) { el.textContent = '— baseline'; el.className = 'metric-delta'; return; }
  const diff = ((current - baseline) / baseline * 100).toFixed(1);
  const up = current > baseline;
  el.textContent = `${up?'↑':'↓'} ${Math.abs(diff)}% vs baseline`;
  el.className = 'metric-delta ' + (up ? 'up' : 'down');
}

function updateSlaBadge(lat, err) {
  const badge = document.getElementById('slaBadge');
  if(err > SLA_ERROR || lat > SLA_LATENCY) {
    badge.className = 'sla-badge crit';
    badge.textContent = 'SLA BREACH';
  } else if(err > 2 || lat > 150) {
    badge.className = 'sla-badge warn';
    badge.textContent = 'SLA WARN';
  } else {
    badge.className = 'sla-badge';
    badge.textContent = 'SLA 99.97%';
  }
}

function simulateMetricsFallback() {
  const base    = incidentActive ? { lat:[500,2200], err:[8,24] } : { lat:[10,55], err:[0.1,1.2] };
  const lat = Math.floor(base.lat[0] + Math.random()*(base.lat[1]-base.lat[0]));
  const err = parseFloat((base.err[0] + Math.random()*(base.err[1]-base.err[0])).toFixed(2));
  const rpm = Math.floor(800 + Math.random()*900);

  // Accumulate baseline during healthy mode
  if(!incidentActive) {
    baselineLatency = baselineSamples === 0 ? lat : (baselineLatency * baselineSamples + lat) / (baselineSamples+1);
    baselineError   = baselineSamples === 0 ? err : (baselineError   * baselineSamples + err) / (baselineSamples+1);
    baselineSamples = Math.min(baselineSamples+1, 20);
  }

  document.getElementById('avgLatency').textContent = `${lat}ms`;
  document.getElementById('errorRate').textContent  = `${err}%`;
  document.getElementById('uptime').textContent     = incidentActive ? '98.12%' : '99.97%';
  document.getElementById('reqPerMin').textContent  = rpm.toLocaleString();
  document.getElementById('latencyTrend').textContent = lat>200 ? '↑ degraded' : '↓ stable';
  document.getElementById('errorTrend').textContent   = err>SLA_ERROR ? '↑ elevated' : '↓ normal';

  updateDelta('latencyDelta', lat, baselineLatency, 'ms');
  updateDelta('errorDelta',   err, baselineError,   '%');
  updateSlaBadge(lat, err);

  pushChart(lat, latencyHistory, latencyChart, latencyCmpChart, SLA_LATENCY);
  pushChart(err, errorHistory,   errorChart,   errorCmpChart,   SLA_ERROR);

  const bad = err > SLA_ERROR;
  latencyChart.data.datasets[0].borderColor = bad ? '#f5c200' : '#00dff5';
  errorChart.data.datasets[0].borderColor   = bad ? '#ff3855' : '#00e076';
  latencyChart.update('none'); errorChart.update('none');
  document.getElementById('errorBadge').classList.toggle('alert', bad);
  document.getElementById('latencyBadge').classList.toggle('alert', bad);

  const count = incidentActive ? 1 : 0;
  const el = document.getElementById('incidentCount');
  el.textContent = count;
  el.className = 'metric-value incident-count' + (count>0?' has-incidents':'');
  document.getElementById('incidentSub').textContent = count>0 ? '1 active' : 'no issues';

  if(incidentActive) {
    const scenarioServices = {
      'deployment-regression': {
        auth:{status:'ok',latency:14}, payments:{status:'critical',latency:1100+Math.floor(Math.random()*400)},
        db:{status:'critical',latency:900+Math.floor(Math.random()*300)}, cdn:{status:'ok',latency:5},
        gateway:{status:'warning',latency:260+Math.floor(Math.random()*120)},
      },
      'db-overload': {
        auth:{status:'critical',latency:600+Math.floor(Math.random()*200)}, payments:{status:'critical',latency:800+Math.floor(Math.random()*300)},
        db:{status:'critical',latency:1400+Math.floor(Math.random()*400)}, cdn:{status:'ok',latency:5},
        gateway:{status:'warning',latency:220+Math.floor(Math.random()*80)},
      },
      'memory-leak': {
        auth:{status:'critical',latency:500+Math.floor(Math.random()*200)}, payments:{status:'ok',latency:36},
        db:{status:'ok',latency:9}, cdn:{status:'ok',latency:5},
        gateway:{status:'ok',latency:22},
      },
    };
    updateServiceCards(scenarioServices[currentScenario] || scenarioServices['deployment-regression']);
  } else {
    updateServiceCards({
      auth:    {status:'ok',latency:12+Math.floor(Math.random()*6)},
      payments:{status:'ok',latency:34+Math.floor(Math.random()*10)},
      db:      {status:'ok',latency:8+Math.floor(Math.random()*4)},
      cdn:     {status:'ok',latency:5+Math.floor(Math.random()*2)},
      gateway: {status:'ok',latency:21+Math.floor(Math.random()*8)},
    });
  }
  setSystemHealth(incidentActive);
}

function updateServiceCards(services) {
  const maxLatency = 2000;
  if(!services) return;
  Object.entries(services).forEach(([name, info]) => {
    const card = document.getElementById(`card-${name}`);
    const dot  = document.getElementById(`dot-${name}`);
    const val  = document.getElementById(`val-${name}`);
    const lat  = document.getElementById(`lat-${name}`);
    const bar  = document.getElementById(`bar-${name}`);
    if(!card) return;
    card.className = 'status-card ' + info.status;
    dot.className  = 'card-dot '   + info.status;
    val.className  = 'card-value ' + info.status;
    val.textContent = info.status==='critical' ? 'Critical' : info.status==='warning' ? 'Degraded' : 'Healthy';
    if(lat) lat.textContent = `${info.latency}ms`;
    if(bar) bar.style.width = Math.min(100, (info.latency / maxLatency * 100)).toFixed(1) + '%';
  });
}

function setSystemHealth(bad) {
  const dot   = document.getElementById('pulseStatus');
  const label = document.getElementById('systemLabel');
  const banner = document.getElementById('incidentBanner');
  if(bad) {
    dot.className   = 'pulse-dot danger';
    label.className = 'sys-label danger';
    label.textContent = 'INCIDENT DETECTED';
  } else {
    dot.className   = 'pulse-dot';
    label.className = 'sys-label';
    label.textContent = 'SYSTEM HEALTHY';
    banner.classList.remove('show');
  }
}

// ─── Logs ──────────────────────────────────────────────────────────
const LOG_POOL = [
  {level:'INFO',  msg:'GET /api/v2/users 200 OK — 14ms'},
  {level:'INFO',  msg:'POST /api/v2/auth/token 200 OK — 11ms'},
  {level:'DEBUG', msg:'DB query: SELECT * FROM sessions — 8ms'},
  {level:'INFO',  msg:'GET /api/v2/payments/status 200 OK — 32ms'},
  {level:'INFO',  msg:'CDN cache HIT — edge node fra01'},
  {level:'DEBUG', msg:'Redis cache: HIT ratio 94.2%'},
  {level:'INFO',  msg:'GET /api/v2/products?page=1 200 OK — 19ms'},
  {level:'WARN',  msg:'Response time threshold exceeded: /api/v2/products (450ms)'},
  {level:'DEBUG', msg:'JWT token validated — sub: user#84201'},
  {level:'INFO',  msg:'Kafka consumer lag: 0 — partitions caught up'},
];

const INCIDENT_LOGS = {
  'deployment-regression': [
    {level:'CRITICAL',msg:'ALERT: error rate spike — 18.4% (threshold: 5%)'},
    {level:'ERROR',   msg:'DB replication lag: 8.4s on db-replica-02'},
    {level:'ERROR',   msg:'payments-api: NullPointerException at PaymentProcessor.java:342'},
    {level:'WARN',    msg:'Auto-scaling triggered: 3 → 8 pods (payments-api)'},
    {level:'ERROR',   msg:'Circuit breaker OPEN — payments-api (failure rate 62%)'},
    {level:'CRITICAL',msg:'INCIDENT-001: payments degraded — ~14% user impact'},
    {level:'ERROR',   msg:'Connection pool exhausted: postgresql://db-primary:5432'},
    {level:'ERROR',   msg:'503 Service Unavailable — payments-api crash-looping'},
  ],
  'db-overload': [
    {level:'CRITICAL',msg:'ALERT: db-primary CPU 98% — slow query storm'},
    {level:'ERROR',   msg:'Long-running query: SELECT * FROM transactions JOIN users — 14s'},
    {level:'ERROR',   msg:'DB connection wait timeout: 30s on db-primary'},
    {level:'WARN',    msg:'Query queue depth: 2,847 pending on db-primary'},
    {level:'ERROR',   msg:'Cascade: auth-service DB lookup failures — 503 errors'},
    {level:'CRITICAL',msg:'INCIDENT-002: database overload — all services degraded'},
    {level:'ERROR',   msg:'Missing index on transactions.user_id — full table scan'},
  ],
  'memory-leak': [
    {level:'WARN',    msg:'auth-service pod-2: heap usage 81% (threshold: 75%)'},
    {level:'WARN',    msg:'GC pause: 1.4s on auth-service pod-2 (G1GC)'},
    {level:'ERROR',   msg:'auth-service pod-2: heap usage 94% — OOM imminent'},
    {level:'ERROR',   msg:'auth-service pod-2 restarted — OutOfMemoryError'},
    {level:'WARN',    msg:'auth-service pod-3 exhibiting same heap growth'},
    {level:'CRITICAL',msg:'INCIDENT-003: auth-service memory leak — rolling restarts'},
    {level:'ERROR',   msg:'Token validation latency: 740ms (normal: 12ms)'},
  ],
};

async function fetchLogs() {
  try {
    const res  = await fetch(`${API}/logs?count=25`, {signal: AbortSignal.timeout(2000)});
    const data = await res.json();
    logEntries = data.logs || [];
    renderLogs();
  } catch(e) { renderFallbackLogs(); }
}

function renderFallbackLogs() {
  const pool = incidentActive ? (INCIDENT_LOGS[currentScenario] || []) : LOG_POOL;
  const n = incidentActive ? 6 : 4;
  const now = new Date();
  for(let i=0; i<n; i++) {
    const entry = pool[Math.floor(Math.random()*pool.length)];
    const ts = new Date(now.getTime() - Math.random()*15000);
    logEntries.unshift({
      timestamp: ts.toLocaleTimeString('en-US',{hour12:false}),
      level:     entry.level,
      message:   entry.msg,
    });
  }
  if(logEntries.length > 80) logEntries.splice(80);
  renderLogs();
}

function setLogFilter(f) {
  logFilter = f;
  document.querySelectorAll('.log-filter-btn').forEach(b => {
    b.className = 'log-filter-btn ' + b.textContent.split('/')[0].trim().toLowerCase().replace(/ \/ crit/,'');
    if(b.textContent.includes(f) || (f==='ALL'&&b.textContent==='ALL')) {
      b.className += ' active-' + f.toLowerCase();
    }
  });
  renderLogs();
}

function renderLogs() {
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let filtered = logEntries;
  if(logFilter !== 'ALL') {
    filtered = filtered.filter(l =>
      l.level.startsWith(logFilter) || (logFilter==='ERROR' && l.level==='CRITICAL')
    );
  }
  if(search) filtered = filtered.filter(l => l.message.toLowerCase().includes(search) || l.level.toLowerCase().includes(search));

  document.getElementById('logCount').textContent = `${filtered.length} entries`;
  if(filtered.length === 0) {
    document.getElementById('logsBody').innerHTML = '<div class="log-placeholder">No entries match filter.</div>';
    return;
  }
  document.getElementById('logsBody').innerHTML = filtered.slice(0, 60).map(l => {
    const lvl = l.level.toUpperCase();
    const msgCls = lvl==='CRITICAL' ? 'critical' : lvl==='ERROR' ? 'error' : lvl==='WARN' ? 'warn' : '';
    return `<div class="log-row">
      <span class="log-ts">${l.timestamp}</span>
      <span class="log-level ${lvl}">${lvl}</span>
      <span class="log-msg ${msgCls}" title="${l.message}">${l.message}</span>
    </div>`;
  }).join('');
}

// ─── Deployments ───────────────────────────────────────────────────
async function fetchDeployments() {
  try {
    const res  = await fetch(`${API}/deployments`, {signal: AbortSignal.timeout(2000)});
    const data = await res.json();
    renderDeployments(data.deployments || []);
  } catch(_) {
    renderDeployments([
      {service:'payments-api', version:'v2.14.1', status:'success', time:'18 min ago', author:'ci-bot',   commit:'a3f92d1', env:'production'},
      {service:'auth-service', version:'v4.3.0',  status:'success', time:'2 hrs ago',  author:'priya.k',  commit:'b7c10e4', env:'production'},
      {service:'user-service', version:'v1.9.8',  status:'running', time:'just now',   author:'alex.m',   commit:'d92aa31', env:'staging'},
      {service:'api-gateway',  version:'v3.0.5',  status:'fail',    time:'47 min ago', author:'ci-bot',   commit:'f11bc99', env:'production'},
      {service:'cdn-edge',     version:'v6.1.0',  status:'success', time:'5 hrs ago',  author:'ops-team', commit:'c44de02', env:'production'},
    ]);
  }
}

function renderDeployments(deployments) {
  document.getElementById('deployCount').textContent = `${deployments.length} recent`;
  document.getElementById('deploymentsBody').innerHTML = deployments.map(d => {
    const flagged = incidentActive && (d.service.includes('payments') || (currentScenario==='db-overload'&&d.service.includes('api-gateway')));
    return `<div class="deploy-item ${flagged?'flagged':''}">
      <div class="deploy-status-dot ${d.status}"></div>
      <div class="deploy-info">
        <div>
          <span class="deploy-service">${d.service}</span>
          <span class="deploy-version">${d.version}</span>
          <span class="deploy-env ${d.env||''}">${d.env||'prod'}</span>
          <span class="deploy-badge ${d.status}">${d.status.toUpperCase()}</span>
        </div>
        <div class="deploy-meta">by ${d.author} · ${d.commit}</div>
      </div>
      <span class="deploy-time">${d.time}</span>
    </div>`;
  }).join('');
}

// ─── Simulate Failure ──────────────────────────────────────────────
async function simulateFailure() {
  if(incidentActive) return;
  incidentActive = true;

  try {
    await fetch(`${API}/simulate-failure`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({scenario: currentScenario}),
      signal: AbortSignal.timeout(2000)
    });
  } catch(_) {}

  const meta = SCENARIO_META[currentScenario];
  document.getElementById('btnSimulate').style.display = 'none';
  document.getElementById('btnResolve').classList.add('show');
  document.getElementById('incidentBanner').classList.add('show');
  document.getElementById('bannerText').textContent = `INCIDENT ACTIVE · ${meta?.label || currentScenario}`;
  document.getElementById('bannerId').textContent = `#INC-${Math.floor(Math.random()*900+100)}`;
  startIncidentTimer();

  const tlFn = SCENARIO_META[currentScenario]?.timeline;
  if(typeof tlFn === 'function') { (tlFn)(); } else { deploymentTimeline(); }

  fetchDeployments();
  showToast('error','🔴',`Failure injected: ${meta?.label || currentScenario}`);
}

// ─── Resolve Incident ──────────────────────────────────────────────
async function resolveIncident() {
  if(!incidentActive) return;
  incidentActive = false;
  stopIncidentTimer();

  try {
    await fetch(`${API}/resolve`, {method:'POST', signal: AbortSignal.timeout(2000)});
  } catch(_) {}

  document.getElementById('btnSimulate').style.display = '';
  document.getElementById('btnResolve').classList.remove('show');
  document.getElementById('incidentBanner').classList.remove('show');
  document.getElementById('aiSteps').className = 'ai-thinking-steps';
  document.getElementById('aiBody').innerHTML = `<div class="ai-idle"><div class="ai-idle-icon">◎</div><div class="ai-idle-text">Incident resolved. System restored to healthy state.</div></div>`;
  document.getElementById('timelineBody').innerHTML = `<div class="timeline-empty">Incident resolved — system healthy.</div>`;
  document.getElementById('timelineStatus').textContent = 'Nominal';
  document.getElementById('timelineStatus').className = 'timeline-status';
  document.getElementById('incidentCount').className = 'metric-value incident-count';
  document.getElementById('incidentSub').textContent = 'no issues';
  setSystemHealth(false);
  updateServiceCards({
    auth:{status:'ok',latency:12}, payments:{status:'ok',latency:34},
    db:{status:'ok',latency:8},   cdn:{status:'ok',latency:5}, gateway:{status:'ok',latency:21},
  });
  fetchDeployments();
  showToast('success','✓','Incident resolved — all services restored');
}

// ─── Timelines ─────────────────────────────────────────────────────
function renderTimeline(steps, label) {
  const now = new Date();
  const fmt = s => new Date(now - s*1000).toLocaleTimeString('en-US',{hour12:false});
  document.getElementById('timelineStatus').textContent = '⚠ ACTIVE';
  document.getElementById('timelineStatus').className = 'timeline-status alert';
  document.getElementById('timelineBody').innerHTML = steps.map((s,i)=>`
    <div class="timeline-step">
      <div class="step-dot-wrap">
        <div class="step-dot ${s.type}"></div>
        ${i<steps.length-1?'<div class="step-line"></div>':''}
      </div>
      <div class="step-content">
        <div class="step-time">${fmt(s.ago)}</div>
        <div class="step-title">${s.title}</div>
        <div class="step-desc">${s.desc}</div>
      </div>
    </div>
  `).join('');
}

function deploymentTimeline() {
  renderTimeline([
    {type:'ok',  ago:320, title:'Deployment Triggered',    desc:'payments-api v2.14.1 deployed by ci-bot · commit a3f92d1'},
    {type:'warn',ago:260, title:'Latency Spike Detected',  desc:'P95 latency jumped to 1,200ms — SLA: 300ms'},
    {type:'warn',ago:200, title:'DB Replication Lag',      desc:'Replica lag: 8.4s — write queue backing up on db-primary'},
    {type:'error',ago:150,title:'Payment Failures Begin',  desc:'503 errors on /api/v2/payments — error rate 18.4%'},
    {type:'error',ago:100,title:'Circuit Breaker Tripped', desc:'Circuit breaker OPEN on payments-api — downstream cascade'},
    {type:'error',ago:30, title:'INCIDENT-001 Declared',   desc:'Auto-alert fired: P1 — payments degraded · ~14% user impact'},
  ]);
}

function dbOverloadTimeline() {
  renderTimeline([
    {type:'ok',  ago:400, title:'Traffic Ramp-up',         desc:'RPM rose to 1,800 — within normal parameters'},
    {type:'warn',ago:320, title:'Slow Query Detected',     desc:'SELECT * FROM transactions JOIN users — 14s duration'},
    {type:'warn',ago:240, title:'CPU Spike on db-primary', desc:'CPU: 98% — write queue depth 2,847 pending queries'},
    {type:'error',ago:160,title:'Connection Timeouts',     desc:'auth-service and payments-api failing DB lookups'},
    {type:'error',ago:80, title:'Cascade Failures',        desc:'All DB-dependent services returning 503'},
    {type:'error',ago:20, title:'INCIDENT-002 Declared',   desc:'P1 alert: database overload — full service degradation'},
  ]);
}

function memoryLeakTimeline() {
  renderTimeline([
    {type:'ok',  ago:14400,title:'auth-service v4.3.0 Deployed', desc:'Deployed 4h ago by priya.k · commit b7c10e4'},
    {type:'warn',ago:3600, title:'Heap Growth Anomaly',          desc:'auth-service pod-2: heap growing 200MB/hr (normal: stable)'},
    {type:'warn',ago:1200, title:'GC Pause Alerts',              desc:'G1GC pause: 1.4s — token validation latency rising'},
    {type:'error',ago:600, title:'OOM on pod-2',                 desc:'pod-2: OutOfMemoryError — pod restarted'},
    {type:'error',ago:180, title:'pod-3 Affected',               desc:'pod-3 heap at 88% — same growth pattern observed'},
    {type:'error',ago:30,  title:'INCIDENT-003 Declared',        desc:'CrashLoopBackOff: 2/4 auth pods down — auth failures ~18%'},
  ]);
}

// ─── Analyze ───────────────────────────────────────────────────────
async function analyzeIncident() {
  const aiBody  = document.getElementById('aiBody');
  const aiSteps = document.getElementById('aiSteps');
  const tools   = ['get_logs()','get_metrics()','get_deployments()','detect_anomaly()','analyze_incident()'];

  aiSteps.className = 'ai-thinking-steps show';
  aiSteps.innerHTML = tools.map((t,i)=>`<span class="think-step" id="ts${i}">○ ${t}</span>`).join('');
  aiBody.innerHTML = `<div class="ai-loading"><div class="spinner"></div><span>NeuralOps agent running diagnostics...</span></div>`;

  tools.forEach((_,i) => {
    setTimeout(()=>{
      document.querySelectorAll('.think-step').forEach((el,j) => {
        if(j<i)   el.className='think-step done';
        if(j===i) el.className='think-step active';
      });
    }, i * 360);
  });

  let data;
  try {
    const res = await fetch(`${API}/analyze`, {method:'POST', signal: AbortSignal.timeout(5000)});
    data = await res.json();
  } catch(_) { data = getFallbackAnalysis(); }

  setTimeout(()=>{
    document.querySelectorAll('.think-step').forEach(el=>el.className='think-step done');
    renderAIAnalysis(data);
  }, 2000);
}

function getFallbackAnalysis() {
  const scenarioAnalyses = {
    'deployment-regression': {
      root_cause:       'Faulty HikariCP connection pool config in payments-api v2.14.1 (commit a3f92d1)',
      affected_service: 'payments-api, db-primary',
      severity:         'CRITICAL',
      confidence:       '94%',
      scenario:         'deployment-regression',
      explanation:      'payments-api v2.14.1 introduced maxPoolSize: 2 (should be 20). Under ~1,400 req/min, connections exhausted in 4 minutes. DB replica lag reached 8.4s, triggering circuit breaker. Result: 18.4% error rate, 1,420ms avg latency (SLA: 300ms).',
      suggested_fix:    '1. IMMEDIATE: kubectl rollout undo deploy/payments-api\n2. Patch HikariCP: maxPoolSize=20, connectionTimeout=30000\n3. Monitor DB replica lag — normalises ~2–3 min post-rollback\n4. Reset circuit breaker after stability confirmed\n5. Retest in staging before re-deploying hotfix',
    },
    'db-overload': {
      root_cause:       'Missing index on transactions.user_id — full table scans under load',
      affected_service: 'db-primary, auth-service, payments-api',
      severity:         'HIGH',
      confidence:       '91%',
      scenario:         'db-overload',
      explanation:      'Missing composite index on transactions(user_id, created_at) forces sequential scans. At 1,800 req/min, db-primary CPU hit 98% with 2,847 queries queued. Cascaded to auth and payments with 503 errors.',
      suggested_fix:    '1. IMMEDIATE: Promote db-replica-01 to reduce read pressure\n2. CREATE INDEX CONCURRENTLY idx_tx_user ON transactions(user_id, created_at);\n3. Kill long-running queries: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE duration > \'30s\'::interval;\n4. After index: CPU should drop to <30% within 5 min\n5. Add: log_min_duration_statement = 1000',
    },
    'memory-leak': {
      root_cause:       'Unbounded JWT session cache in auth-service v4.3.0 — no TTL eviction',
      affected_service: 'auth-service',
      severity:         'HIGH',
      confidence:       '88%',
      scenario:         'memory-leak',
      explanation:      'auth-service v4.3.0 added an in-memory JWT cache with no eviction policy. Heap grows ~200MB/hr. After 4h GC pauses exceed 1s causing auth latency spikes (740ms). 2/4 pods now in CrashLoopBackOff.',
      suggested_fix:    '1. IMMEDIATE: kubectl rollout restart deploy/auth-service\n2. Rollback: kubectl set image deploy/auth-service auth=auth-service:v4.2.9\n3. Hotfix: cache.setExpireAfterWrite(30, TimeUnit.MINUTES)\n4. JVM flags: -XX:+UseG1GC -Xmx512m -XX:+HeapDumpOnOutOfMemoryError\n5. Alert on heap >70%',
    },
  };
  if(incidentActive) return scenarioAnalyses[currentScenario] || scenarioAnalyses['deployment-regression'];
  return {
    root_cause:       'No anomaly detected — system operating normally',
    affected_service: 'None',
    severity:         'OK',
    confidence:       '99%',
    scenario:         'healthy',
    explanation:      'All services within normal parameters. Error rate 0.4% (<5% threshold), latency stable at ~18ms (<300ms SLA). No deployment anomalies in last 2 hours.',
    suggested_fix:    'No action required. Consider alerting if RPM exceeds 2,000 sustained.',
  };
}

function renderAIAnalysis(data) {
  const sevColor = {CRITICAL:'critical',HIGH:'high',WARNING:'warning',OK:'ok'};
  const sev = data.severity || 'OK';
  document.getElementById('aiBody').innerHTML = `
    <div class="ai-result-grid">
      <div class="ai-result-card">
        <div class="ai-result-label">Severity</div>
        <div class="ai-result-value ${sevColor[sev]||'ok'}">${sev}</div>
      </div>
      <div class="ai-result-card">
        <div class="ai-result-label">Affected</div>
        <div class="ai-result-value" style="font-size:11px">${data.affected_service}</div>
      </div>
      <div class="ai-result-card">
        <div class="ai-result-label">Confidence</div>
        <div class="ai-result-value" style="color:var(--cyan)">${data.confidence||'—'}</div>
      </div>
      <div class="ai-result-card">
        <div class="ai-result-label">Scenario</div>
        <div class="ai-result-value" style="font-size:10px;color:var(--text-secondary)">${data.scenario||'—'}</div>
      </div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">Root Cause</div>
      <div class="ai-text">${data.root_cause}</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">Technical Explanation</div>
      <div class="ai-text">${data.explanation}</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">Suggested Remediation</div>
      <div class="ai-fix">${(data.suggested_fix||'').replace(/\n/g,'<br>')}</div>
    </div>
    <div class="ai-tools-used">
      ${(data.tools_used||['get_logs()','get_metrics()','get_deployments()','detect_anomaly()','analyze_incident()']).map(t=>`<span class="tool-chip">${t}</span>`).join('')}
    </div>
  `;
}

// ─── Modals ─────────────────────────────────────────────────────────
function openHelp()       { document.getElementById('helpModal').classList.add('open'); }
function closeHelpDirect(){ document.getElementById('helpModal').classList.remove('open'); }
function closeHelp(e)     { if(e.target===document.getElementById('helpModal')) closeHelpDirect(); }

// ─── Toast ─────────────────────────────────────────────────────────
function showToast(type, icon, msg) {
  const tc = document.getElementById('toastContainer');
  const t  = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
  tc.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity 0.4s'; setTimeout(()=>t.remove(),400); }, 4200);
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key==='Escape')             { closeHelpDirect(); closeScenarioDirect(); }
  if(e.key==='h'||e.key==='H')    openHelp();
  if(e.key==='s'||e.key==='S')    simulateFailure();
  if(e.key==='a'||e.key==='A')    analyzeIncident();
  if(e.key==='r'||e.key==='R')    resolveIncident();
  if(e.key==='t'||e.key==='T')    toggleTheme();
  if(e.key==='Tab') { e.preventDefault(); switchChartTab(activeTab==='realtime'?'comparison':'realtime'); }
  if(e.key==='1')   setLogFilter('INFO');
  if(e.key==='2')   setLogFilter('WARN');
  if(e.key==='3')   setLogFilter('ERROR');
});

// ─── Init ──────────────────────────────────────────────────────────
async function init() {
  initTheme();
  // Set default scenario label
  document.getElementById('scenarioLabel').textContent =
    SCENARIO_META[currentScenario]?.label || currentScenario;

  await fetchMetrics();
  await fetchLogs();
  await fetchDeployments();
  showToast('info','⬡','NeuralOps v2.0 — running in demo mode (backend optional)');

  setInterval(fetchMetrics, 4000);
  setInterval(renderFallbackLogs, 2500);
  setInterval(fetchLogs, 7000);
}

init();
// ─── AI CHAT ───────────────────────────────────────────────────────
let chatHistory = [];
let chatBusy = false;
let lastAnalysis = null;

// Intercept renderAIAnalysis to capture analysis for chat context
const _origRender = renderAIAnalysis;
renderAIAnalysis = function(data) {
  lastAnalysis = data;
  _origRender(data);
};

function getCurrentContext() {
  const lat = document.getElementById('avgLatency')?.textContent || '—';
  const err = document.getElementById('errorRate')?.textContent || '—';
  const rpm = document.getElementById('reqPerMin')?.textContent || '—';
  const uptime = document.getElementById('uptime')?.textContent || '—';

  let ctx = `You are an expert SRE/DevOps AI assistant embedded in NeuralOps, an API failure detection platform.\n\n`;
  ctx += `## Current System State\n`;
  ctx += `- Incident Active: ${incidentActive ? 'YES' : 'NO'}\n`;
  if (incidentActive) {
    const meta = SCENARIO_META[currentScenario];
    ctx += `- Active Scenario: ${meta?.label || currentScenario}\n`;
  }
  ctx += `- Avg Latency: ${lat} (SLA: 300ms)\n`;
  ctx += `- Error Rate: ${err} (Threshold: 5%)\n`;
  ctx += `- Requests/min: ${rpm}\n`;
  ctx += `- Uptime: ${uptime}\n\n`;

  if (lastAnalysis) {
    ctx += `## Latest AI Analysis\n`;
    ctx += `- Root Cause: ${lastAnalysis.root_cause}\n`;
    ctx += `- Severity: ${lastAnalysis.severity}\n`;
    ctx += `- Affected Services: ${lastAnalysis.affected_service}\n`;
    ctx += `- Confidence: ${lastAnalysis.confidence}\n`;
    ctx += `- Explanation: ${lastAnalysis.explanation}\n`;
    ctx += `- Suggested Fix:\n${lastAnalysis.suggested_fix}\n\n`;
  } else {
    ctx += `## Analysis: Not yet run. User has not clicked Analyze yet.\n\n`;
  }

  // Grab recent logs from logEntries
  const recent = logEntries.slice(0, 8);
  if (recent.length > 0) {
    ctx += `## Recent Log Entries\n`;
    recent.forEach(l => { ctx += `[${l.timestamp}] ${l.level}: ${l.message}\n`; });
    ctx += '\n';
  }

  ctx += `## Instructions\n`;
  ctx += `- Answer concisely and accurately. Use markdown formatting.\n`;
  ctx += `- For commands, use code blocks.\n`;
  ctx += `- Be direct and actionable. This is a live ops environment.\n`;
  ctx += `- If asked to explain simply, avoid jargon.\n`;
  ctx += `- Always relate your answer to the current incident state above.\n`;
  return ctx;
}

function setChatBusy(busy) {
  chatBusy = busy;
  const dot = document.getElementById('chatStatusDot');
  const label = document.getElementById('chatStatusLabel');
  const btn = document.getElementById('chatSendBtn');
  if (busy) {
    dot?.classList.add('busy');
    if (label) label.textContent = 'Thinking...';
    if (btn) btn.disabled = true;
  } else {
    dot?.classList.remove('busy');
    if (label) label.textContent = 'Ready';
    if (btn) btn.disabled = false;
  }
}

function appendMsg(role, content, isTyping = false) {
  const box = document.getElementById('chatMessages');
  if (!box) return null;

  // Remove welcome if present
  const welcome = box.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? 'U' : '⬡';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (isTyping) {
    bubble.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  } else {
    bubble.innerHTML = formatMsg(content);
    const ts = document.createElement('span');
    ts.className = 'msg-time';
    ts.textContent = new Date().toLocaleTimeString('en-US', {hour12: false});
    bubble.appendChild(ts);
  }

  div.appendChild(avatar);
  div.appendChild(bubble);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function formatMsg(text) {
  // Basic markdown: code blocks, inline code, bold, numbered lists
  let h = text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${code.replace(/</g,'&lt;').replace(/>/g,'&gt;').trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^(\d+\.\s)/gm, '<br>$1')
    .replace(/^(#+\s)(.+)$/gm, (_, prefix, title) => {
      const level = prefix.trim().length;
      return `<strong style="color:var(--cyan);font-size:${level===1?'14px':'12px'}">${title}</strong>`;
    })
    .replace(/\n/g, '<br>');
  return h;
}

async function sendChat() {
  if (chatBusy) return;
  const input = document.getElementById('chatInput');
  const text = input?.value.trim();
  if (!text) return;

  input.value = '';
  autoResize(input);

  appendMsg('user', text);
  chatHistory.push({ role: 'user', content: text });

  setChatBusy(true);
  const typingEl = appendMsg('ai', '', true);

  try {
    const systemPrompt = getCurrentContext();

    const usingOpenRouter = OPENROUTER_KEY && OPENROUTER_KEY !== 'PASTE_YOUR_OPENROUTER_KEY_HERE';

    let reply;

    if (usingOpenRouter) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': window.location.href,
          'X-Title': 'NeuralOps'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          max_tokens: 1000,
          messages: [
            { role: 'system', content: systemPrompt },
            ...chatHistory.slice(-10, -1)
          ]
        }),
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
      reply = data.choices?.[0]?.message?.content || 'No response received.';

    } else {
      // Fallback: try local Flask backend
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          system: systemPrompt,
          history: chatHistory.slice(-10, -1)
        }),
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      reply = data.reply || 'No response received.';
    }

    chatHistory.push({ role: 'assistant', content: reply });
    if (typingEl) typingEl.remove();
    appendMsg('ai', reply);

  } catch (e) {
    if (typingEl) typingEl.remove();
    appendMsg('ai',
      `**Setup needed — choose one option:**\n\n` +
      `**Option 1 — Works on GitHub (free):**\n` +
      `Get a free key at [openrouter.ai](https://openrouter.ai) → API Keys\n` +
      `Then paste it in script.js line that says \`PASTE_YOUR_OPENROUTER_KEY_HERE\`\n\n` +
      `**Option 2 — Local only:**\n` +
      `Run \`python app.py\` with your Groq key set\n\n` +
      `_Error: ${e.message}_`
    );
  }

  setChatBusy(false);
}

function sendSuggestion(text) {
  const input = document.getElementById('chatInput');
  if (input) { input.value = text; autoResize(input); }
  sendChat();
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

function clearChat() {
  chatHistory = [];
  const box = document.getElementById('chatMessages');
  if (box) {
    box.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-icon">◎</div>
      <div class="chat-welcome-text">
        Conversation cleared. I still have full awareness of the current system state.<br>
        <span style="color:var(--text-muted)">Ask me anything about the incident or system.</span>
      </div>
    </div>`;
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}