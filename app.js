'use strict';
// Agente Running — PWA. Lee y escribe los CSV del repo privado vía API de GitHub.

const VERSION = '1.0.1';
const TZ = 'Europe/Madrid';
const FILES = {
  perfil: 'perfil.md', plan: 'running/plan.md',
  comidas: 'nutricion/comidas.csv', alimentos: 'nutricion/alimentos.csv', actividad: 'nutricion/actividad.csv',
  entrenos: 'running/entrenos.csv', peso: 'peso.csv',
};
const CLAUDE_URL = 'https://claude.ai/code';
const INTENSOS = ['series', 'tempo', 'fartlek', 'cuestas', 'competicion', 'tirada'];

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = x => { const n = parseFloat(String(x ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const r1 = x => Math.round(x * 10) / 10;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ---------- configuración ----------
let cfg = {};
try { cfg = JSON.parse(localStorage.getItem('cfg') || '{}'); } catch { cfg = {}; }
cfg = { owner: 'antonioprieto22', repo: 'agentes-running', token: '', ...cfg };
const saveCfg = () => { try { localStorage.setItem('cfg', JSON.stringify(cfg)); } catch { /* sin almacenamiento */ } };

// ---------- fechas ----------
function ahora() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, h: +p.hour };
}
const addDays = (f, n) => { const d = new Date(f + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = f => new Date(f + 'T00:00:00Z').getUTCDay();
const lunes = f => addDays(f, -((dow(f) + 6) % 7));
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const fechaLarga = f => new Date(f + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

// ---------- CSV ----------
function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map(s => s.trim());
}
const fmtField = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = parseLine(lines[0] || '');
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const f = parseLine(l), o = { _raw: l };
    header.forEach((h, i) => (o[h] = f[i] ?? ''));
    return o;
  });
  return { header, rows };
}
const toLine = (header, r) => header.map(h => fmtField(r[h])).join(',');

