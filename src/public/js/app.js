'use strict'

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  file: '',
  logPage: 1,
  logTotal: 0,
  logLimit: 200,
}

let timelineChart = null
let levelChart = null
let httpStatusChart = null

const LEVEL_COLORS = {
  INFO: '#4ade80',
  DEBUG: '#60a5fa',
  WARN: '#fbbf24',
  ERROR: '#f87171',
  FATAL: '#c084fc',
  TRACE: '#94a3b8',
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function qs(sel) {
  return document.querySelector(sel)
}
function fmt(n) {
  return (n ?? 0).toLocaleString()
}

function fmtTs(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function fmtRt(v) {
  if (v == null) return '–'
  return v < 1000 ? `${v.toFixed(0)}ms` : `${(v / 1000).toFixed(2)}s`
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function showToast(msg, dur = 2500) {
  const t = qs('#toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), dur)
}

async function apiFetch(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function getFile() {
  return qs('#fileSelect').value || ''
}

function filtersQS(prefix) {
  const from = qs(`#${prefix}-from`)?.value
  const to = qs(`#${prefix}-to`)?.value
  const level = qs(`#${prefix}-level`)?.value
  const p = new URLSearchParams()
  const file = getFile()
  if (file) p.set('file', file)
  if (from) p.set('from', from)
  if (to) p.set('to', to)
  if (level && level !== 'ALL') p.set('level', level)
  return p
}

function resetFilters(prefix) {
  if (qs(`#${prefix}-from`)) qs(`#${prefix}-from`).value = ''
  if (qs(`#${prefix}-to`)) qs(`#${prefix}-to`).value = ''
  if (qs(`#${prefix}-level`)) qs(`#${prefix}-level`).value = 'ALL'
  if (qs(`#${prefix}-q`)) qs(`#${prefix}-q`).value = ''
  if (prefix === 'log') searchLogs(1)
  else if (prefix === 'dash') loadDashboard()
  else loadCharts()
}

function syncFileToUrl(file) {
  const url = new URL(window.location.href)
  if (file) url.searchParams.set('file', file)
  else url.searchParams.delete('file')
  history.pushState({}, '', url)
}

// ── Segmented controls ────────────────────────────────────────────────────────
function bindSeg(groupId, cb) {
  qs(`#${groupId}`).addEventListener('click', (e) => {
    const seg = e.target.closest('.seg')
    if (!seg) return
    qs(`#${groupId} .seg.active`)?.classList.remove('active')
    seg.classList.add('active')
    cb(seg.dataset.val)
  })
}

function segVal(groupId) {
  return qs(`#${groupId} .seg.active`)?.dataset.val
}

// ── Ingest ────────────────────────────────────────────────────────────────────
async function triggerIngest(force = false) {
  const btn = qs('#ingestBtn')
  btn.textContent = 'Ingesting…'
  btn.disabled = true
  try {
    const data = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    }).then((r) => r.json())

    if (data.success) {
      showToast(`Ingested ${fmt(data.totalInserted)} new rows`, 4000)
      // Refresh file list
      const files = await apiFetch('/api/files')
      const sel = qs('#fileSelect')
      const current = sel.value
      sel.innerHTML = '<option value="">All files</option>'
      files.forEach((f) => {
        const opt = document.createElement('option')
        opt.value = f
        opt.textContent = f
        if (f === current) opt.selected = true
        sel.appendChild(opt)
      })
      await loadDashboard()
      if (qs('#tab-logs').classList.contains('active')) await searchLogs(1)
    } else {
      showToast(`Ingest error: ${data.error}`, 5000)
    }
  } catch (e) {
    showToast(`Ingest error: ${e.message}`, 5000)
  } finally {
    btn.textContent = 'Ingest'
    btn.disabled = false
  }
}

// ── Download ──────────────────────────────────────────────────────────────────
function downloadLogFile() {
  const file = getFile()
  if (!file) return
  window.location.href = `/api/files/download?file=${encodeURIComponent(file)}`
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Tabs
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document
        .querySelectorAll('.tab')
        .forEach((t) => t.classList.remove('active'))
      document
        .querySelectorAll('.panel')
        .forEach((p) => p.classList.remove('active'))
      tab.classList.add('active')
      qs(`#tab-${tab.dataset.tab}`).classList.add('active')
      if (tab.dataset.tab === 'charts') loadCharts()
    })
  })

  // File selector — read initial value from server-rendered select
  state.file = getFile()
  if (state.file) {
    qs('#sb-file').textContent = `File: ${state.file}`
    qs('#downloadBtn').style.display = ''
  }

  qs('#fileSelect').addEventListener('change', () => {
    state.file = getFile()
    qs('#sb-file').textContent = state.file ? `File: ${state.file}` : ''
    qs('#downloadBtn').style.display = state.file ? '' : 'none'
    syncFileToUrl(state.file)
    loadDashboard()
    if (qs('#tab-logs').classList.contains('active')) searchLogs(1)
  })

  // Keyboard shortcut for log search
  qs('#log-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchLogs(1)
  })

  // Segmented controls
  bindSeg('intervalSeg', () => loadTimeline())
  bindSeg('timelineTypeSeg', () => loadTimeline())
  bindSeg('stackSeg', () => loadTimeline())
  bindSeg('levelChartTypeSeg', () => loadLevelChart())
  bindSeg('httpChartTypeSeg', () => loadHttpStatus())

  // ESC closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal({ target: qs('#modalOverlay') })
  })

  // DB status
  try {
    const status = await apiFetch('/api/status')
    if (!status.ready) {
      qs('#dbStatus').textContent = '⚠ DB not ready — run npm run ingest'
      qs('#dbStatus').style.color = 'var(--WARN)'
      return
    }
    qs('#dbStatus').textContent = `${fmt(status.total)} entries`
    qs('#sb-total').textContent = `${fmt(status.total)} total entries`
  } catch {
    qs('#dbStatus').textContent = 'Error connecting'
    return
  }

  // Populate file list if not already server-rendered (e.g. DB was empty on load)
  const sel = qs('#fileSelect')
  if (sel.options.length <= 1) {
    try {
      const files = await apiFetch('/api/files')
      files.forEach((f) => {
        const opt = document.createElement('option')
        opt.value = f
        opt.textContent = f
        sel.appendChild(opt)
      })
      if (state.file) sel.value = state.file
    } catch {}
  }

  await Promise.all([loadDashboard(), searchLogs(1)])
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  await Promise.all([loadSummary(), loadTimeline(), loadLevelChart()])
}

