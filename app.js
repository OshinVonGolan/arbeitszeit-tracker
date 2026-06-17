'use strict';

/* ---------- Datenmodell & Speicher ---------- */
const STORE_KEY = 'azt_data_v1';
const DEFAULT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e', '#8b5cf6', '#0ea5e9'];

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      // Migration: pinned + tasks-Feld nachrüsten
      (d.projects || []).forEach(p => {
        if (p.pinned === undefined) p.pinned = true;
        if (!Array.isArray(p.tasks)) p.tasks = [];
      });
      d.meta = d.meta || {};
      return d;
    }
  } catch (e) { console.warn('load failed', e); }
  return {
    projects: [{ id: uid(), name: 'Allgemein', color: '#6366f1', pinned: true, tasks: [] }],
    entries: [],
    meta: {}
  };
}
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}
function save() {
  data.meta = data.meta || {};
  data.meta.updatedAt = Date.now();   // „seit letztem Backup geändert“-Marke
  persist();
}
function markProjectsChanged() {
  data.meta = data.meta || {};
  data.meta.projectsChangedAt = Date.now();
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Zeit-Helfer ---------- */
const MIN = 60000, HOUR = 3600000;

function breakMs(entry, now) {
  return (entry.breaks || []).reduce((s, b) => s + ((b.end || now) - b.start), 0);
}
function netMs(entry, now) {
  const end = entry.end || now;
  return Math.max(0, end - entry.start - breakMs(entry, now));
}
function getRunning() {
  return data.entries.find(e => !e.end) || null;
}
function activeBreak(entry) {
  return entry ? (entry.breaks || []).find(b => !b.end) || null : null;
}
function pad(n) { return String(n).padStart(2, '0'); }

function fmtHMS(ms) {
  const s = Math.floor(ms / 1000);
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
}
function fmtHM(ms) {
  const m = Math.round(ms / MIN);
  return Math.floor(m / 60) + ':' + pad(m % 60);
}
function fmtClock(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtDateLong(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Montag = 0
  x.setDate(x.getDate() - day);
  return x.getTime();
}
function startOfMonth(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1);
  return x.getTime();
}
function project(id) {
  return data.projects.find(p => p.id === id) || { name: '—', color: '#64748b' };
}
function findTask(projectId, taskId) {
  const p = data.projects.find(x => x.id === projectId);
  return p ? (p.tasks || []).find(t => t.id === taskId) || null : null;
}
function taskName(projectId, taskId) {
  const t = taskId ? findTask(projectId, taskId) : null;
  return t ? t.name : '';
}
function taskOptions(projectId, selectedId) {
  const p = data.projects.find(x => x.id === projectId);
  const tasks = (p && p.tasks) || [];
  selectedId = selectedId || '';
  return '<option value=""' + (selectedId === '' ? ' selected' : '') + '>— (ganzes Boot)</option>' +
    tasks.map(t => `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
}

/* ---------- Tracker-Aktionen ---------- */
function startShift(projectId, taskId = null) {
  if (getRunning()) return;            // bereits eingestempelt
  if (!data.projects.some(p => p.id === projectId)) return;
  data.entries.push({
    id: uid(), projectId, taskId: taskId || null, start: Date.now(), end: null, breaks: [], note: ''
  });
  save();
  renderAll();
}
function stopShift() {
  const running = getRunning();
  if (!running) return;
  const br = activeBreak(running);
  if (br) br.end = Date.now();         // laufende Pause beim Ausstempeln beenden
  running.end = Date.now();
  save();
  renderAll();
}

// Tipp/Slide: starten, wechseln oder (gleiches Boot + gleiche Aufgabe) ausstempeln
function selectProject(projectId, taskId = null) {
  if (!data.projects.some(p => p.id === projectId)) return;
  taskId = taskId || null;
  const running = getRunning();
  if (!running) { startShift(projectId, taskId); return; }
  if (running.projectId === projectId && (running.taskId || null) === taskId) { stopShift(); return; }
  const br = activeBreak(running);                                // Wechsel: alte Schicht beenden,
  if (br) br.end = Date.now();
  running.end = Date.now();
  data.entries.push({ id: uid(), projectId, taskId, start: Date.now(), end: null, breaks: [], note: '' });
  save();
  renderAll();
}

function toggleBreak() {
  const running = getRunning();
  if (!running) return;
  const br = activeBreak(running);
  if (br) br.end = Date.now();
  else (running.breaks = running.breaks || []).push({ start: Date.now(), end: null });
  save();
  renderAll();
}

/* ---------- Rendering ---------- */
let tickHandle = null;

function renderAll() {
  renderTracker();
  renderEntries();
  renderReport();
  renderProjects();
  renderWeekTotal();
  renderBackup();
  setupTick();
}

function controlsHtml() {
  if (!data.projects.length)
    return '<div class="empty">Lege zuerst unter „Projekte“ ein Projekt an.</div>';
  const running = getRunning();
  const br = activeBreak(running);
  const pinned = data.projects.filter(p => p.pinned);
  const others = data.projects.filter(p => !p.pinned);
  let html = '';

  if (pinned.length) {
    html += '<div class="proj-grid">' + pinned.map(p => {
      const active = running && running.projectId === p.id;
      const runTask = active && running.taskId ? taskName(p.id, running.taskId) : '';
      const sub = runTask ? `<span class="pb-sub">${esc(runTask)}</span>` : '';
      const badge = active
        ? `<em class="run-tag">${br ? 'Pause' : 'läuft'}</em>`
        : ((p.tasks || []).length ? '<i class="hold-hint">halten ⋯</i>' : '');
      return `<button class="proj-btn${active ? ' active' : ''}" data-start="${p.id}" style="--c:${p.color}"><span class="pb-main"><span class="pb-name">${esc(p.name)}</span>${sub}</span>${badge}</button>`;
    }).join('') + '</div>';
  } else if (!running) {
    html += '<div class="empty">Markiere unter „Projekte“ Projekte für die Startseite.</div>';
  }

  // Dropdown für nicht angepinnte Projekte – auch zum Wechseln während einer Schicht
  const moreList = pinned.length ? others : data.projects;
  if (moreList.length) {
    const ph = running ? '+ Zu anderem Projekt wechseln…' : (pinned.length ? '+ Anderes Projekt starten…' : 'Projekt wählen & starten…');
    html += '<select class="more-proj" data-startselect>' +
      `<option value="" disabled selected>${ph}</option>` +
      moreList.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') +
      '</select>';
  }

  // Ausstempeln + Pause, wenn eine Schicht läuft
  if (running) {
    html += `<div class="actions">
        <button class="btn btn-big btn-stop" data-action="stop">Ausstempeln</button>
        <button class="btn btn-big ${br ? 'btn-resume' : 'btn-pause'}" data-action="break">${br ? 'Pause beenden' : 'Pause starten'}</button>
      </div>`;
  }
  return html;
}

function renderTracker() {
  const running = getRunning();
  const card = document.getElementById('statusCard');
  const label = document.getElementById('statusLabel');
  const meta = document.getElementById('statusMeta');
  const controls = document.getElementById('trackerControls');
  const now = Date.now();
  const br = activeBreak(running);

  card.classList.toggle('running', !!running);
  card.classList.toggle('onbreak', !!br);

  if (!running) {
    label.textContent = 'Nicht eingestempelt';
    meta.textContent = data.projects.some(p => p.pinned) ? 'Tippe ein Projekt zum Einstempeln' : '';
  } else {
    label.textContent = br ? 'Pause' : '● ' + project(running.projectId).name;
    const bm = breakMs(running, now);
    meta.textContent = 'seit ' + fmtClock(running.start) + (bm > 0 ? '  ·  Pause ' + fmtHM(bm) + ' h' : '');
  }
  controls.innerHTML = controlsHtml();
  updateTimer();

  // Heute-Liste
  const todayKey = dayKey(now);
  const todays = data.entries.filter(e => dayKey(e.start) === todayKey).sort((a, b) => b.start - a.start);
  const list = document.getElementById('todayList');
  document.getElementById('todayEmpty').hidden = todays.length > 0;
  list.innerHTML = todays.map(entryRow).join('');
}

function updateTimer() {
  const running = getRunning();
  document.getElementById('timer').textContent = running ? fmtHMS(netMs(running, Date.now())) : '00:00:00';
}

function entryRow(e) {
  const p = project(e.projectId);
  const now = Date.now();
  const live = !e.end;
  const bm = breakMs(e, now);
  const timeStr = fmtClock(e.start) + ' – ' + (e.end ? fmtClock(e.end) : 'läuft') +
    (bm >= MIN ? '  ·  Pause ' + fmtHM(bm) : '') + (e.note ? '  ·  ' + esc(e.note) : '');
  const tName = e.taskId ? taskName(e.projectId, e.taskId) : '';
  const projLine = esc(p.name) + (tName ? ' · ' + esc(tName) : '');
  return `<div class="entry${live ? ' live' : ''}" data-id="${e.id}">
      <span class="dot" style="background:${p.color}"></span>
      <div class="e-main">
        <div class="e-proj">${projLine}</div>
        <div class="e-time">${timeStr}</div>
      </div>
      <div class="e-dur" data-dur>${fmtHM(netMs(e, now))}</div>
      <button class="e-edit" data-edit="${e.id}" aria-label="Bearbeiten">✎</button>
    </div>`;
}

function renderEntries() {
  const list = document.getElementById('entriesList');
  const sorted = [...data.entries].sort((a, b) => b.start - a.start);
  document.getElementById('entriesEmpty').hidden = sorted.length > 0;

  const groups = {};
  for (const e of sorted) (groups[dayKey(e.start)] ||= []).push(e);

  let html = '';
  for (const key of Object.keys(groups)) {
    const dayEntries = groups[key];
    const sum = dayEntries.reduce((s, e) => s + netMs(e, Date.now()), 0);
    html += `<div class="day-head"><span>${fmtDateLong(dayEntries[0].start)}</span><b>${fmtHM(sum)} h</b></div>`;
    html += dayEntries.map(entryRow).join('');
  }
  list.innerHTML = html;
}

function periodRange(kind) {
  const now = Date.now();
  if (kind === 'week') return [startOfWeek(now), Infinity];
  if (kind === 'lastweek') { const s = startOfWeek(now); return [s - 7 * 24 * HOUR, s]; }
  if (kind === 'month') return [startOfMonth(now), Infinity];
  return [0, Infinity];
}

function renderReport() {
  const kind = document.getElementById('periodSelect').value;
  const [from, to] = periodRange(kind);
  const now = Date.now();
  const inRange = data.entries.filter(e => e.start >= from && e.start < to);

  const byProj = {};
  let total = 0;
  for (const e of inRange) {
    const ms = netMs(e, now);
    total += ms;
    byProj[e.projectId] = (byProj[e.projectId] || 0) + ms;
  }
  document.getElementById('reportTotal').textContent = fmtHM(total) + ' h';

  const rows = Object.entries(byProj).sort((a, b) => b[1] - a[1]);
  const cont = document.getElementById('reportByProject');
  cont.innerHTML = rows.length
    ? rows.map(([pid, ms]) => {
        const p = project(pid);
        return `<div class="report-row"><span class="dot" style="background:${p.color}"></span>
          <span class="r-name">${esc(p.name)}</span><span class="r-val">${fmtHM(ms)} h</span></div>`;
      }).join('')
    : '<div class="empty">Keine Einträge in diesem Zeitraum.</div>';
}

function renderProjects() {
  const cont = document.getElementById('projectList');
  cont.innerHTML = data.projects.map(p => {
    const chips = (p.tasks || []).map(t =>
      `<span class="task-chip" data-task="${t.id}" data-tpid="${p.id}">${esc(t.name)}<button class="chip-x" data-deltask="${t.id}" data-tpid="${p.id}" aria-label="Aufgabe löschen">×</button></span>`
    ).join('');
    return `
    <div class="project-card">
      <div class="project-row" data-pid="${p.id}">
        <input type="color" value="${p.color}" data-color="${p.id}" />
        <span class="p-name">${esc(p.name)}</span>
        <label class="pin" title="Auf Startseite anzeigen">
          <input type="checkbox" data-pin="${p.id}"${p.pinned ? ' checked' : ''} />
          <span>Start</span>
        </label>
        <button class="icon-btn" data-rename="${p.id}" aria-label="Umbenennen">✎</button>
        <button class="icon-btn danger" data-delproj="${p.id}" aria-label="Löschen">🗑</button>
      </div>
      <div class="task-row">
        ${chips}
        <button class="task-add" data-addtask="${p.id}">+ Aufgabe</button>
      </div>
    </div>`;
  }).join('');
}

function renderWeekTotal() {
  const from = startOfWeek(Date.now());
  const now = Date.now();
  const total = data.entries.filter(e => e.start >= from).reduce((s, e) => s + netMs(e, now), 0);
  document.getElementById('weekTotal').textContent = 'Woche: ' + fmtHM(total) + ' h';
}

function setupTick() {
  if (tickHandle) clearInterval(tickHandle);
  if (getRunning()) {
    tickHandle = setInterval(() => {
      updateTimer();
      renderWeekTotal();
      // Live-Dauer der laufenden Einträge in Listen aktualisieren
      const running = getRunning();
      document.querySelectorAll('.entry.live [data-dur]').forEach(el => {
        el.textContent = fmtHM(netMs(running, Date.now()));
      });
      const meta = document.getElementById('statusMeta');
      if (running) {
        const bm = breakMs(running, Date.now());
        meta.textContent = 'seit ' + fmtClock(running.start) + (bm > 0 ? '  ·  Pause ' + fmtHM(bm) + ' h' : '');
      }
    }, 1000);
  }
}

/* ---------- Modale ---------- */
let modalOk = null;
function openModal(title, bodyHtml, onOk) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  modalOk = onOk;
  document.getElementById('modalOverlay').hidden = false;
}
function closeModal() {
  document.getElementById('modalOverlay').hidden = true;
  modalOk = null;
}

function editEntryModal(id) {
  const e = data.entries.find(x => x.id === id);
  if (!e) return;
  const projOpts = data.projects.map(p =>
    `<option value="${p.id}"${p.id === e.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  const d = new Date(e.start);
  const dateVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const endD = e.end ? new Date(e.end) : null;
  const bm = Math.round(breakMs(e, Date.now()) / MIN);
  openModal('Eintrag bearbeiten', `
    <div class="field"><label>Projekt</label><select id="m_proj">${projOpts}</select></div>
    <div class="field"><label>Aufgabe</label><select id="m_task">${taskOptions(e.projectId, e.taskId || '')}</select></div>
    <div class="field"><label>Datum</label><input type="date" id="m_date" value="${dateVal}"></div>
    <div class="row2">
      <div class="field"><label>Start</label><input type="time" id="m_start" value="${fmtClock(e.start)}"></div>
      <div class="field"><label>Ende</label><input type="time" id="m_end" value="${endD ? fmtClock(e.end) : ''}"></div>
    </div>
    <div class="field"><label>Pause (Minuten)</label><input type="number" id="m_break" min="0" step="5" value="${bm}"></div>
    <div class="field"><label>Notiz</label><input type="text" id="m_note" value="${esc(e.note || '')}" placeholder="optional"></div>
    <button class="btn btn-danger-ghost btn-block" id="m_delete" style="margin-top:8px">Eintrag löschen</button>
  `, () => {
    const date = document.getElementById('m_date').value;
    const st = document.getElementById('m_start').value;
    const en = document.getElementById('m_end').value;
    if (!date || !st) { alert('Datum und Start sind erforderlich.'); return false; }
    e.projectId = document.getElementById('m_proj').value;
    e.taskId = document.getElementById('m_task').value || null;
    e.start = new Date(`${date}T${st}`).getTime();
    e.end = en ? new Date(`${date}T${en}`).getTime() : null;
    if (e.end && e.end < e.start) e.end += 24 * HOUR; // über Mitternacht
    const brMin = Math.max(0, parseInt(document.getElementById('m_break').value || '0', 10));
    e.breaks = brMin > 0 ? [{ start: e.start, end: e.start + brMin * MIN }] : [];
    e.note = document.getElementById('m_note').value.trim();
    save(); renderAll(); return true;
  });
  document.getElementById('m_proj').addEventListener('change', () => {
    document.getElementById('m_task').innerHTML = taskOptions(document.getElementById('m_proj').value, '');
  });
  document.getElementById('m_delete').onclick = () => {
    if (confirm('Diesen Eintrag wirklich löschen?')) {
      data.entries = data.entries.filter(x => x.id !== id);
      save(); closeModal(); renderAll();
    }
  };
}

function addManualModal() {
  const projOpts = data.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const now = new Date();
  const dateVal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  openModal('Eintrag hinzufügen', `
    <div class="field"><label>Projekt</label><select id="m_proj">${projOpts}</select></div>
    <div class="field"><label>Aufgabe</label><select id="m_task">${taskOptions(data.projects[0] && data.projects[0].id, '')}</select></div>
    <div class="field"><label>Datum</label><input type="date" id="m_date" value="${dateVal}"></div>
    <div class="row2">
      <div class="field"><label>Start</label><input type="time" id="m_start" value="09:00"></div>
      <div class="field"><label>Ende</label><input type="time" id="m_end" value="17:00"></div>
    </div>
    <div class="field"><label>Pause (Minuten)</label><input type="number" id="m_break" min="0" step="5" value="30"></div>
    <div class="field"><label>Notiz</label><input type="text" id="m_note" placeholder="optional"></div>
  `, () => {
    const date = document.getElementById('m_date').value;
    const st = document.getElementById('m_start').value;
    const en = document.getElementById('m_end').value;
    if (!date || !st || !en) { alert('Datum, Start und Ende sind erforderlich.'); return false; }
    let start = new Date(`${date}T${st}`).getTime();
    let end = new Date(`${date}T${en}`).getTime();
    if (end < start) end += 24 * HOUR;
    const brMin = Math.max(0, parseInt(document.getElementById('m_break').value || '0', 10));
    data.entries.push({
      id: uid(),
      projectId: document.getElementById('m_proj').value,
      taskId: document.getElementById('m_task').value || null,
      start, end,
      breaks: brMin > 0 ? [{ start, end: start + brMin * MIN }] : [],
      note: document.getElementById('m_note').value.trim()
    });
    save(); renderAll(); return true;
  });
  document.getElementById('m_proj').addEventListener('change', () => {
    document.getElementById('m_task').innerHTML = taskOptions(document.getElementById('m_proj').value, '');
  });
}

function addProjectModal() {
  openModal('Neues Projekt', `
    <div class="field"><label>Name</label><input type="text" id="m_name" placeholder="z. B. Kunde Müller"></div>
  `, () => {
    const name = document.getElementById('m_name').value.trim();
    if (!name) { alert('Bitte einen Namen eingeben.'); return false; }
    const color = DEFAULT_COLORS[data.projects.length % DEFAULT_COLORS.length];
    data.projects.push({ id: uid(), name, color, pinned: true, tasks: [] });
    markProjectsChanged(); save(); renderAll(); return true;
  });
}

function renameProjectModal(id) {
  const p = data.projects.find(x => x.id === id);
  if (!p) return;
  openModal('Projekt umbenennen', `
    <div class="field"><label>Name</label><input type="text" id="m_name" value="${esc(p.name)}"></div>
  `, () => {
    const name = document.getElementById('m_name').value.trim();
    if (!name) return false;
    p.name = name; markProjectsChanged(); save(); renderAll(); return true;
  });
}

/* ---------- CSV-Export ---------- */
function exportCsv() {
  const kind = document.getElementById('periodSelect').value;
  const [from, to] = periodRange(kind);
  const rows = data.entries
    .filter(e => e.end && e.start >= from && e.start < to)
    .sort((a, b) => a.start - b.start);
  if (!rows.length) { alert('Keine abgeschlossenen Einträge in diesem Zeitraum.'); return; }

  const head = ['Datum', 'Projekt', 'Aufgabe', 'Start', 'Ende', 'Pause (min)', 'Netto (h)', 'Netto (hh:mm)', 'Notiz'];
  const lines = [head.join(';')];
  for (const e of rows) {
    const bm = Math.round(breakMs(e) / MIN);
    const net = netMs(e);
    const hoursDec = (net / HOUR).toFixed(2).replace('.', ',');
    lines.push([
      new Date(e.start).toLocaleDateString('de-DE'),
      csv(project(e.projectId).name),
      csv(taskName(e.projectId, e.taskId)),
      fmtClock(e.start), fmtClock(e.end),
      bm, hoursDec, fmtHM(net), csv(e.note || '')
    ].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `arbeitszeit_${kind}_${dayKey(Date.now())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(s) { return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------- Backup (JSON) + Erinnerung ---------- */
function backupPayload() {
  return JSON.stringify({
    app: 'arbeitszeit-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { projects: data.projects, entries: data.entries }
  }, null, 2);
}

async function exportBackup() {
  const fname = `arbeitszeit-backup-${dayKey(Date.now())}.json`;
  const text = backupPayload();
  // Bevorzugt teilen (Drive/Mail/…), sonst Download
  try {
    const file = new File([text], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Arbeitszeit-Backup' });
      markBackedUp();
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // Teilen abgebrochen -> nicht als gesichert markieren
    // sonstiger Fehler -> Fallback Download
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackedUp();
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const d = parsed && parsed.data ? parsed.data : parsed;   // toleriert beide Formate
      if (!d || !Array.isArray(d.projects) || !Array.isArray(d.entries))
        throw new Error('Unerwartetes Dateiformat');
      if (!confirm(`Backup einspielen?\n\nProjekte: ${d.projects.length}\nEinträge: ${d.entries.length}\n\nDie aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
      data.projects = d.projects;
      data.entries = d.entries;
      data.projects.forEach(p => { if (p.pinned === undefined) p.pinned = true; });
      save();
      data.meta.lastBackupAt = data.meta.updatedAt;   // eingespielter Stand = Datei
      persist();
      renderAll();
      alert('Backup wiederhergestellt.');
    } catch (e) {
      alert('Konnte die Datei nicht lesen: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function markBackedUp() {
  data.meta = data.meta || {};
  data.meta.lastBackupAt = data.meta.updatedAt || Date.now();
  persist();
  renderBackup();
}

function backupDue() {
  const m = data.meta || {};
  const hasContent = data.entries.length > 0 || data.projects.length > 1;
  if (!hasContent) return false;
  const today = dayKey(Date.now());
  const dailyDue = (!m.lastBackupAt || dayKey(m.lastBackupAt) !== today) && m.bannerDismissDay !== today;
  const projDue = (m.projectsChangedAt || 0) > (m.lastBackupAt || 0) && (m.projectsChangedAt || 0) > (m.bannerDismissProj || 0);
  return dailyDue || projDue;
}

function dismissBackupBanner() {
  const m = data.meta = data.meta || {};
  m.bannerDismissDay = dayKey(Date.now());
  m.bannerDismissProj = m.projectsChangedAt || 0;
  persist();
  renderBackup();
}

function renderBackup() {
  const t = (data.meta || {}).lastBackupAt;
  const nice = t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
  const bar = document.getElementById('backupBar');
  if (bar) {
    bar.hidden = !backupDue();
    const txt = document.getElementById('backupBarText');
    if (txt) txt.textContent = 'Backup empfohlen · ' + (nice ? 'zuletzt ' + nice : 'noch nie gesichert');
  }
  const info = document.getElementById('backupInfo');
  if (info) info.textContent = 'Zuletzt gesichert: ' + (nice || 'nie');
}

/* ---------- Aufgaben verwalten ---------- */
function addTaskModal(pid) {
  const p = data.projects.find(x => x.id === pid);
  if (!p) return;
  openModal('Aufgabe hinzufügen', `
    <div class="field"><label>Aufgabe für „${esc(p.name)}“</label><input type="text" id="m_tname" placeholder="z. B. Rumpf schleifen"></div>
  `, () => {
    const name = document.getElementById('m_tname').value.trim();
    if (!name) return false;
    (p.tasks = p.tasks || []).push({ id: uid(), name });
    markProjectsChanged(); save(); renderAll(); return true;
  });
}
function renameTaskModal(pid, tid) {
  const p = data.projects.find(x => x.id === pid);
  const t = p && (p.tasks || []).find(x => x.id === tid);
  if (!t) return;
  openModal('Aufgabe umbenennen', `
    <div class="field"><label>Name</label><input type="text" id="m_tname" value="${esc(t.name)}"></div>
  `, () => {
    const name = document.getElementById('m_tname').value.trim();
    if (!name) return false;
    t.name = name; markProjectsChanged(); save(); renderAll(); return true;
  });
}
function deleteTask(pid, tid) {
  const p = data.projects.find(x => x.id === pid);
  if (!p) return;
  if (!confirm('Aufgabe löschen? Bereits erfasste Einträge behalten ihre Zeit, verlieren aber die Aufgaben-Zuordnung.')) return;
  p.tasks = (p.tasks || []).filter(t => t.id !== tid);
  markProjectsChanged(); save(); renderAll();
}

/* ---------- Halten + Slide: Aufgabe starten ---------- */
let press = null;
let suppressClick = false;

function onProjPointerDown(ev) {
  const btn = ev.target.closest('.proj-btn');
  if (!btn) return;
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  const projectId = btn.dataset.start;
  const p = data.projects.find(x => x.id === projectId);
  const hasTasks = !!(p && (p.tasks || []).length);
  press = { projectId, btn, hasTasks, x0: ev.clientX, y0: ev.clientY, opened: false, sel: null, holdTimer: null };
  if (hasTasks) {
    press.holdTimer = setTimeout(() => openSlide(projectId, btn), 250);
  }
  document.addEventListener('pointermove', onProjPointerMove, { passive: false });
  document.addEventListener('pointerup', onProjPointerUp);
  document.addEventListener('pointercancel', onProjPointerCancel);
}
function onProjPointerMove(ev) {
  if (!press) return;
  if (!press.opened) {
    if (!press.hasTasks) return;                  // ohne Aufgaben: normaler Tipp
    const dx = ev.clientX - press.x0, dy = ev.clientY - press.y0;
    if (dx * dx + dy * dy > 36) {                 // ~6px Bewegung = Slide-Absicht -> sofort öffnen
      clearTimeout(press.holdTimer);
      openSlide(press.projectId, press.btn);
    }
    return;
  }
  ev.preventDefault();
  highlightSlideAt(ev.clientX, ev.clientY);
}
function onProjPointerUp(ev) {
  if (!press) return;
  clearTimeout(press.holdTimer);
  if (press.opened) {
    highlightSlideAt(ev.clientX, ev.clientY);
    const sel = press.sel;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 500);
    closeSlide();
    if (sel) selectProject(sel.projectId, sel.taskId);
  }
  endPress();
}
function onProjPointerCancel() {
  if (!press) return;
  clearTimeout(press.holdTimer);
  if (press.opened) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 500);
    closeSlide();
  }
  endPress();
}
function endPress() {
  document.removeEventListener('pointermove', onProjPointerMove);
  document.removeEventListener('pointerup', onProjPointerUp);
  document.removeEventListener('pointercancel', onProjPointerCancel);
  press = null;
}

function openSlide(projectId, btn) {
  if (!press || press.opened) return;
  const p = data.projects.find(x => x.id === projectId);
  if (!p) return;
  press.opened = true;
  if (navigator.vibrate) navigator.vibrate(15);

  const overlay = document.createElement('div');
  overlay.className = 'slide-overlay';
  overlay.id = 'slideOverlay';
  overlay.oncontextmenu = (e) => e.preventDefault();
  const menu = document.createElement('div');
  menu.className = 'slide-menu';
  let items = `<div class="slide-head" style="border-color:${p.color}">${esc(p.name)}</div>`;
  items += `<div class="slide-item" data-pid="${p.id}" data-tid="">⏱ Ganzes Boot</div>`;
  items += (p.tasks || []).map(t => `<div class="slide-item" data-pid="${p.id}" data-tid="${t.id}">${esc(t.name)}</div>`).join('');
  items += `<div class="slide-item slide-cancel" data-pid="" data-tid="">✕ Abbrechen</div>`;
  menu.innerHTML = items;
  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  const r = btn.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left + r.width / 2 - mw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.top - mh - 8;
  if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - mh - 8);
  menu.style.left = left + 'px';
  menu.style.top = Math.max(8, top) + 'px';

  setHighlight(menu.querySelector('.slide-item'));   // Standard: „Ganzes Boot“
}
function setHighlight(item) {
  const menu = document.querySelector('.slide-menu');
  if (!menu || !press) return;
  menu.querySelectorAll('.slide-item.hl').forEach(el => el.classList.remove('hl'));
  if (item) {
    item.classList.add('hl');
    press.sel = { projectId: item.dataset.pid, taskId: item.dataset.tid || null };
  }
}
function highlightSlideAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const item = el && el.closest ? el.closest('.slide-item') : null;
  if (item) setHighlight(item);   // sticky: zwischen Items bleibt letzte Auswahl
}
function closeSlide() {
  const o = document.getElementById('slideOverlay');
  if (o) o.remove();
}

/* ---------- Navigation & Events ---------- */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
document.getElementById('btnAddManual').addEventListener('click', addManualModal);
document.getElementById('btnAddProject').addEventListener('click', addProjectModal);
document.getElementById('btnExport').addEventListener('click', exportCsv);
document.getElementById('periodSelect').addEventListener('change', renderReport);

document.getElementById('btnBackup').addEventListener('click', exportBackup);
document.getElementById('btnRestore').addEventListener('click', () => document.getElementById('restoreFile').click());
document.getElementById('restoreFile').addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (f) importBackup(f);
  ev.target.value = '';
});
document.getElementById('backupBarSave').addEventListener('click', exportBackup);
document.getElementById('backupBarDismiss').addEventListener('click', dismissBackupBanner);