// ---------- GitHub ----------
const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));
function b64enc(s) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function api(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    ...opts, cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error('Clave no válida o caducada (Ajustes)');
  if (res.status === 404) throw new Error(`No encuentro ${path}: revisa usuario/repo y permisos de la clave`);
  return res;
}
async function getFile(path) {
  const res = await api(`${path}?ref=main&t=${Date.now()}`);
  if (!res.ok) throw new Error(`GitHub ${res.status} al leer ${path}`);
  const j = await res.json();
  return { text: b64dec(j.content), sha: j.sha };
}
// Modifica un archivo con reintento si otro dispositivo escribió entre medias.
async function modify(key, fn, message) {
  for (let intento = 0; intento < 3; intento++) {
    const f = intento === 0 && D[key] ? D[key] : await getFile(FILES[key]);
    let text = fn(f.text);
    if (!text.endsWith('\n')) text += '\n';
    const res = await api(FILES[key], {
      method: 'PUT',
      body: JSON.stringify({ message: `app: ${message}`, content: b64enc(text), sha: f.sha, branch: 'main' }),
    });
    if (res.ok) { const j = await res.json(); D[key] = { text, sha: j.content.sha }; return; }
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub ${res.status} al guardar`);
    D[key] = null;
  }
  throw new Error('Conflicto al guardar; actualiza e inténtalo de nuevo');
}
const appendLines = (key, lines, msg) => modify(key, t => (t.endsWith('\n') || !t ? t : t + '\n') + lines.join('\n') + '\n', msg);

// ---------- estado ----------
let D = {};
let seccion = 'nutri';

async function cargar() {
  if (!cfg.token) { irA('ajustes'); return; }
  const b = $('#btn-sync'); b.classList.add('spin');
  try {
    const pares = await Promise.all(Object.entries(FILES).map(async ([k, p]) => [k, await getFile(p)]));
    D = Object.fromEntries(pares);
    render();
  } catch (e) { toast(e.message); if (!Object.keys(D).length) irA('ajustes'); }
  finally { b.classList.remove('spin'); }
}

function perfil() {
  const o = {};
  for (const m of (D.perfil?.text || '').matchAll(/^\s*-\s*([a-z_]+)\s*:\s*(.*)$/gim)) o[m[1].toLowerCase()] = m[2].replace(/\s+#.*$/, '').trim();
  return o;
}
function planRows() {
  return (D.plan?.text || '').split(/\r?\n/).filter(l => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l)).map(l => {
    const [fecha, dia, sesion, detalle] = l.split('|').slice(1).map(s => s.trim());
    return { fecha, dia, sesion, detalle };
  });
}
const csv = k => parseCsv(D[k]?.text || '');

// ---------- cálculos compartidos ----------
function nutriDia(f) {
  const rows = csv('comidas').rows.filter(r => r.fecha === f);
  const t = { kcal: 0, P: 0, HC: 0, G: 0 };
  rows.forEach(r => { t.kcal += num(r.kcal); t.P += num(r.prot_g); t.HC += num(r.hc_g); t.G += num(r.grasa_g); });
  const p = perfil(), act = csv('actividad').rows.find(r => r.fecha === f);
  const tmb = num(p.tmb_kcal) || 1880;
  return {
    rows, t, tmb, act,
    gasto: act ? tmb + num(act.kcal_activas) : null,
    protRef: Math.round(num(p.proteina_g_kg) * num(p.peso_kg)) || 0,
  };
}
function runInfo(hoy) {
  const all = csv('entrenos').rows.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const rango = (a, b) => all.filter(e => e.fecha >= a && e.fecha <= b);
  const suma = (rs, k) => rs.reduce((s, e) => s + num(e[k]), 0);
  const l0 = lunes(hoy), semanas = [];
  for (let k = 4; k >= 0; k--) {
    const a = addDays(l0, -7 * k), rs = rango(a, addDays(a, 6));
    semanas.push({ lunes: a, km: r1(suma(rs, 'distancia_km')), carga: Math.round(suma(rs, 'carga')), n: rs.length, now: k === 0 });
  }
  const ag = suma(rango(addDays(hoy, -6), hoy), 'carga'), cr = suma(rango(addDays(hoy, -27), hoy), 'carga') / 4;
  const fiable = all.length && all[0].fecha <= addDays(hoy, -21);
  return { all, semanas, acwr: cr > 0 ? r1(ag / cr) : null, fiable, hoyE: all.filter(e => e.fecha === hoy) };
}
function tipoDia(entrenosHoy, planHoy) {
  const s = norm(entrenosHoy.map(e => e.tipo).join(' ') + ' ' + (planHoy?.sesion || ''));
  if (INTENSOS.some(t => s.includes(t))) return 'intenso';
  if (/rodaje|z2/.test(s)) return 'suave';
  return 'descanso';
}

// ---------- render ----------
function render() {
  const { fecha } = ahora();
  $('#fecha').textContent = fechaLarga(fecha);
  if (seccion === 'nutri') renderNutri(fecha);
  if (seccion === 'run') renderRun(fecha);
  if (seccion === 'ajustes') renderAjustes();
}

const ICON_RUN = '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-4 4 1 2 4 3 1M11 15l-2-3"/></svg>';
const ICON_FORK = '<svg viewBox="0 0 24 24"><path d="M7 3v8a3 3 0 0 0 3 3v7M7 3v5M10 3v5M17 3c-2 2-3 5-3 8h3v10"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function renderNutri(hoy) {
  const n = nutriDia(hoy), plan = planRows();
  const pHoy = plan.find(p => p.fecha === hoy), pMan = plan.find(p => p.fecha === addDays(hoy, 1));
  const run = runInfo(hoy);
  const td = tipoDia(run.hoyE, pHoy), tdMan = tipoDia([], pMan);
  const ref = n.gasto ?? n.tmb;
  const pct = Math.min(1, n.t.kcal / ref), C = 2 * Math.PI * 48;
  const bal = n.gasto != null ? Math.round(n.t.kcal - n.gasto) : null;

  const comidas = [...new Set(n.rows.map(r => r.comida))];
  const lista = comidas.map(c => {
    const rs = n.rows.filter(r => r.comida === c);
    const sub = Math.round(rs.reduce((s, r) => s + num(r.kcal), 0));
    return `<div class="meal"><div class="meal-head"><span>${esc(c)}</span><span>${sub} kcal</span></div>
      ${rs.map(r => `<div class="item"><div class="grow"><div class="name">${esc(r.alimento)}</div>
        <div class="muted">${esc(r.cantidad_g)} g · P${esc(r.prot_g)} HC${esc(r.hc_g)} G${esc(r.grasa_g)}</div></div>
        ${r.fuente === 'estimado' ? '<span class="tag">est.</span>' : ''}<b>${esc(r.kcal)}</b>
        <button class="del" data-del="${encodeURIComponent(r._raw)}" aria-label="Borrar">${ICON_X}</button></div>`).join('')}</div>`;
  }).join('');

  const consejoHC = td === 'intenso' || tdMan === 'intenso'
    ? `Día ${td === 'intenso' ? 'de calidad hoy' : 'de calidad mañana'}: prioriza hidratos alrededor del entreno.`
    : td === 'suave' ? 'Rodaje suave: hidratos moderados, prioriza la proteína.' : 'Día sin carrera: buen día para apretar el déficit.';

  $('#v-nutri').innerHTML = `
    <div class="card hero">
      <div class="ring">
        <svg viewBox="0 0 116 116"><circle class="bg" cx="58" cy="58" r="48"/>
          <circle class="fg" cx="58" cy="58" r="48" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" stroke-linecap="round"/></svg>
        <div class="lbl"><b>${Math.round(n.t.kcal)}</b><small>de ${ref} kcal</small></div>
      </div>
      <div class="kv">
        <div><span>TMB</span><b>${n.tmb}</b></div>
        <div><span>Activas</span><b>${n.act ? num(n.act.kcal_activas) : '—'}</b></div>
        <div><span>Gasto</span><b>${n.gasto ?? '—'}</b></div>
        ${bal != null
          ? `<div><span>Balance</span><b class="big ${bal < 0 ? 'good' : 'bad'}">${bal > 0 ? '+' : ''}${bal}</b></div>`
          : `<button class="chip on" id="btn-cierre">Cerrar el día</button>`}
      </div>
    </div>
    <div class="card"><div class="macros">
      ${macro('Proteína', n.t.P, n.protRef)}${macro('Hidratos', n.t.HC, 0)}${macro('Grasa', n.t.G, 0)}
    </div></div>
    <button class="bridge to-run card" data-goto="run">
      <span class="dot">${ICON_RUN}</span>
      <span><b>${pHoy ? esc(pHoy.sesion) : 'Sin sesión en el plan'}${run.hoyE.length ? ' · hecho ✓' : ''}</b>
      <span class="muted">${esc(consejoHC)}</span></span>
    </button>
    <div class="card"><h3>Comidas de hoy <span>${n.rows.length ? Math.round(n.t.kcal) + ' kcal' : ''}</span></h3>
      ${lista || '<div class="empty">Aún no has registrado nada.<br>Pulsa + para añadir.</div>'}</div>
    <a class="btn ghost" href="${CLAUDE_URL}" target="_blank" rel="noopener">Describir una comida o foto al agente →</a>`;

  $('#btn-cierre')?.addEventListener('click', () => abrirSheet('cierre'));
  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => borrarComida(decodeURIComponent(b.dataset.del))));
}
function macro(nombre, v, ref) {
  return `<div class="macro"><span class="muted">${nombre}</span><b>${Math.round(v)} g</b>
    ${ref ? `<div class="bar"><i style="width:${Math.min(100, (v / ref) * 100)}%"></i></div><span class="muted">de ${ref} g</span>` : ''}</div>`;
}

function renderRun(hoy) {
  const r = runInfo(hoy), plan = planRows(), n = nutriDia(hoy), p = perfil();
  const maxKm = Math.max(5, ...r.semanas.map(s => s.km));
  const objetivo = p.fecha_objetivo && /^\d{4}/.test(p.fecha_objetivo) ? diasEntre(hoy, p.fecha_objetivo) : null;
  const hechos = new Set(r.all.map(e => e.fecha));
  const prox = plan.filter(x => x.fecha >= hoy && !/^(descanso|fuerza)/.test(norm(x.sesion))).slice(0, 5);
  const semActual = r.semanas.at(-1), semPrev = r.semanas.at(-2);
  const delta = semPrev.km ? Math.round((semActual.km / semPrev.km - 1) * 100) : null;
  const bal = n.gasto != null ? Math.round(n.t.kcal - n.gasto) : null;

  $('#v-run').innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div><h3 style="margin:0 0 4px">Objetivo</h3><b>${esc(p.objetivo_carrera || '—')}</b></div>
      ${objetivo != null ? `<div style="text-align:right"><div class="count">${objetivo}</div><span class="muted">días</span></div>` : ''}
    </div>
    <div class="card"><h3>Próximas sesiones</h3>
      ${prox.map(x => {
        const d = new Date(x.fecha + 'T12:00:00Z');
        return `<div class="session ${x.fecha === hoy ? 'today' : ''}">
          <div class="date"><small>${DIAS[d.getUTCDay()]}</small><b>${d.getUTCDate()}</b></div>
          <div><b>${esc(x.sesion)}</b><div class="muted">${esc(x.detalle)}</div></div>
          ${hechos.has(x.fecha) ? '<span class="done">✓</span>' : ''}</div>`;
      }).join('') || '<div class="empty">Sin sesiones en el plan. Pídeselo al agente.</div>'}
    </div>
    <div class="card"><h3>Volumen semanal <span>${semActual.km} km · anterior ${semPrev.km}</span></h3>
      <div class="weeks">${r.semanas.map(s => `<div class="wk ${s.now ? 'now' : ''}"><b>${s.km}</b>
        <div class="col" style="height:100%"><i style="height:${(s.km / maxKm) * 100}%"></i></div>
        <span>${s.now ? 'esta' : new Date(s.lunes + 'T12:00:00Z').getUTCDate() + '/' + (new Date(s.lunes + 'T12:00:00Z').getUTCMonth() + 1)}</span></div>`).join('')}</div>
      <p class="muted" style="margin-top:10px">ACWR ${r.acwr ?? '—'}${r.fiable ? (r.acwr > 1.5 ? ' · sobrecarga' : r.acwr > 1.3 ? ' · vigila' : ' · ok') : ' · poco historial, orientativo'} · regla del 10 %: ${delta != null && delta > 10 ? 'subida por encima' : 'ok'}</p>
    </div>
    <button class="bridge to-nutri card" data-goto="nutri">
      <span class="dot">${ICON_FORK}</span>
      <span><b>Energía de hoy: ${Math.round(n.t.kcal)} kcal ingeridas</b>
      <span class="muted">${bal != null ? `Balance ${bal > 0 ? '+' : ''}${bal} kcal · ` : ''}Proteína ${Math.round(n.t.P)}/${n.protRef} g${bal != null && bal < -1000 ? ' · déficit alto para recuperar bien' : ''}</span></span>
    </button>
    <div class="card"><h3>Últimas sesiones</h3>
      ${r.all.slice(-6).reverse().map(e => {
        const d = new Date(e.fecha + 'T12:00:00Z');
        return `<div class="session"><div class="date"><small>${DIAS[d.getUTCDay()]}</small><b>${d.getUTCDate()}</b></div>
          <div><b style="text-transform:capitalize">${esc(e.tipo)} · ${esc(e.distancia_km)} km</b>
          <div class="muted">${esc(e.ritmo_min_km)}/km · ${esc(e.duracion_min)} min${e.fc_media ? ' · ' + esc(e.fc_media) + ' ppm' : ''}</div></div>
          <span class="tag">${e.rpe ? 'RPE ' + esc(e.rpe) : 'sin RPE'}</span></div>`;
      }).join('') || '<div class="empty">Sin sesiones.</div>'}
    </div>
    <a class="btn ghost" href="${CLAUDE_URL}" target="_blank" rel="noopener">Contar sensaciones o pedir análisis al agente →</a>`;
}

function renderAjustes() {
  $('#v-ajustes').innerHTML = `
    <div class="card stack">
      <h3>Conexión con tus datos</h3>
      <label>Usuario de GitHub<input id="c-owner" value="${esc(cfg.owner)}" autocapitalize="off"></label>
      <label>Repositorio<input id="c-repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      <label>Clave de acceso (token)<input id="c-token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocapitalize="off"></label>
      <button class="btn primary" id="c-save">Guardar y conectar</button>
      <p class="muted">La clave solo se guarda en este móvil.</p>
    </div>
    <div class="card">
      <h3>Cómo crear la clave (una vez)</h3>
      <ol class="steps">
        <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
        <li>Nombre: <b>App móvil</b> · Caducidad: la que quieras (máx. 1 año).</li>
        <li>Repository access: <b>Only select repositories</b> → <b>agentes-running</b>.</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b>.</li>
        <li><b>Generate token</b>, cópialo y pégalo arriba.</li>
      </ol>
    </div>
    <div class="card stack">
      <h3>App</h3>
      <button class="btn ghost" id="c-install" hidden>Instalar en la pantalla de inicio</button>
      <a class="btn ghost" href="${CLAUDE_URL}" target="_blank" rel="noopener">Abrir el agente (Claude Code)</a>
      <p class="muted">Versión ${VERSION}</p>
    </div>`;
  $('#c-save').addEventListener('click', () => {
    cfg.owner = $('#c-owner').value.trim(); cfg.repo = $('#c-repo').value.trim(); cfg.token = $('#c-token').value.trim();
    saveCfg(); toast('Conectando…'); cargar().then(() => { if (Object.keys(D).length) { toast('Conectado ✓'); irA('nutri'); } });
  });
  if (deferredInstall) { const b = $('#c-install'); b.hidden = false; b.onclick = () => deferredInstall.prompt(); }
}

// ---------- acciones ----------
async function borrarComida(raw) {
  if (!confirm('¿Borrar este alimento?')) return;
  try {
    await modify('comidas', t => { const ls = t.split('\n'); const i = ls.indexOf(raw); if (i > 0) ls.splice(i, 1); return ls.join('\n'); }, 'borra alimento');
    toast('Borrado'); render();
  } catch (e) { toast(e.message); }
}

let carrito = [];
function comidaPorHora(h) { return h < 12 ? 'desayuno' : h < 17 ? 'comida' : h < 20 ? 'merienda' : 'cena'; }

function abrirSheet(tipo) {
  $('#sheet').hidden = false;
  const tabs = seccion === 'run'
    ? [['entreno', 'Entreno']]
    : [['comida', 'Comida'], ['peso', 'Peso'], ['cierre', 'Cierre']];
  const actual = tipo || tabs[0][0];
  $('#sheet-title').textContent = seccion === 'run' ? 'Registrar entreno' : 'Añadir';
  $('#sheet-body').innerHTML = (tabs.length > 1
    ? `<div class="seg">${tabs.map(([k, l]) => `<button data-seg="${k}" class="${k === actual ? 'on' : ''}">${l}</button>`).join('')}</div>` : '') +
    '<div id="seg-body"></div>';
  document.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => abrirSheet(b.dataset.seg)));
  ({ comida: formComida, peso: formPeso, cierre: formCierre, entreno: formEntreno })[actual]();
}
const cerrarSheet = () => { $('#sheet').hidden = true; };