async function loadSummary() {
  const p = filtersQS('dash')
  try {
    const [summary, levels] = await Promise.all([
      apiFetch('/api/stats/summary?' + p),
      apiFetch('/api/stats/levels?' + p),
    ])
    qs('#cardTotal').textContent = fmt(summary.total)
    const errCount = levels.find((l) => l.level === 'ERROR')?.count ?? 0
    const warnCount = levels.find((l) => l.level === 'WARN')?.count ?? 0
    qs('#cardErrors').textContent = fmt(errCount)
    qs('#cardWarns').textContent = fmt(warnCount)
    qs('#cardEarliest').textContent = summary.earliest
      ? fmtTs(summary.earliest)
      : '–'
    qs('#cardLatest').textContent = summary.latest
      ? '→ ' + fmtTs(summary.latest)
      : ''
    qs('#sb-range').textContent = summary.earliest
      ? `${fmtTs(summary.earliest)} — ${fmtTs(summary.latest)}`
      : ''
  } catch (e) {
    console.error(e)
  }
}

async function loadTimeline() {
  const p = filtersQS('dash')
  const interval = segVal('intervalSeg')
  const chartType = segVal('timelineTypeSeg')
  const stacked = segVal('stackSeg') === 'stacked'
  p.set('interval', interval)

  try {
    let datasets, labels

    if (stacked) {
      const rows = await apiFetch('/api/stats/timeline-stacked?' + p)
      const bucketSet = new Set(rows.map((r) => r.bucket))
      labels = [...bucketSet].sort()
      const levelSet = [...new Set(rows.map((r) => r.level))].sort()
      const map = {}
      rows.forEach((r) => {
        if (!map[r.bucket]) map[r.bucket] = {}
        map[r.bucket][r.level] = r.count
      })
      datasets = levelSet.map((lvl) => ({
        label: lvl,
        data: labels.map((b) => map[b]?.[lvl] ?? 0),
        backgroundColor: (LEVEL_COLORS[lvl] ?? '#8b91b3') + 'cc',
        borderColor: LEVEL_COLORS[lvl] ?? '#8b91b3',
        borderWidth: chartType === 'line' ? 2 : 0,
        fill: chartType === 'line',
        tension: 0.3,
        stack: 'a',
      }))
    } else {
      const rows = await apiFetch('/api/stats/timeline?' + p)
      labels = rows.map((r) => r.bucket)
      datasets = [
        {
          label: 'Logs',
          data: rows.map((r) => r.count),
          backgroundColor: 'rgba(108,138,255,0.7)',
          borderColor: '#6c8aff',
          borderWidth: chartType === 'line' ? 2 : 0,
          fill: chartType === 'line',
          tension: 0.3,
        },
      ]
    }

    if (timelineChart) {
      timelineChart.destroy()
      timelineChart = null
    }
    timelineChart = new Chart(qs('#timelineChart'), {
      type: chartType,
      data: { labels, datasets },
      options: {
        responsive: true,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8b91b3', boxWidth: 12 } } },
        scales: {
          x: {
            stacked,
            ticks: { color: '#8b91b3', maxTicksLimit: 20 },
            grid: { color: '#2e3248' },
          },
          y: {
            stacked,
            ticks: { color: '#8b91b3' },
            grid: { color: '#2e3248' },
            beginAtZero: true,
          },
        },
      },
    })
  } catch (e) {
    console.error(e)
  }
}