document.getElementById('trackerControls').addEventListener('pointerdown', onProjPointerDown);
document.getElementById('trackerControls').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.proj-btn')) e.preventDefault();   // Langdruck-Menü unterdrücken
});

document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'modalOverlay') closeModal();
});
document.getElementById('modalOk').addEventListener('click', () => {
  if (modalOk && modalOk() !== false) closeModal();
});

// Delegation: Einträge bearbeiten + Projektaktionen
document.getElementById('main').addEventListener('click', (ev) => {
  if (suppressClick) { suppressClick = false; return; }   // Klick nach Slide-Auswahl ignorieren
  const startBtn = ev.target.closest('[data-start]');
  if (startBtn) { selectProject(startBtn.dataset.start); return; }
  const act = ev.target.closest('[data-action]');
  if (act) {
    if (act.dataset.action === 'stop') stopShift();
    else if (act.dataset.action === 'break') toggleBreak();
    return;
  }
  const edit = ev.target.closest('[data-edit]');
  if (edit) { editEntryModal(edit.dataset.edit); return; }
  const rename = ev.target.closest('[data-rename]');
  if (rename) { renameProjectModal(rename.dataset.rename); return; }
  const del = ev.target.closest('[data-delproj]');
  if (del) {
    const id = del.dataset.delproj;
    if (data.projects.length <= 1) { alert('Mindestens ein Projekt muss bestehen bleiben.'); return; }
    const used = data.entries.some(e => e.projectId === id);
    if (used && !confirm('Diesem Projekt sind Einträge zugeordnet. Trotzdem löschen? (Einträge bleiben erhalten, werden aber „—“ angezeigt.)')) return;
    data.projects = data.projects.filter(p => p.id !== id);
    markProjectsChanged(); save(); renderAll();
    return;
  }
  const addtask = ev.target.closest('[data-addtask]');
  if (addtask) { addTaskModal(addtask.dataset.addtask); return; }
  const deltask = ev.target.closest('[data-deltask]');
  if (deltask) { deleteTask(deltask.dataset.tpid, deltask.dataset.deltask); return; }
  const chip = ev.target.closest('[data-task]');
  if (chip) { renameTaskModal(chip.dataset.tpid, chip.dataset.task); return; }
});
document.getElementById('main').addEventListener('change', (ev) => {
  const col = ev.target.closest('[data-color]');
  if (col) {
    const p = data.projects.find(x => x.id === col.dataset.color);
    if (p) { p.color = col.value; save(); renderAll(); }
    return;
  }
  const pin = ev.target.closest('[data-pin]');
  if (pin) {
    const p = data.projects.find(x => x.id === pin.dataset.pin);
    if (p) { p.pinned = pin.checked; save(); renderAll(); }
    return;
  }
  const ss = ev.target.closest('[data-startselect]');
  if (ss && ss.value) selectProject(ss.value);
});

/* ---------- Service Worker (mit Auto-Update) ---------- */
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();   // neue Version aktiv -> einmal frisch laden
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.update();
    } catch (e) { /* offline o. ä. */ }
  });
}

renderAll();