function formComida() {
  const { h } = ahora();
  const base = csv('alimentos').rows;
  const usos = {};
  csv('comidas').rows.slice(-200).forEach(r => (usos[r.alimento] = (usos[r.alimento] || 0) + 1));
  $('#seg-body').innerHTML = `<div class="stack">
    <select id="f-comida">${['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack'].map(c => `<option ${c === comidaPorHora(h) ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <input id="f-q" placeholder="Buscar alimento de tu base…" autocomplete="off">
    <div id="f-pick"></div>
    <div class="results" id="f-res"></div>
    <div class="cart" id="f-cart"></div>
    <button class="btn primary" id="f-save" disabled>Guardar comida</button>
    <button class="btn ghost" id="f-manual">Otro alimento (con sus valores)</button>
    <a class="btn ghost" href="${CLAUDE_URL}" target="_blank" rel="noopener">Describir libremente o con foto al agente →</a>
  </div>`;
  const pintarRes = () => {
    const q = norm($('#f-q').value);
    const lista = base.filter(a => !q || norm(a.alimento).includes(q) || norm(a.alias).includes(q))
      .sort((a, b) => (usos[b.alimento] || 0) - (usos[a.alimento] || 0)).slice(0, 8);
    $('#f-res').innerHTML = lista.map((a, i) => `<button class="result" data-i="${base.indexOf(a)}">
      <span>${esc(a.alimento)}<br><span class="muted">${esc(a.racion_desc)} = ${esc(a.racion_g)} g</span></span>
      <span class="muted">${esc(a.kcal_100g)} kcal/100 g</span></button>`).join('');
    document.querySelectorAll('#f-res [data-i]').forEach(b => b.addEventListener('click', () => elegir(base[+b.dataset.i])));
  };
  const elegir = a => {
    const rg = num(a.racion_g) || 100;
    $('#f-pick').innerHTML = `<div class="picked"><b>${esc(a.alimento)}</b>
      <div class="chips">${[0.5, 1, 2, 3].map(m => `<button class="chip" data-m="${m}">${m === 0.5 ? '½' : m} ${esc(a.racion_desc.replace(/^1\s*/, ''))}</button>`).join('')}</div>
      <div class="row2"><input id="f-g" type="number" inputmode="decimal" value="${rg}"><button class="btn primary" id="f-add">Añadir</button></div>
      <span class="muted" id="f-prev"></span></div>`;
    const prev = () => { const g = num($('#f-g').value); $('#f-prev').textContent = `${g} g → ${Math.round(num(a.kcal_100g) * g / 100)} kcal · P${r1(num(a.prot_100g) * g / 100)}`; };
    document.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { $('#f-g').value = r1(rg * +b.dataset.m); prev(); }));
    $('#f-g').addEventListener('input', prev); prev();
    $('#f-add').addEventListener('click', () => {
      const g = num($('#f-g').value); if (!g) return;
      const k = g / 100;
      carrito.push({ alimento: a.alimento, cantidad_g: g, kcal: Math.round(num(a.kcal_100g) * k), prot_g: r1(num(a.prot_100g) * k),
        hc_g: r1(num(a.hc_100g) * k), grasa_g: r1(num(a.grasa_100g) * k), fuente: 'base' });
      $('#f-pick').innerHTML = ''; $('#f-q').value = ''; pintarRes(); pintarCarrito();
    });
  };
  const pintarCarrito = () => {
    const tot = carrito.reduce((s, c) => s + c.kcal, 0);
    $('#f-cart').innerHTML = carrito.length ? `<h3 class="muted" style="margin:6px 0">En este plato · ${tot} kcal</h3>` +
      carrito.map((c, i) => `<div class="item"><div class="grow"><div class="name">${esc(c.alimento)}</div><div class="muted">${c.cantidad_g} g</div></div>
        <b>${c.kcal}</b><button class="del" data-ci="${i}">${ICON_X}</button></div>`).join('') : '';
    document.querySelectorAll('[data-ci]').forEach(b => b.addEventListener('click', () => { carrito.splice(+b.dataset.ci, 1); pintarCarrito(); }));
    $('#f-save').disabled = !carrito.length;
  };
  $('#f-q').addEventListener('input', pintarRes);
  $('#f-manual').addEventListener('click', () => {
    $('#f-pick').innerHTML = `<div class="picked">
      <input id="m-n" placeholder="Nombre (p. ej. barrita proteica)">
      <div class="row2"><input id="m-g" type="number" inputmode="decimal" placeholder="gramos"><input id="m-k" type="number" inputmode="decimal" placeholder="kcal"></div>
      <div class="row2"><input id="m-p" type="number" inputmode="decimal" placeholder="Proteína g"><input id="m-h" type="number" inputmode="decimal" placeholder="Hidratos g"></div>
      <div class="row2"><input id="m-f" type="number" inputmode="decimal" placeholder="Grasa g"><button class="btn primary" id="m-add">Añadir</button></div></div>`;
    $('#m-add').addEventListener('click', () => {
      const nm = $('#m-n').value.trim().replace(/,/g, ' ');
      if (!nm || !num($('#m-k').value)) return toast('Pon al menos nombre y kcal');
      carrito.push({ alimento: nm, cantidad_g: num($('#m-g').value), kcal: Math.round(num($('#m-k').value)), prot_g: r1(num($('#m-p').value)),
        hc_g: r1(num($('#m-h').value)), grasa_g: r1(num($('#m-f').value)), fuente: 'estimado' });
      $('#f-pick').innerHTML = ''; pintarCarrito();
    });
  });
  $('#f-save').addEventListener('click', async () => {
    const { fecha, hora } = ahora(), comida = $('#f-comida').value, { header } = csv('comidas');
    $('#f-save').disabled = true;
    try {
      await appendLines('comidas', carrito.map(c => toLine(header, { fecha, hora, comida, ...c })), `${comida} (${carrito.length} alimentos)`);
      carrito = []; cerrarSheet(); toast('Comida guardada ✓'); render();
    } catch (e) { toast(e.message); $('#f-save').disabled = false; }
  });
  pintarRes(); pintarCarrito();
}

async function upsert(key, fecha, linea, msg) {
  await modify(key, t => t.split('\n').filter(l => !l.startsWith(fecha + ',')).join('\n').replace(/\n*$/, '\n') + linea + '\n', msg);
}

function formPeso() {
  $('#seg-body').innerHTML = `<div class="stack"><label>Peso en ayunas (kg)<input id="p-kg" type="number" inputmode="decimal" step="0.1"></label>
    <button class="btn primary" id="p-save">Guardar peso</button></div>`;
  $('#p-save').addEventListener('click', async () => {
    const kg = num($('#p-kg').value); if (!kg) return;
    const { fecha } = ahora();
    try { await upsert('peso', fecha, `${fecha},${r1(kg)}`, `peso ${kg}`); cerrarSheet(); toast('Peso guardado ✓'); render(); }
    catch (e) { toast(e.message); }
  });
}

function formCierre() {
  const { fecha } = ahora(), act = csv('actividad').rows.find(r => r.fecha === fecha);
  $('#seg-body').innerHTML = `<div class="stack">
    <p class="muted">Datos del reloj (Mi Fitness) al final del día.</p>
    <div class="row2"><label>Pasos<input id="c-pasos" type="number" inputmode="numeric" value="${esc(act?.pasos || '')}"></label>
    <label>Kcal activas<input id="c-kcal" type="number" inputmode="numeric" value="${esc(act?.kcal_activas || '')}"></label></div>
    <button class="btn primary" id="c-ok">Cerrar el día</button></div>`;
  $('#c-ok').addEventListener('click', async () => {
    const pasos = Math.round(num($('#c-pasos').value)), kcal = Math.round(num($('#c-kcal').value));
    if (!kcal) return toast('Indica las kcal activas');
    try {
      await upsert('actividad', fecha, `${fecha},${pasos},${kcal}`, `cierre ${fecha}`);
      cerrarSheet(); render();
      const n = nutriDia(fecha), bal = Math.round(n.t.kcal - n.gasto);
      toast(`Día cerrado · balance ${bal > 0 ? '+' : ''}${bal} kcal`);
    } catch (e) { toast(e.message); }
  });
}

function formEntreno() {
  const { fecha } = ahora();
  const plan = planRows().find(p => p.fecha === fecha);
  $('#seg-body').innerHTML = `<div class="stack">
    ${plan ? `<p class="muted">Plan de hoy: <b>${esc(plan.sesion)}</b> · ${esc(plan.detalle)}</p>` : ''}
    <div class="row2"><label>Tipo<select id="e-tipo">${['rodaje', 'series', 'tempo', 'tirada', 'fartlek', 'cuestas', 'competicion'].map(t => `<option ${plan && norm(plan.sesion).includes(t) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Fecha<input id="e-f" type="date" value="${fecha}"></label></div>
    <div class="row2"><label>Distancia (km)<input id="e-km" type="number" inputmode="decimal" step="0.01"></label>
    <label>Tiempo (min:seg)<input id="e-t" placeholder="52:30" inputmode="numeric"></label></div>
    <div class="row2"><label>FC media<input id="e-fc" type="number" inputmode="numeric"></label>
    <label>Esfuerzo (RPE 1–10)<input id="e-rpe" type="number" inputmode="numeric" min="1" max="10"></label></div>
    <label>Sensaciones / rodillas<input id="e-notas" placeholder="p. ej. rodillas bien, piernas frescas"></label>
    <button class="btn primary" id="e-save">Guardar entreno</button>
    <p class="muted">Si la sesión ya llegó de Strava, se completa con tu RPE y notas en vez de duplicarla.</p>
  </div>`;
  $('#e-save').addEventListener('click', async () => {
    const f = $('#e-f').value, km = num($('#e-km').value), rpe = Math.round(num($('#e-rpe').value));
    const [mm, ss] = $('#e-t').value.split(':'), min = r1(num(mm) + num(ss) / 60);
    const notas = $('#e-notas').value.replace(/[,"\n]/g, ' ').trim();
    const { header, rows } = csv('entrenos');
    const strava = rows.find(r => r.fecha === f && r.fuente === 'strava' && (!km || Math.abs(num(r.distancia_km) - km) <= 0.15 * km));
    try {
      if (strava) {
        const nuevo = { ...strava, tipo: $('#e-tipo').value, rpe: rpe || strava.rpe, notas: [strava.notas, notas].filter(Boolean).join('; ') };
        nuevo.carga = nuevo.rpe ? Math.round(num(nuevo.rpe) * num(nuevo.duracion_min)) : '';
        await modify('entrenos', t => t.split('\n').map(l => (l === strava._raw ? toLine(header, nuevo) : l)).join('\n'), `completa entreno ${f}`);
      } else {
        if (!km || !min) return toast('Indica distancia y tiempo');
        const s = Math.round((min / km) * 60);
        const fila = { fecha: f, tipo: $('#e-tipo').value, distancia_km: km, duracion_min: min, ritmo_min_km: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
          desnivel_m: '', fc_media: $('#e-fc').value, rpe: rpe || '', carga: rpe ? Math.round(rpe * min) : '', notas, fuente: 'manual', strava_id: '' };
        await appendLines('entrenos', [toLine(header, fila)], `entreno ${f} ${km} km`);
      }
      cerrarSheet(); toast('Entreno guardado ✓'); render();
    } catch (e) { toast(e.message); }
  });
}

// ---------- navegación ----------
function irA(sec) {
  seccion = sec;
  document.body.dataset.sec = sec;
  ['nutri', 'run', 'ajustes'].forEach(s => ($(`#v-${s}`).hidden = s !== sec));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === sec));
  $('#titulo').textContent = { nutri: 'Nutrición', run: 'Running', ajustes: 'Ajustes' }[sec];
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#c2410c';
  window.scrollTo(0, 0);
  if (sec === 'ajustes' || Object.keys(D).length) render();
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => irA(b.dataset.tab)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) irA(g.dataset.goto); });
$('#fab').addEventListener('click', () => abrirSheet());
$('#sheet-close').addEventListener('click', cerrarSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') cerrarSheet(); });
$('#btn-sync').addEventListener('click', cargar);
document.addEventListener('visibilitychange', () => { if (!document.hidden && cfg.token) cargar(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

irA(location.hash === '#run' ? 'run' : 'nutri');
cargar().then(() => { if (location.hash === '#comida' && cfg.token) abrirSheet('comida'); });