async function loadLevelChart() {
  const p = filtersQS('dash')
  const chartType = segVal('levelChartTypeSeg')
  try {
    const rows = await apiFetch('/api/stats/levels?' + p)
    const labels = rows.map((r) => r.level)
    const data = rows.map((r) => r.count)
    const colors = labels.map((l) => LEVEL_COLORS[l] ?? '#8b91b3')
    const isBar = chartType === 'bar'
    if (levelChart) {
      levelChart.destroy()
      levelChart = null
    }
    levelChart = new Chart(qs('#levelChart'), {
      type: chartType,
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: isBar ? colors.map((c) => c + 'cc') : colors,
            borderColor: colors,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: {
            display: !isBar,
            labels: { color: '#e2e4f0', boxWidth: 14 },
          },
        },
        scales: isBar
          ? {
              x: { ticks: { color: '#8b91b3' }, grid: { color: '#2e3248' } },
              y: {
                ticks: { color: '#8b91b3' },
                grid: { color: '#2e3248' },
                beginAtZero: true,
              },
            }
          : undefined,
      },
    })
  } catch (e) {
    console.error(e)
  }
}

// ── Charts tab ────────────────────────────────────────────────────────────────
async function loadCharts() {
  await Promise.all([loadHttpStatus(), loadUrlTable()])
}

async function loadHttpStatus() {
  const p = filtersQS('ch')
  const chartType = segVal('httpChartTypeSeg')
  try {
    const rows = await apiFetch('/api/stats/http-status?' + p)
    const labels = rows.map((r) => r.group_label)
    const data = rows.map((r) => r.count)
    const colors = {
      '1xx': '#94a3b8',
      '2xx': '#4ade80',
      '3xx': '#60a5fa',
      '4xx': '#fbbf24',
      '5xx': '#f87171',
    }
    const clrs = labels.map((l) => colors[l] ?? '#8b91b3')
    const isBar = chartType === 'bar'
    if (httpStatusChart) {
      httpStatusChart.destroy()
      httpStatusChart = null
    }
    httpStatusChart = new Chart(qs('#httpStatusChart'), {
      type: chartType,
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: isBar ? clrs.map((c) => c + 'cc') : clrs,
            borderColor: clrs,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: {
            display: !isBar,
            labels: { color: '#e2e4f0', boxWidth: 14 },
          },
        },
        scales: isBar
          ? {
              x: { ticks: { color: '#8b91b3' }, grid: { color: '#2e3248' } },
              y: {
                ticks: { color: '#8b91b3' },
                grid: { color: '#2e3248' },
                beginAtZero: true,
              },
            }
          : undefined,
      },
    })
  } catch (e) {
    console.error(e)
  }
}

async function loadUrlTable() {
  const p = filtersQS('ch')
  const wrap = qs('#urlTableWrap')
  wrap.innerHTML =
    '<div class="empty"><div class="spinner"></div>Loading…</div>'
  try {
    const rows = await apiFetch('/api/stats/urls?' + p)
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">No HTTP request data found.</div>'
      return
    }
    const maxCount = rows[0].count
    wrap.innerHTML = `
      <table class="url-table">
        <thead><tr>
          <th>Path</th><th>Requests</th><th>Avg RT</th><th>Errors</th><th style="min-width:120px">Volume</th>
        </tr></thead>
        <tbody>${rows
          .map(
            (r) => `
          <tr>
            <td title="${escHtml(r.path)}">${escHtml(r.path)}</td>
            <td>${fmt(r.count)}</td>
            <td>${r.avg_ms != null ? r.avg_ms.toFixed(0) + 'ms' : '–'}</td>
            <td style="color:${r.errors > 0 ? 'var(--ERROR)' : 'inherit'}">${fmt(r.errors)}</td>
            <td><div class="bar-cell">
              <div class="bar-bg"><div class="bar-fill" style="width:${((r.count / maxCount) * 100).toFixed(1)}%"></div></div>
            </div></td>
          </tr>`,
          )
          .join('')}
        </tbody>
      </table>`
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Error: ${escHtml(e.message)}</div>`
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────
const rowCache = {}

async function searchLogs(page) {
  state.logPage = page
  state.logLimit = parseInt(qs('#log-limit').value)
  const p = filtersQS('log')
  const q = qs('#log-q').value.trim()
  if (q) p.set('q', q)
  p.set('page', page)
  p.set('limit', state.logLimit)

  const tbody = qs('#logTable')
  tbody.innerHTML =
    '<tr><td colspan="7" class="empty"><div class="spinner"></div>Loading…</td></tr>'

  try {
    const data = await apiFetch('/api/logs?' + p)
    state.logTotal = data.total
    qs('#logCount').textContent = fmt(data.total) + ' results'

    const totalPages = Math.ceil(data.total / state.logLimit)
    qs('#logPageInfo').textContent =
      data.total > 0 ? `Page ${page} of ${totalPages}` : ''
    qs('#logPrev').disabled = page <= 1
    qs('#logNext').disabled = page >= totalPages

    if (!data.rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="empty"><h4>No results</h4>Try different filters or keyword.</td></tr>'
      return
    }

    data.rows.forEach((r) => {
      rowCache[r.id] = r
    })

    tbody.innerHTML = data.rows
      .map((r) => {
        const lvl = r.level || 'INFO'
        const ts = r.timestamp
          ? new Date(r.timestamp).toLocaleString('en-GB', {
              dateStyle: 'short',
              timeStyle: 'medium',
            })
          : '–'
        const msg = escHtml(r.message ?? '')
        const url = escHtml(r.url ?? '')
        const rtStyle =
          r.response_time > 5000
            ? 'color:var(--ERROR)'
            : r.response_time > 1000
              ? 'color:var(--WARN)'
              : ''
        return `<tr onclick="showDetail(${r.id})">
        <td class="ts">${ts}</td>
        <td><span class="lvl lvl-${lvl}">${lvl}</span></td>
        <td class="method">${escHtml(r.method ?? '')}</td>
        <td style="${r.status_code >= 400 ? 'color:var(--ERROR)' : r.status_code >= 300 ? 'color:var(--WARN)' : ''}">${r.status_code ?? ''}</td>
        <td class="rt" style="${rtStyle}">${r.response_time != null ? r.response_time.toFixed(0) : '–'}</td>
        <td class="url" title="${url}">${url}</td>
        <td class="msg" title="${msg}">${msg}</td>
      </tr>`
      })
      .join('')
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty"><h4>Error</h4>${escHtml(e.message)}</td></tr>`
  }
}

function changePage(dir) {
  const totalPages = Math.ceil(state.logTotal / state.logLimit)
  const next = Math.min(Math.max(1, state.logPage + dir), totalPages)
  if (next !== state.logPage) searchLogs(next)
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function showDetail(id) {
  const r = rowCache[id]
  if (!r) return
  const modal = qs('#modalOverlay')
  modal.classList.add('open')

  qs('#modalLevel').innerHTML =
    `<span class="lvl lvl-${r.level}">${r.level}</span>`

  let prettyMsg = r.message ?? ''
  if (prettyMsg.startsWith('{') || prettyMsg.startsWith('[')) {
    try {
      prettyMsg = JSON.stringify(JSON.parse(prettyMsg), null, 2)
    } catch {}
  }

  const fields = [
    ['Time', r.timestamp ? new Date(r.timestamp).toLocaleString() : '–'],
    ['File', r.log_file],
    ['Level', r.level],
    r.method ? ['Method', r.method] : null,
    r.url ? ['URL', r.url] : null,
    r.status_code ? ['Status', r.status_code] : null,
    r.response_time != null ? ['Response Time', fmtRt(r.response_time)] : null,
    r.hostname ? ['Hostname', r.hostname] : null,
    r.pid ? ['PID', r.pid] : null,
    r.req_id ? ['Req ID', r.req_id] : null,
  ].filter(Boolean)

  qs('#modalKv').innerHTML = fields
    .map(
      ([k, v]) =>
        `<div class="kv-key">${escHtml(k)}</div><div class="kv-val">${escHtml(String(v))}</div>`,
    )
    .join('')

  qs('#modalMsg').textContent = prettyMsg
}

function closeModal(e) {
  if (e && e.target !== qs('#modalOverlay')) return
  qs('#modalOverlay').classList.remove('open')
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
init()
