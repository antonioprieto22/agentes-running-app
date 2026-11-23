'use strict';
// Agente Running — PWA. Lee y escribe los CSV del repo privado vía API de GitHub.
// Fotos: Gemini (plan gratuito, clave del usuario). Códigos de barras: Open Food Facts.

const VERSION = '1.4.0';
const TZ = 'Europe/Madrid';
const FILES = {
  perfil: 'perfil.md', plan: 'running/plan.md',
  comidas: 'nutricion/comidas.csv', alimentos: 'nutricion/alimentos.csv', actividad: 'nutricion/actividad.csv',
  entrenos: 'running/entrenos.csv', peso: 'peso.csv', analisis: 'running/analisis.md',
  stravaEstado: 'running/strava-estado.json',
};
const OPCIONALES = new Set(['analisis', 'stravaEstado']);   // pueden no existir todavía
const CLAUDE_URL = 'https://claude.ai/code';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const COMIDAS = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack'];
const EMOJI = { desayuno: '☕', almuerzo: '🥐', comida: '🍽️', merienda: '🍎', cena: '🌙', snack: '🍫' };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = x => { const n = parseFloat(String(x ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const r1 = x => Math.round(x * 10) / 10;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const fmt = n => Math.round(n).toLocaleString('es-ES');

// ---------- configuración ----------
let cfg = {};
try { cfg = JSON.parse(localStorage.getItem('cfg') || '{}'); } catch { cfg = {}; }
cfg = { owner: 'antonioprieto22', repo: 'agentes-running', token: '', gemini: '', gModels: [], ...cfg };
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
const comidaPorHora = h => (h < 12 ? 'desayuno' : h < 17 ? 'comida' : h < 20 ? 'merienda' : 'cena');

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
const limpio = s => String(s ?? '').replace(/[,"\n]/g, ' ').replace(/\s+/g, ' ').trim();

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
  if (res.status === 401) throw new Error('Clave de GitHub no válida o caducada (Ajustes)');
  if (res.status === 404) throw new Error(`No encuentro ${path}: revisa usuario/repo y permisos de la clave`);
  return res;
}
async function getFile(path) {
  const res = await api(`${path}?ref=main&t=${Date.now()}`);
  if (!res.ok) throw new Error(`GitHub ${res.status} al leer ${path}`);
  const j = await res.json();
  return { text: b64dec(j.content), sha: j.sha };
}
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
const upsert = (key, fecha, linea, msg) =>
  modify(key, t => t.split('\n').filter(l => !l.startsWith(fecha + ',')).join('\n').replace(/\n*$/, '\n') + linea + '\n', msg);

// ---------- estado ----------
let D = {};
let seccion = 'nutri';
let abiertas = new Set();      // comidas desplegadas
let macrosAbiertos = false;

async function cargar() {
  if (!cfg.token) { irA('ajustes'); return; }
  const b = $('#btn-sync'); b.classList.add('spin');
  try {
    const pares = await Promise.all(Object.entries(FILES).map(async ([k, p]) =>
      [k, OPCIONALES.has(k) ? await getFile(p).catch(() => ({ text: '', sha: undefined })) : await getFile(p)]));
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

// ---------- cálculos ----------
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

// ---------- render ----------
function render() {
  const { fecha } = ahora();
  $('#fecha').textContent = fechaLarga(fecha);
  const g = $('#goal'), p = perfil();
  g.hidden = seccion !== 'run' || !p.objetivo_carrera;
  if (!g.hidden) {
    const lugar = (p.objetivo_carrera.match(/ de ([^~(]+?) en/) || [])[1] || p.objetivo_carrera;
    const marca = (p.objetivo_carrera.match(/~\s*([\dh:']+)/) || [])[1];
    const dias = /^\d{4}/.test(p.fecha_objetivo || '') ? diasEntre(fecha, p.fecha_objetivo) : null;
    g.textContent = `🏁 ${lugar}${marca ? ' · ' + marca : ''}${dias != null ? ' · ' + dias + ' días' : ''}`;
  }
  if (seccion === 'nutri') renderNutri(fecha);
  if (seccion === 'run') renderRun(fecha);
  if (seccion === 'ajustes') renderAjustes();
}

const ICON_RUN = '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-4 4 1 2 4 3 1M11 15l-2-3"/></svg>';
const ICON_FORK = '<svg viewBox="0 0 24 24"><path d="M7 3v8a3 3 0 0 0 3 3v7M7 3v5M10 3v5M17 3c-2 2-3 5-3 8h3v10"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

const R = 92, CIRC = 2 * Math.PI * R;

function renderNutri(hoy) {
  const n = nutriDia(hoy);
  const ref = n.gasto ?? n.tmb;
  const bal = n.gasto != null ? Math.round(n.t.kcal - n.gasto) : null;
  const restante = Math.round(ref - n.t.kcal);
  const porComida = COMIDAS.map(c => ({ c, rs: n.rows.filter(r => r.comida === c) })).filter(x => x.rs.length);

  $('#v-nutri').innerHTML = `
    <div class="card hero2">
      <button class="ring2" id="ring" aria-label="Ver macros">
        <svg viewBox="0 0 220 220">
          <defs>
            <linearGradient id="gArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#ffb02e"/><stop offset=".55" stop-color="#ff6a00"/><stop offset="1" stop-color="#e11d48"/>
            </linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
          </defs>
          <g transform="rotate(-90 110 110)">
            <circle class="track" cx="110" cy="110" r="${R}"/>
            <circle class="arc" id="arc" cx="110" cy="110" r="${R}" stroke="url(#gArc)" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
            <circle class="tip-glow" id="tipg" cx="${110 + R}" cy="110" r="11" filter="url(#glow)"/>
            <circle class="tip" id="tip" cx="${110 + R}" cy="110" r="7"/>
          </g>
        </svg>
        <div class="ring-lbl">
          <b id="ring-num">0</b>
          <small>de ${fmt(ref)} kcal</small>
          <span class="ring-hint">${ICON_DOWN}</span>
        </div>
      </button>
      <div class="pill-row">
        ${bal != null
          ? `<span class="pill ${bal < 0 ? 'ok' : 'warn'}">${bal < 0 ? 'Déficit' : 'Superávit'} ${fmt(Math.abs(bal))}</span>`
          : `<span class="pill soft">${restante >= 0 ? `Quedan ${fmt(restante)}` : `+${fmt(-restante)} sobre TMB`}</span>
             <button class="pill action" id="btn-cierre">⌚ Cerrar día</button>`}
      </div>
      <div class="macros-panel ${macrosAbiertos ? 'open' : ''}" id="macros">
        <div class="macro-rings">
          ${miniRing('Proteína', n.t.P, n.protRef || 150, '#22c55e')}
          ${miniRing('Hidratos', n.t.HC, Math.max(n.t.HC, 250), '#3b82f6')}
          ${miniRing('Grasa', n.t.G, Math.max(n.t.G, 80), '#eab308')}
        </div>
        <div class="stat-row">
          <div><span>TMB</span><b>${fmt(n.tmb)}</b></div>
          <div><span>Activas</span><b>${n.act ? fmt(num(n.act.kcal_activas)) : '—'}</b></div>
          <div><span>Gasto</span><b>${n.gasto != null ? fmt(n.gasto) : '—'}</b></div>
        </div>
      </div>
    </div>
    ${porComida.length ? porComida.map(({ c, rs }) => {
      const sub = rs.reduce((s, r) => s + num(r.kcal), 0), open = abiertas.has(c);
      return `<div class="meal-card ${open ? 'open' : ''}">
        <button class="meal-top" data-meal="${c}">
          <span class="meal-ico">${EMOJI[c] || '🍴'}</span>
          <span class="grow"><b>${c}</b><small>${rs.length} ${rs.length === 1 ? 'alimento' : 'alimentos'}</small></span>
          <span class="meal-kcal">${fmt(sub)}<small>kcal</small></span>
        </button>
        <div class="meal-items">${rs.map(r => `<div class="item"><span class="grow name">${esc(r.alimento)}${r.fuente === 'estimado' ? ' <span class="tag">est.</span>' : ''}<small class="muted"> · ${esc(r.cantidad_g)} g</small></span>
          <b>${esc(r.kcal)}</b><button class="del" data-del="${encodeURIComponent(r._raw)}" aria-label="Borrar">${ICON_X}</button></div>`).join('')}</div>
      </div>`;
    }).join('') : `<button class="empty-cta" id="empty-add"><span>📷</span><b>Registra tu primera comida</b><small>Haz una foto del plato</small></button>`}`;

  animarAnillo(n.t.kcal, ref);
  $('#ring').addEventListener('click', () => { macrosAbiertos = !macrosAbiertos; $('#macros').classList.toggle('open', macrosAbiertos); });
  $('#btn-cierre')?.addEventListener('click', () => abrirSheet('cierre'));
  $('#empty-add')?.addEventListener('click', () => abrirSheet());
  $$('[data-meal]').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.meal; abiertas.has(c) ? abiertas.delete(c) : abiertas.add(c);
    b.parentElement.classList.toggle('open');
  }));
  $$('[data-del]').forEach(b => b.addEventListener('click', () => borrarComida(decodeURIComponent(b.dataset.del))));
}

function miniRing(nombre, v, ref, color) {
  const r = 26, c = 2 * Math.PI * r, pct = Math.min(1, v / ref);
  return `<div class="mini"><svg viewBox="0 0 64 64"><g transform="rotate(-90 32 32)">
    <circle cx="32" cy="32" r="${r}" stroke="${color}" stroke-opacity=".18" stroke-width="7" fill="none"/>
    <circle cx="32" cy="32" r="${r}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" class="mini-arc"/></g></svg>
    <b>${Math.round(v)}<small>g</small></b><span>${nombre}</span></div>`;
}

// Llenado elástico + contador.
let animId = 0;
function animarAnillo(total, ref) {
  const id = ++animId, pct = Math.min(1, total / ref), t0 = performance.now(), dur = 1400;
  const back = t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const cubic = t => 1 - Math.pow(1 - t, 3);
  const arc = $('#arc'), tip = $('#tip'), tipg = $('#tipg'), numEl = $('#ring-num');
  const frame = now => {
    if (id !== animId || !arc) return;
    const t = Math.min(1, (now - t0) / dur);
    const f = Math.max(0, pct * back(t));
    arc.setAttribute('stroke-dashoffset', CIRC * (1 - Math.min(f, 1.02)));
    const a = 2 * Math.PI * Math.min(f, 1);
    [tip, tipg].forEach(el => { el.setAttribute('cx', 110 + R * Math.cos(a)); el.setAttribute('cy', 110 + R * Math.sin(a)); });
    numEl.textContent = fmt(total * cubic(t));
    if (t < 1) requestAnimationFrame(frame);
  };
  if (total <= 0) { [tip, tipg].forEach(el => (el.style.opacity = 0)); numEl.textContent = '0'; return; }
  requestAnimationFrame(frame);
}

// ---------- Running ----------
let runTab = 'resumen';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const esSesion = x => !/^(descanso|fuerza)/.test(norm(x.sesion));

// km estimados de una sesión del plan (≈7,3 min/km en Z2).
function kmPlan(x) {
  const d = norm(`${x.sesion} ${x.detalle}`);
  const km = d.match(/(\d+(?:[.,]\d+)?)\s*km/);
  if (km) return num(km[1]);
  let reps = 0;
  for (const m of d.matchAll(/(\d+)\s*[x×]\s*(\d+)\s*m\b/g)) reps += (+m[1] * +m[2]) / 1000;
  const mins = [...d.matchAll(/(\d+):00/g)].map(m => +m[1]);
  if (reps) return r1(reps + mins.reduce((a, b) => a + b, 0) / 7);
  return mins.length ? r1(mins[0] / 7.3) : 0;
}

// Análisis guardados en running/analisis.md
const refDe = e => e.strava_id || `${e.fecha}|${e.distancia_km}`;
function analisisDe(e) {
  const txt = D.analisis?.text || '';
  const i = txt.indexOf(`<!-- ref:${refDe(e)} -->`);
  if (i < 0) return null;
  const fin = txt.indexOf('\n## ', i);
  return txt.slice(txt.lastIndexOf('## ', i), fin < 0 ? undefined : fin).trim();
}

const ICON_STRAVA = '<svg viewBox="0 0 24 24" class="strava-svg"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>';
const ICON_GAUGE = '<svg viewBox="0 0 24 24"><path d="M12 14l4-4M3.3 17a9 9 0 1 1 17.4 0"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const RUN_TABS = [['resumen', 'Resumen', ICON_GAUGE], ['sesiones', 'Sesiones', ICON_LIST], ['strava', 'Strava', ICON_STRAVA]];
let ruedaIdx = 0, ruedaN = 0;

function renderRun(hoy, dir) {
  const r = runInfo(hoy), plan = planRows();
  const hechos = new Set(r.all.map(e => e.fecha));
  $('#v-run').innerHTML = `
    <div class="subtabs">${RUN_TABS.map(([k, l, ic]) => `<button data-rt="${k}" class="${runTab === k ? 'on' : ''} ${k}">${ic}<span>${l}</span></button>`).join('')}</div>
    <div id="run-body" class="${dir ? 'slide-' + dir : ''}"></div>`;
  $$('[data-rt]').forEach(b => b.addEventListener('click', () => irRunTab(b.dataset.rt)));
  const body = $('#run-body');

  if (runTab === 'sesiones') {
    body.innerHTML = `<div class="card">${r.all.slice().reverse().map((e, i) => {
      const d = new Date(e.fecha + 'T12:00:00Z'), a = analisisDe(e);
      return `<button class="session as-btn" data-ses="${r.all.length - 1 - i}">
        <div class="date"><small>${DIAS[d.getUTCDay()]}</small><b>${d.getUTCDate()}</b></div>
        <div><b class="cap">${esc(e.tipo)} · ${esc(e.distancia_km)} km</b>
          <div class="muted">${esc(e.ritmo_min_km)}/km · ${esc(e.duracion_min)} min${e.fc_media ? ' · ' + esc(e.fc_media) + ' ppm' : ''}</div></div>
        <span class="tag">${a ? valIcon(a) : e.rpe ? 'RPE ' + esc(e.rpe) : '—'}</span></button>`;
    }).join('') || '<div class="empty">Sin sesiones.</div>'}</div>`;
    $$('[data-ses]').forEach(b => b.addEventListener('click', () => verSesion(r.all[+b.dataset.ses])));
    return;
  }
  if (runTab === 'strava') { renderStrava(body, r); return; }

  // Resumen
  const pend = plan.filter(x => esSesion(x) && (x.fecha > hoy || (x.fecha === hoy && !hechos.has(hoy)))).slice(0, 12);
  ruedaN = pend.length; ruedaIdx = Math.min(ruedaIdx, Math.max(0, ruedaN - 1));
  const lun = lunes(hoy), dom = addDays(lun, 6);
  const semPlan = r1(plan.filter(x => x.fecha >= lun && x.fecha <= dom && esSesion(x)).reduce((s, x) => s + kmPlan(x), 0));
  const semAct = r.semanas.at(-1), maxKm = Math.max(5, semPlan, ...r.semanas.map(s => s.km));
  const pct = semPlan ? Math.min(1, semAct.km / semPlan) : 0;
  const ultima = r.all.filter(e => e.fecha >= addDays(hoy, -3)).at(-1);
  const aUlt = ultima && analisisDe(ultima), fallo = ultima && fallidos.get(refDe(ultima));

  const tarjeta = (x, i) => {
    const d = new Date(x.fecha + 'T12:00:00Z');
    const cuando = x.fecha === hoy ? 'Hoy' : x.fecha === addDays(hoy, 1) ? 'Mañana' : DIAS_LARGOS[d.getUTCDay()];
    return `<div class="next" data-i="${i}">
      <span class="next-when">${cuando} · ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}</span>
      <b class="next-what">${esc(x.sesion)}</b>
      <span class="next-detail">${esc(x.detalle)}</span>
    </div>`;
  };
  let chip = '';
  if (ultima && aUlt) chip = `<button class="analysis-chip ${valClase(aUlt)}" id="chip-an">${valIcon(aUlt)} <span>${esc(tituloAn(aUlt))}</span></button>`;
  else if (ultima && !cfg.gemini) chip = `<button class="analysis-chip" id="chip-an">🔑 <span>Añade la clave de Gemini para analizar tus entrenos</span></button>`;
  else if (ultima && fallo) chip = `<button class="analysis-chip mid" id="chip-an">⚠️ <span>${esc(fallo)} · <u>Reintentar</u></span></button>`;
  else if (ultima) chip = `<div class="analysis-chip"><i class="spinner"></i><span>Analizando tu ${esc(ultima.tipo)} del ${new Date(ultima.fecha + 'T12:00:00Z').getUTCDate()}…</span></div>`;

  body.innerHTML = `${chip}
    <div class="rueda" id="rueda">${pend.map(tarjeta).join('') || '<div class="next pos0"><b class="next-what">Sin sesiones pendientes</b><span class="next-detail">Pide un plan nuevo al agente</span></div>'}
      ${ruedaN > 1 ? `<div class="rueda-dots">${pend.map((_, i) => `<i data-d="${i}"></i>`).join('')}</div>` : ''}
    </div>
    ${ruedaN > 1 ? '<p class="rueda-hint">Desliza ↑↓ para ver más sesiones</p>' : ''}
    <div class="card vol">
      <div class="vol-head"><span>Esta semana</span><span class="pill soft">ACWR ${r.acwr ?? '—'}${r.fiable ? '' : '*'}</span></div>
      <div class="vol-num"><b>${semAct.km}</b><span>/ ${semPlan || '—'} km</span></div>
      <div class="vol-track"><i style="width:${pct * 100}%"></i><span class="runner" style="left:${pct * 100}%">${ICON_RUN}</span></div>
      <div class="weeks2">${r.semanas.map(s => `<div class="wk2 ${s.now ? 'now' : ''}">
        <div class="col2"><i style="height:${(s.km / maxKm) * 100}%"></i>${s.now && semPlan ? `<em style="bottom:${(semPlan / maxKm) * 100}%"></em>` : ''}</div>
        <b>${s.km}</b><span>${s.now ? 'hoy' : new Date(s.lunes + 'T12:00:00Z').getUTCDate() + ' ' + MESES[new Date(s.lunes + 'T12:00:00Z').getUTCMonth()]}</span></div>`).join('')}</div>
    </div>`;

  colocarRueda();
  $$('#rueda .next').forEach(c => c.addEventListener('click', () => { const i = +c.dataset.i; if (i !== ruedaIdx) { ruedaIdx = i; colocarRueda(); } }));
  $('#chip-an')?.addEventListener('click', () => {
    if (aUlt) return verSesion(ultima);
    if (!cfg.gemini) return irA('ajustes');
    fallidos.delete(refDe(ultima)); renderRun(hoy); analizarAuto(ultima);
  });
  if (ultima && !aUlt && !fallo && cfg.gemini) analizarAuto(ultima);
}

// Noria: cada tarjeta se coloca según su distancia a la seleccionada.
function colocarRueda() {
  $$('#rueda .next').forEach(c => {
    const o = +c.dataset.i - ruedaIdx;
    c.className = 'next ' + (o < 0 ? 'gone' : o === 0 ? 'pos0' : o === 1 ? 'pos1' : o === 2 ? 'pos2' : 'hide');
  });
  $$('#rueda-dots i, .rueda-dots i').forEach(d => d.classList.toggle('on', +d.dataset.d === ruedaIdx));
}
function girarRueda(paso) {
  const n = Math.max(0, Math.min(ruedaN - 1, ruedaIdx + paso));
  if (n === ruedaIdx) { $('#rueda')?.classList.add('tope'); setTimeout(() => $('#rueda')?.classList.remove('tope'), 300); return; }
  ruedaIdx = n; colocarRueda(); navigator.vibrate?.(8);
}
function irRunTab(k) {
  const a = RUN_TABS.findIndex(t => t[0] === runTab), b = RUN_TABS.findIndex(t => t[0] === k);
  if (a === b) return;
  runTab = k; renderRun(ahora().fecha, b > a ? 'left' : 'right');
}

// Gestos: horizontal = cambiar de pestaña; vertical sobre la noria = girarla.
function gestos() {
  let x0 = 0, y0 = 0, t0 = 0, enRueda = false;
  const v = $('#v-run');
  v.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); enRueda = !!e.target.closest('#rueda'); }, { passive: true });
  v.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 > 800) return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      const i = RUN_TABS.findIndex(x => x[0] === runTab) + (dx < 0 ? 1 : -1);
      if (RUN_TABS[i]) irRunTab(RUN_TABS[i][0]);
    } else if (enRueda && Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) girarRueda(dy < 0 ? 1 : -1);
  }, { passive: true });
  let bloqueo = 0;
  v.addEventListener('wheel', e => {
    if (!e.target.closest('#rueda') || Date.now() < bloqueo) return;
    e.preventDefault(); bloqueo = Date.now() + 350; girarRueda(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
}

const valClase = a => (/Valoración:\*\* bien/.test(a) ? 'ok' : /Valoración:\*\* regular/.test(a) ? 'mid' : 'bad');
const valIcon = a => ({ ok: '✅', mid: '🟡', bad: '🔧' }[valClase(a)]);
const tituloAn = a => (a.match(/\*\*Valoración:\*\* \w+ — (.+)/) || [])[1] || 'Ver análisis';

function renderStrava(body, r) {
  const sv = r.all.filter(e => e.fuente === 'strava');
  let st = null;
  try { st = JSON.parse(D.stravaEstado?.text || 'null'); } catch { st = null; }
  const fCorta = f => (f ? new Date(f + 'T12:00:00Z').getUTCDate() + ' ' + MESES[new Date(f + 'T12:00:00Z').getUTCMonth()] : '—');
  const u = st?.ultima;
  body.innerHTML = `
    <div class="card strava">
      <div class="strava-head"><a class="strava-logo" href="https://www.strava.com/dashboard" target="_blank" rel="noopener">${ICON_STRAVA}</a>
        <div><b>Strava conectado</b><span class="muted">Se sincroniza solo cada 3 h</span></div>
        <i class="st-dot big on"></i></div>
      ${u ? `<div class="strava-last">
          <span class="muted">Última actividad en tu Strava</span>
          <b>${fCorta(u.fecha)} · ${esc(u.km)} km</b>
          <span class="tag">${u.estado === 'importada' ? 'importada ✓' : 'ya registrada con Mi Fitness'}</span>
        </div>` : ''}
      <div class="stat-row">
        <div><span>Importadas</span><b>${sv.length}</b></div>
        <div><span>Última importada</span><b>${fCorta(sv.at(-1)?.fecha)}</b></div>
        <div><span>Comprobado</span><b id="st-run">—</b></div>
      </div>
      ${u && u.fecha < addDays(ahora().fecha, -2) && r.all.some(e => e.fecha > u.fecha)
        ? `<p class="aviso">⚠️ Tienes entrenos posteriores al ${fCorta(u.fecha)} que no han llegado a Strava. Revisa en Mi Fitness → Perfil → Cuentas vinculadas → Strava.</p>` : ''}
      <button class="btn strava-btn" id="st-sync">${ICON_STRAVA} Sincronizar ahora</button>
      <a class="btn ghost" href="https://www.strava.com/dashboard" target="_blank" rel="noopener">Abrir Strava</a>
    </div>`;
  repoApi('actions/workflows/strava-sync.yml/runs?per_page=1').then(async res => {
    if (!res.ok) return;
    const run = (await res.json()).workflow_runs?.[0]; if (!run) return;
    const min = Math.round((Date.now() - new Date(run.updated_at)) / 60000);
    $('#st-run').textContent = run.conclusion && run.conclusion !== 'success' ? 'error' : min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
  }).catch(() => {});
  $('#st-sync').addEventListener('click', async () => {
    const res = await repoApi('actions/workflows/strava-sync.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) }).catch(() => null);
    if (res?.status === 204) { toast('Sincronizando con Strava… (≈1 min)'); setTimeout(cargar, 75000); }
    else toast('Para sincronizar desde aquí, añade a tu clave de GitHub el permiso "Actions: Read and write"');
  });
}
async function repoApi(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`, {
    ...opts, cache: 'no-store', headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' },
  });
}

// ---------- Análisis del entrenador (Gemini) ----------
const enCurso = new Set();
const fallidos = new Map();   // ref → motivo (no se reintenta solo hasta que lo pidas)
async function analizarAuto(e) {
  const ref = refDe(e);
  if (enCurso.has(ref)) return;
  enCurso.add(ref);
  try { await analizarSesion(e); }
  catch (err) { fallidos.set(ref, err.message); }
  finally { enCurso.delete(ref); if (seccion === 'run' && runTab === 'resumen') renderRun(ahora().fecha); }
}
function promptCoach(e) {
  const p = perfil(), { fecha } = ahora();
  const planTxt = planRows().filter(x => x.fecha >= addDays(fecha, -7)).map(x => `${x.fecha} ${x.dia}: ${x.sesion} — ${x.detalle}`).join('\n');
  const hist = csv('entrenos').rows.filter(x => x.fecha >= addDays(fecha, -35)).map(x =>
    `${x.fecha} ${x.tipo} ${x.distancia_km}km ${x.duracion_min}min ${x.ritmo_min_km}/km FC${x.fc_media || '?'} RPE${x.rpe || '?'} ${x.notas} (${x.fuente})`).join('\n');
  const planHoy = planRows().find(x => x.fecha === e.fecha);
  return `Eres mi entrenador de running (media distancia, prevención de lesiones). Hoy es ${fecha}.
Atleta: ${p.peso_kg} kg, ${p.edad} años. Objetivo: ${p.objetivo_carrera} el ${p.fecha_objetivo}. Días: ${p.dias_entreno}. Molestias: ${p.molestias}.
Zonas: rodajes Z2 con alerta de FC en 148–152 ppm. Mi Fitness es más fiable que Strava (Strava infla la distancia ~2–4 %).
Reglas: progresión prudente (≤10 % de volumen semanal), descarga cada 3–4 semanas, ACWR >1,3 = vigilar. Si hay dolor o molestia: no progresar y recomendar consultar a un profesional. Sin consejos médicos.

SESIÓN A ANALIZAR: ${e.fecha} ${e.tipo} ${e.distancia_km} km en ${e.duracion_min} min (${e.ritmo_min_km}/km), FC media ${e.fc_media || '?'}, desnivel ${e.desnivel_m || '?'}, RPE ${e.rpe || '?'}, notas: "${e.notas}", fuente ${e.fuente}.
Sesión planificada ese día: ${planHoy ? `${planHoy.sesion} — ${planHoy.detalle}` : 'ninguna'}.

Historial 5 semanas:
${hist}

Plan actual:
${planTxt}

Analiza si la sesión se hizo bien respecto a lo planificado (ritmo, FC/zona, volumen, sensaciones) y qué mejorar.
Después decide si hay que ajustar el plan de las próximas semanas. Solo propón cambios si los datos lo justifican; si no, "necesario": false.
Si ajustas: solo fechas posteriores a ${fecha}, máximo 3 semanas, mantén los días de entrenamiento y el estilo del detalle (listo para programar en el reloj, con la alerta de FC).
Responde SOLO JSON:
{"valoracion":"bien|regular|mejorable","titulo":"frase corta (máx 8 palabras)","positivo":["máx 3, frases cortas"],"mejorar":["máx 3, frases cortas"],
"ajuste":{"necesario":false,"motivo":"una frase","sesiones":[{"fecha":"AAAA-MM-DD","dia":"mar","sesion":"rodaje Z2","detalle":"..."}]}}`;
}
async function analizarSesion(e) {
  const out = await geminiJSON(promptCoach(e));
  const v = ['bien', 'regular', 'mejorable'].includes(out.valoracion) ? out.valoracion : 'regular';
  const { fecha } = ahora();
  const ses = (out.ajuste?.necesario && Array.isArray(out.ajuste.sesiones) ? out.ajuste.sesiones : [])
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.fecha) && s.fecha > fecha && s.sesion).slice(0, 21);
  const bloque = [
    `## ${e.fecha} · ${e.tipo} ${e.distancia_km} km <!-- ref:${refDe(e)} -->`,
    `**Valoración:** ${v} — ${limpio(out.titulo || '')}`,
    ...(out.positivo || []).slice(0, 3).map(x => `- ✅ ${limpio(x)}`),
    ...(out.mejorar || []).slice(0, 3).map(x => `- 🔧 ${limpio(x)}`),
    ses.length ? `**Ajuste propuesto:** ${limpio(out.ajuste.motivo || '')}` : '**Ajuste del plan:** no necesario',
    ...ses.map(s => `<!-- plan:${s.fecha}|${limpio(s.dia)}|${limpio(s.sesion)}|${limpio(s.detalle)} -->`),
  ].join('\n');
  await modify('analisis', t => t.replace(/\n*$/, '\n\n') + bloque + '\n', `análisis ${e.fecha} ${e.tipo}`);
  return bloque;
}
function propuestaDe(a) {
  return [...a.matchAll(/<!-- plan:([^|]+)\|([^|]*)\|([^|]*)\|(.*?) -->/g)].map(m => ({ fecha: m[1], dia: m[2], sesion: m[3], detalle: m[4] }));
}
async function aplicarAjuste(e, a) {
  const nuevas = propuestaDe(a), motivo = (a.match(/\*\*Ajuste propuesto:\*\* (.+)/) || [])[1] || '';
  const { fecha } = ahora();
  await modify('plan', t => {
    const ls = t.split('\n');
    const esFila = l => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l);
    const filas = new Map(ls.filter(esFila).map(l => [l.split('|')[1].trim(), l]));
    nuevas.forEach(s => filas.set(s.fecha, `| ${s.fecha} | ${s.dia} | ${s.sesion} | ${s.detalle} |`));
    const ordenadas = [...filas.keys()].sort().map(k => filas.get(k));
    const resto = ls.filter(l => !esFila(l) && !/^Último ajuste/.test(l));
    let iSep = resto.findIndex(l => /^\|\s*-{3}/.test(l));
    if (iSep < 0) { resto.push('', '| fecha | día | sesión | detalle |', '|---|---|---|---|'); iSep = resto.length - 1; }
    resto.splice(iSep + 1, 0, ...ordenadas);
    const iTitulo = resto.findIndex(l => l.startsWith('# '));
    resto.splice(iTitulo + 1, 0, `Último ajuste (${fecha}): ${motivo}`);
    return resto.join('\n');
  }, `ajuste del plan tras ${e.tipo} del ${e.fecha}`);
  await modify('analisis', t => t.replace(`<!-- ref:${refDe(e)} -->`, `<!-- ref:${refDe(e)} --> ✔️ ajuste aplicado`), 'ajuste aplicado');
}

function verSesion(e) {
  const a = analisisDe(e), prop = a ? propuestaDe(a) : [], aplicado = a?.includes('ajuste aplicado');
  $('#sheet').hidden = false;
  $('#sheet-title').textContent = `${e.tipo} · ${e.distancia_km} km`;
  const lineas = a ? a.split('\n').filter(l => l.startsWith('- ')) : [];
  $('#sheet-body').innerHTML = `
    <div class="stat-row">
      <div><span>Ritmo</span><b>${esc(e.ritmo_min_km)}</b></div>
      <div><span>Tiempo</span><b>${esc(e.duracion_min)}'</b></div>
      <div><span>FC</span><b>${esc(e.fc_media || '—')}</b></div>
    </div>
    ${a ? `<div class="an ${valClase(a)}"><b>${valIcon(a)} ${esc(tituloAn(a))}</b>
      ${lineas.map(l => `<p>${esc(l.slice(2))}</p>`).join('')}</div>
      ${prop.length ? `<div class="card plan-prop"><h3>Ajuste del plan ${aplicado ? '· aplicado ✓' : 'propuesto'}</h3>
        <p class="muted">${esc((a.match(/\*\*Ajuste propuesto:\*\* (.+)/) || [])[1] || '')}</p>
        ${prop.map(s => `<div class="item"><span class="tag">${esc(s.dia)} ${new Date(s.fecha + 'T12:00:00Z').getUTCDate()}</span><span class="grow"><b>${esc(s.sesion)}</b><br><small class="muted">${esc(s.detalle)}</small></span></div>`).join('')}
        ${aplicado ? '' : '<button class="btn primary" id="an-apply">Aplicar al plan</button>'}</div>` : '<p class="muted center">El plan sigue igual.</p>'}`
    : `<button class="btn primary" id="an-go">${cfg.gemini ? 'Analizar este entreno' : 'Añade la clave de Gemini en Ajustes'}</button>`}
    ${e.notas ? `<p class="muted">📝 ${esc(e.notas)}</p>` : ''}`;
  $('#an-apply')?.addEventListener('click', async () => {
    $('#an-apply').disabled = true; $('#an-apply').textContent = 'Aplicando…';
    try { await aplicarAjuste(e, a); toast('Plan actualizado ✓'); cerrarSheet(); render(); }
    catch (err) { toast(err.message); $('#an-apply').disabled = false; }
  });
  $('#an-go')?.addEventListener('click', async () => {
    if (!cfg.gemini) { cerrarSheet(); irA('ajustes'); return; }
    $('#an-go').disabled = true; $('#an-go').textContent = 'Analizando…';
    try { await analizarSesion(e); verSesion(e); } catch (err) { toast(err.message); $('#an-go').disabled = false; }
  });
}

function renderAjustes() {
  $('#v-ajustes').innerHTML = `
    <div class="card stack">
      <h3>Conexión con tus datos (GitHub)</h3>
      <label>Usuario<input id="c-owner" value="${esc(cfg.owner)}" autocapitalize="off"></label>
      <label>Repositorio<input id="c-repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      <label>Clave (token)<input id="c-token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocapitalize="off"></label>
    </div>
    <div class="card stack">
      <h3>Análisis de fotos (Gemini, gratis)</h3>
      <label>Clave de Gemini<input id="c-gem" type="password" value="${esc(cfg.gemini)}" placeholder="AIza…" autocapitalize="off"></label>
      <ol class="steps">
        <li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> con tu cuenta de Google.</li>
        <li>Pulsa <b>Create API key</b> (no pide tarjeta), cópiala y pégala arriba.</li>
      </ol>
      <p class="muted">Plan gratuito: Google puede usar las fotos para mejorar sus productos.${cfg.gModels?.length ? ` Modelo: ${esc(cfg.gModels[0].replace('models/', ''))}.` : ''}</p>
    </div>
    <button class="btn primary" id="c-save">Guardar y conectar</button>
    <div class="card stack">
      <h3>Clave de GitHub (una vez)</h3>
      <ol class="steps">
        <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
        <li>Repository access: <b>Only select repositories</b> → <b>agentes-running</b>.</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b> → <b>Generate token</b>.</li>
      </ol>
    </div>
    <div class="card stack">
      <button class="btn ghost" id="c-install" hidden>Instalar en la pantalla de inicio</button>
      <a class="btn ghost" href="${CLAUDE_URL}" target="_blank" rel="noopener">Abrir el agente (Claude Code)</a>
      <p class="muted">Versión ${VERSION}</p>
    </div>`;
  $('#c-save').addEventListener('click', () => {
    const gem = $('#c-gem').value.trim();
    if (gem !== cfg.gemini) cfg.gModels = [];
    Object.assign(cfg, { owner: $('#c-owner').value.trim(), repo: $('#c-repo').value.trim(), token: $('#c-token').value.trim(), gemini: gem });
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

// ---------- hoja "Añadir" ----------
let plato = [];            // alimentos pendientes de guardar
let comidaSel = null;
let stream = null;

function abrirSheet(vista) {
  $('#sheet').hidden = false;
  if (seccion === 'run') { $('#sheet-title').textContent = 'Registrar entreno'; $('#sheet-body').innerHTML = '<div id="seg-body"></div>'; formEntreno(); return; }
  comidaSel ??= comidaPorHora(ahora().h);
  if (vista === 'cierre') return vistaCierre();
  if (vista === 'peso') return vistaPeso();
  vistaInicio();
}
function cerrarSheet() { pararCamara(); $('#sheet').hidden = true; }

function cabeceraComida() {
  return `<div class="chips meal-chips">${COMIDAS.map(c => `<button class="chip ${c === comidaSel ? 'on' : ''}" data-cs="${c}">${EMOJI[c]} ${c}</button>`).join('')}</div>`;
}
function bindCabecera(rerender) {
  $$('[data-cs]').forEach(b => b.addEventListener('click', () => { comidaSel = b.dataset.cs; rerender(); }));
}

function vistaInicio() {
  $('#sheet-title').textContent = 'Añadir';
  $('#sheet-body').innerHTML = `
    ${cabeceraComida()}
    <p class="photo-title">Foto del plato · la IA detecta alimentos y kcal</p>
    <div class="photo-pick">
      <label class="tile hero-tile" for="foto-in"><span class="tile-ico">📷</span><b>Hacer foto</b>
        <input type="file" id="foto-in" accept="image/*" capture="environment" hidden></label>
      <label class="tile hero-tile alt" for="gal-in"><span class="tile-ico">🖼️</span><b>Galería</b>
        <input type="file" id="gal-in" accept="image/*" hidden></label>
    </div>
    <div class="tiles">
      <button class="tile" data-v="barras"><span class="tile-ico">▥</span><b>Código de barras</b></button>
      <button class="tile" data-v="texto"><span class="tile-ico">✍️</span><b>Describir</b></button>
      <button class="tile" data-v="base"><span class="tile-ico">📚</span><b>Mi base</b></button>
      <button class="tile" data-v="peso"><span class="tile-ico">⚖️</span><b>Peso</b></button>
      <button class="tile" data-v="cierre"><span class="tile-ico">⌚</span><b>Cerrar día</b></button>
    </div>
    ${platoHTML()}`;
  bindCabecera(vistaInicio);
  bindPlato(vistaInicio);
  $('#foto-in').addEventListener('change', e => e.target.files[0] && analizarFoto(e.target.files[0]));
  $('#gal-in').addEventListener('change', e => e.target.files[0] && analizarFoto(e.target.files[0]));
  $$('[data-v]').forEach(b => b.addEventListener('click', () => ({
    barras: vistaBarras, texto: vistaTexto, base: vistaBase, peso: vistaPeso, cierre: vistaCierre,
  })[b.dataset.v]()));
}

function volver() { return `<button class="back" id="back">‹ Volver</button>`; }
function bindVolver() { $('#back')?.addEventListener('click', () => { pararCamara(); vistaInicio(); }); }

// Plato (carrito) compartido por todas las vías.
function platoHTML() {
  if (!plato.length) return '';
  const tot = plato.reduce((s, x) => s + x.kcal, 0);
  return `<div class="plato">
    <div class="plato-head"><b>${EMOJI[comidaSel]} Tu ${comidaSel}</b><span>${fmt(tot)} kcal</span></div>
    ${plato.map((x, i) => `<div class="item"><span class="grow name">${esc(x.alimento)}${x.fuente === 'estimado' ? ' <span class="tag">est.</span>' : ''}</span>
      <input class="g-in" type="number" inputmode="decimal" value="${x.cantidad_g}" data-gi="${i}" aria-label="gramos"><small class="muted">g</small>
      <b class="kc">${x.kcal}</b><button class="del" data-pi="${i}">${ICON_X}</button></div>`).join('')}
    <button class="btn primary" id="plato-save">Guardar ${comidaSel} · ${fmt(tot)} kcal</button>
  </div>`;
}
function bindPlato(rerender) {
  $$('[data-pi]').forEach(b => b.addEventListener('click', () => { plato.splice(+b.dataset.pi, 1); rerender(); }));
  $$('[data-gi]').forEach(inp => inp.addEventListener('change', () => { escalar(plato[+inp.dataset.gi], num(inp.value)); rerender(); }));
  $('#plato-save')?.addEventListener('click', guardarPlato);
}
function escalar(x, g) {
  if (!g || !x.cantidad_g) return;
  const k = g / x.cantidad_g;
  Object.assign(x, { cantidad_g: Math.round(g), kcal: Math.round(x.kcal * k), prot_g: r1(x.prot_g * k), hc_g: r1(x.hc_g * k), grasa_g: r1(x.grasa_g * k) });
}
async function guardarPlato() {
  const { fecha, hora } = ahora(), { header } = csv('comidas'), btn = $('#plato-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await appendLines('comidas', plato.map(x => toLine(header, { fecha, hora, comida: comidaSel, ...x, alimento: limpio(x.alimento) })),
      `${comidaSel} (${plato.length} alimentos)`);
    plato = []; abiertas.add(comidaSel); cerrarSheet(); toast('Comida guardada ✓'); render();
  } catch (e) { toast(e.message); btn.disabled = false; }
}
// Si el alimento está en la base, se usan sus valores (fuente=base).
function desdeBase(nombre, g) {
  const a = csv('alimentos').rows.find(x => norm(x.alimento) === norm(nombre) || x.alias.split('|').some(al => al && norm(al) === norm(nombre)));
  if (!a) return null;
  const k = g / 100;
  return { alimento: a.alimento, cantidad_g: Math.round(g), kcal: Math.round(num(a.kcal_100g) * k), prot_g: r1(num(a.prot_100g) * k),
    hc_g: r1(num(a.hc_100g) * k), grasa_g: r1(num(a.grasa_100g) * k), fuente: 'base' };
}

// ---------- Foto / texto con Gemini ----------
async function fotoBase64(file) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
// Modelos Flash disponibles para la clave, del más nuevo al más ligero (respaldo si uno está saturado).
async function modelosGemini() {
  if (cfg.gModels?.length && Date.now() - (cfg.gModelsT || 0) < 7 * 864e5) return cfg.gModels;
  const r = await fetch(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(cfg.gemini)}`);
  if (!r.ok) throw new Error('Clave de Gemini no válida (Ajustes)');
  const ms = ((await r.json()).models || []).map(m => m.name).filter(n => /gemini-[\d.]+-flash(-lite)?$/.test(n.replace('models/', '')));
  const ver = n => parseFloat((n.match(/gemini-([\d.]+)/) || [])[1] || 0);
  ms.sort((a, b) => (a.includes('lite') - b.includes('lite')) || ver(b) - ver(a));
  if (!ms.length) throw new Error('No encuentro un modelo Gemini Flash disponible');
  cfg.gModels = ms.slice(0, 4); cfg.gModelsT = Date.now(); saveCfg(); return cfg.gModels;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
function promptNutri(texto) {
  const base = csv('alimentos').rows.map(a => a.alimento).join(', ');
  return `Eres un nutricionista deportivo. Analiza ${texto ? 'la descripción' : 'la foto'} de una comida y desglosa cada ingrediente.
Reglas:
- Gramos en el "tope alto realista" (mejor pasarse que quedarse corto).
- No añadas aceite, mantequilla ni salsas si no son evidentes; si se ven o se mencionan, inclúyelos como ingrediente aparte.
- La sal aporta 0 kcal.
- Si un ingrediente coincide con uno de esta base, usa exactamente ese nombre: ${base}.
- Nombres cortos en español, sin comas.
${texto ? `Descripción del usuario: "${texto}"` : ''}
Responde SOLO con JSON: {"plato":"nombre corto","items":[{"alimento":"","cantidad_g":0,"kcal":0,"prot_g":0,"hc_g":0,"grasa_g":0}],"nota":"una frase breve, p. ej. si hay mucho sodio"}`;
}
async function preguntarGemini(texto, dataUrl) {
  const out = await geminiJSON(promptNutri(texto), dataUrl);
  if (!Array.isArray(out.items) || !out.items.length) throw new Error('No he reconocido alimentos; prueba con otra foto o descríbelo');
  return out;
}
async function geminiJSON(prompt, dataUrl) {
  if (!cfg.gemini) throw new Error('Añade tu clave gratuita de Gemini en Ajustes');
  const parts = [{ text: prompt }];
  if (dataUrl) parts.push({ inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } });
  const body = JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } });
  let ultimo = 0;
  for (const model of await modelosGemini()) {
    for (let intento = 0; intento < 2; intento++) {
      let r;
      try { r = await fetch(`${GEMINI}/${model}:generateContent?key=${encodeURIComponent(cfg.gemini)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
      catch { throw new Error('Sin conexión con Gemini'); }
      if (r.ok) {
        const j = await r.json();
        const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
        try { return JSON.parse(txt); } catch { ultimo = 'json'; break; }
      }
      ultimo = r.status;
      if (r.status === 400 || r.status === 403) throw new Error('Clave de Gemini no válida (Ajustes)');
      if (r.status === 404) { cfg.gModels = []; saveCfg(); break; }           // modelo retirado → siguiente
      if ([429, 500, 503].includes(r.status)) { await dormir(1500 * (intento + 1)); continue; } // saturado → reintenta
      break;
    }
  }
  throw new Error(ultimo === 429 ? 'Límite gratuito de Gemini alcanzado por hoy o por minuto; prueba en un rato'
    : ultimo === 503 || ultimo === 500 ? 'Gemini está saturado ahora mismo; inténtalo en unos minutos'
    : `No se pudo completar con Gemini (${ultimo})`);
}
function añadirResultado(out) {
  for (const it of out.items) {
    const g = num(it.cantidad_g);
    plato.push(desdeBase(it.alimento, g) || {
      alimento: limpio(it.alimento), cantidad_g: Math.round(g), kcal: Math.round(num(it.kcal)), prot_g: r1(num(it.prot_g)),
      hc_g: r1(num(it.hc_g)), grasa_g: r1(num(it.grasa_g)), fuente: 'estimado',
    });
  }
}
async function analizarFoto(file) {
  const dataUrl = await fotoBase64(file);
  $('#sheet-title').textContent = 'Analizando…';
  $('#sheet-body').innerHTML = `<div class="scan"><img src="${dataUrl}" alt=""><i class="scan-line"></i></div>
    <p class="muted center">Detectando alimentos y raciones…</p>`;
  try {
    const out = await preguntarGemini('', dataUrl);
    añadirResultado(out);
    vistaInicio();
    toast(`${out.plato || 'Plato'} · ${out.items.length} alimentos${out.nota ? ' · ' + out.nota : ''}`);
  } catch (e) { toast(e.message); vistaInicio(); }
}
function vistaTexto() {
  $('#sheet-title').textContent = 'Describir';
  $('#sheet-body').innerHTML = `${volver()}${cabeceraComida()}
    <div class="stack"><textarea id="t-desc" rows="3" placeholder="p. ej. plato de lentejas con chorizo y un trozo de pan"></textarea>
    <button class="btn primary" id="t-go">Analizar</button></div>${platoHTML()}`;
  bindVolver(); bindCabecera(vistaTexto); bindPlato(vistaTexto);
  $('#t-go').addEventListener('click', async () => {
    const t = $('#t-desc').value.trim(); if (!t) return;
    $('#t-go').disabled = true; $('#t-go').textContent = 'Analizando…';
    try { const out = await preguntarGemini(t); añadirResultado(out); vistaInicio(); toast(`${out.items.length} alimentos añadidos`); }
    catch (e) { toast(e.message); $('#t-go').disabled = false; $('#t-go').textContent = 'Analizar'; }
  });
}

// ---------- Código de barras (Open Food Facts) ----------
function pararCamara() { stream?.getTracks().forEach(t => t.stop()); stream = null; }
async function vistaBarras() {
  $('#sheet-title').textContent = 'Código de barras';
  $('#sheet-body').innerHTML = `${volver()}
    <div class="scan cam"><video id="cam" playsinline muted></video><i class="scan-line"></i></div>
    <div class="row2"><input id="bc-in" inputmode="numeric" placeholder="o escribe el código"><button class="btn primary" id="bc-go">Buscar</button></div>
    <div id="bc-res"></div>`;
  bindVolver();
  $('#bc-go').addEventListener('click', () => buscarCodigo($('#bc-in').value.trim()));
  if (!('BarcodeDetector' in window)) { $('#cam').parentElement.hidden = true; return; }
  try {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#cam'); v.srcObject = stream; await v.play();
    const loop = async () => {
      if (!stream) return;
      const codes = await det.detect(v).catch(() => []);
      if (codes.length) { navigator.vibrate?.(60); pararCamara(); buscarCodigo(codes[0].rawValue); return; }
      setTimeout(loop, 250);
    };
    loop();
  } catch { $('#cam').parentElement.hidden = true; toast('Sin acceso a la cámara: escribe el código'); }
}
async function buscarCodigo(code) {
  if (!/^\d{6,14}$/.test(code)) return toast('Código no válido');
  $('#bc-res').innerHTML = '<p class="muted center">Buscando…</p>';
  let j;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_es,brands,nutriments,serving_quantity`);
    j = await r.json();
  } catch { $('#bc-res').innerHTML = '<p class="muted center">Sin conexión con Open Food Facts.</p>'; return; }
  if (j.status !== 1) { $('#bc-res').innerHTML = '<p class="muted center">Producto no encontrado. Prueba con foto o descríbelo.</p>'; return; }
  const p = j.product, nu = p.nutriments || {};
  pickerAlimento({
    alimento: limpio([p.product_name_es || p.product_name, p.brands?.split(',')[0]].filter(Boolean).join(' ')).slice(0, 60) || `producto ${code}`,
    kcal_100g: num(nu['energy-kcal_100g']), prot_100g: num(nu.proteins_100g), hc_100g: num(nu.carbohydrates_100g), grasa_100g: num(nu.fat_100g),
    racion_g: num(p.serving_quantity) || 100, codigo: code,
  }, '#bc-res', true);
}

// ---------- Base propia ----------
function vistaBase() {
  const base = csv('alimentos').rows, usos = {};
  csv('comidas').rows.slice(-200).forEach(r => (usos[r.alimento] = (usos[r.alimento] || 0) + 1));
  $('#sheet-title').textContent = 'Mi base';
  $('#sheet-body').innerHTML = `${volver()}<input id="f-q" placeholder="Buscar…" autocomplete="off"><div id="f-pick"></div><div class="results" id="f-res"></div>`;
  bindVolver();
  const pintar = () => {
    const q = norm($('#f-q').value);
    const lista = base.filter(a => !q || norm(a.alimento).includes(q) || norm(a.alias).includes(q))
      .sort((a, b) => (usos[b.alimento] || 0) - (usos[a.alimento] || 0)).slice(0, 10);
    $('#f-res').innerHTML = lista.map(a => `<button class="result" data-i="${base.indexOf(a)}"><span>${esc(a.alimento)}</span><span class="muted">${esc(a.kcal_100g)} kcal/100 g</span></button>`).join('');
    $$('#f-res [data-i]').forEach(b => b.addEventListener('click', () => pickerAlimento(base[+b.dataset.i], '#f-pick', false)));
  };
  $('#f-q').addEventListener('input', pintar); pintar();
}
function pickerAlimento(a, dest, ofrecerGuardar) {
  const rg = num(a.racion_g) || 100;
  $(dest).innerHTML = `<div class="picked"><b>${esc(a.alimento)}</b><span class="muted">${fmt(num(a.kcal_100g))} kcal · P${r1(num(a.prot_100g))} · HC${r1(num(a.hc_100g))} · G${r1(num(a.grasa_100g))} por 100 g</span>
    <div class="chips">${[0.5, 1, 2].map(m => `<button class="chip" data-m="${m}">${m === 0.5 ? '½' : m} ración</button>`).join('')}<button class="chip" data-g="100">100 g</button></div>
    <div class="row2"><input id="p-g" type="number" inputmode="decimal" value="${rg}"><button class="btn primary" id="p-add">Añadir</button></div>
    ${ofrecerGuardar ? '<label class="check"><input type="checkbox" id="p-save-base" checked> Guardar en mi base</label>' : ''}</div>`;
  $$('[data-m]', $(dest)).forEach(b => b.addEventListener('click', () => ($('#p-g').value = r1(rg * +b.dataset.m))));
  $$('[data-g]', $(dest)).forEach(b => b.addEventListener('click', () => ($('#p-g').value = b.dataset.g)));
  $('#p-add').addEventListener('click', async () => {
    const g = num($('#p-g').value); if (!g) return;
    const k = g / 100;
    plato.push({ alimento: a.alimento, cantidad_g: Math.round(g), kcal: Math.round(num(a.kcal_100g) * k), prot_g: r1(num(a.prot_100g) * k),
      hc_g: r1(num(a.hc_100g) * k), grasa_g: r1(num(a.grasa_100g) * k), fuente: ofrecerGuardar ? 'estimado' : 'base' });
    if (ofrecerGuardar && $('#p-save-base')?.checked && !csv('alimentos').rows.some(x => norm(x.alimento) === norm(a.alimento))) {
      const { header } = csv('alimentos');
      appendLines('alimentos', [toLine(header, { alimento: a.alimento, alias: a.codigo, kcal_100g: a.kcal_100g, prot_100g: a.prot_100g,
        hc_100g: a.hc_100g, grasa_100g: a.grasa_100g, racion_desc: '1 ración', racion_g: rg })], `alimento ${a.alimento}`)
        .then(() => { plato.at(-1).fuente = 'base'; }).catch(() => {});
    }
    toast(`${a.alimento} añadido`); vistaInicio();
  });
}

// ---------- Peso y cierre ----------
function vistaPeso() {
  $('#sheet-title').textContent = 'Peso';
  $('#sheet-body').innerHTML = `${volver()}<div class="stack"><div class="big-input"><input id="p-kg" type="number" inputmode="decimal" step="0.1" placeholder="82.6"><span>kg</span></div>
    <button class="btn primary" id="p-save">Guardar peso</button></div>`;
  bindVolver();
  $('#p-save').addEventListener('click', async () => {
    const kg = num($('#p-kg').value); if (!kg) return;
    const { fecha } = ahora();
    try { await upsert('peso', fecha, `${fecha},${r1(kg)}`, `peso ${kg}`); cerrarSheet(); toast('Peso guardado ✓'); render(); }
    catch (e) { toast(e.message); }
  });
}
function vistaCierre() {
  const { fecha } = ahora(), act = csv('actividad').rows.find(r => r.fecha === fecha);
  $('#sheet-title').textContent = 'Cerrar el día';
  $('#sheet-body').innerHTML = `${volver()}<div class="stack">
    <div class="row2"><div class="big-input"><input id="c-pasos" type="number" inputmode="numeric" value="${esc(act?.pasos || '')}" placeholder="14000"><span>pasos</span></div>
    <div class="big-input"><input id="c-kcal" type="number" inputmode="numeric" value="${esc(act?.kcal_activas || '')}" placeholder="700"><span>kcal activas</span></div></div>
    <button class="btn primary" id="c-ok">Cerrar el día</button></div>`;
  bindVolver();
  $('#c-ok').addEventListener('click', async () => {
    const pasos = Math.round(num($('#c-pasos').value)), kcal = Math.round(num($('#c-kcal').value));
    if (!kcal) return toast('Indica las kcal activas');
    try {
      await upsert('actividad', fecha, `${fecha},${pasos},${kcal}`, `cierre ${fecha}`);
      cerrarSheet(); render();
      const n = nutriDia(fecha), bal = Math.round(n.t.kcal - n.gasto);
      toast(`Día cerrado · ${bal < 0 ? 'déficit' : 'superávit'} ${fmt(Math.abs(bal))} kcal`);
    } catch (e) { toast(e.message); }
  });
}

// ---------- Entreno ----------
function formEntreno() {
  const { fecha } = ahora();
  const plan = planRows().find(p => p.fecha === fecha);
  $('#seg-body').innerHTML = `<div class="stack">
    <p class="photo-title">Captura del reloj o de Strava · se rellena sola</p>
    <div class="photo-pick">
      <label class="tile hero-tile run-tile" for="e-cam"><span class="tile-ico">📷</span><b>Hacer foto</b>
        <input type="file" id="e-cam" accept="image/*" capture="environment" hidden></label>
      <label class="tile hero-tile alt run-alt" for="e-gal"><span class="tile-ico">🖼️</span><b>Galería</b>
        <input type="file" id="e-gal" accept="image/*" hidden></label>
    </div>
    <p class="muted center" id="e-estado"></p>
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
  const leerCaptura = async file => {
    $('#e-estado').innerHTML = '<i class="spinner"></i> Leyendo la captura…';
    try {
      const x = await geminiJSON(`Extrae los datos de esta captura de una app o reloj de running (Mi Fitness, Strava, Xiaomi…).
Responde SOLO JSON: {"fecha":"AAAA-MM-DD o null","tipo":"rodaje|series|tempo|tirada|fartlek|cuestas|competicion","distancia_km":0,"duracion_min":0,"fc_media":null,"fc_max":null,"cadencia":null,"desnivel_m":null,"extra":"parciales u otros datos útiles, breve"}
duracion_min en minutos decimales (tiempo en movimiento si aparece). Usa null si un dato no aparece.`, await fotoBase64(file));
      if (x.fecha && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha)) $('#e-f').value = x.fecha;
      if (x.tipo) $('#e-tipo').value = x.tipo;
      if (x.distancia_km) $('#e-km').value = r1(num(x.distancia_km) * 100) / 100;
      if (x.duracion_min) { const m = num(x.duracion_min); $('#e-t').value = `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`; }
      if (x.fc_media) $('#e-fc').value = Math.round(num(x.fc_media));
      const extra = [x.fc_max && `FC máx ${x.fc_max}`, x.cadencia && `cadencia ${x.cadencia}`, x.desnivel_m && `D+${x.desnivel_m}`, x.extra].filter(Boolean).map(limpio).join('; ');
      if (extra) $('#e-notas').value = extra;
      $('#e-estado').textContent = '✓ Datos leídos. Añade tu RPE y sensaciones y guarda.';
    } catch (err) { $('#e-estado').textContent = err.message; }
  };
  ['#e-cam', '#e-gal'].forEach(s => $(s).addEventListener('change', ev => ev.target.files[0] && leerCaptura(ev.target.files[0])));

  $('#e-save').addEventListener('click', async () => {
    const f = $('#e-f').value, km = num($('#e-km').value), rpe = Math.round(num($('#e-rpe').value));
    const [mm, ss] = $('#e-t').value.split(':'), min = r1(num(mm) + num(ss) / 60);
    const notas = limpio($('#e-notas').value);
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
      // Análisis del entrenador sobre la sesión guardada
      const guardada = csv('entrenos').rows.filter(r => r.fecha === f).at(-1);
      if (guardada && cfg.gemini) {
        $('#e-save').disabled = true; $('#e-save').innerHTML = '<i class="spinner"></i> Analizando el entreno…';
        try { await analizarSesion(guardada); runTab = 'resumen'; render(); verSesion(guardada); return; }
        catch (err) { toast(err.message); }
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
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === sec));
  $('#titulo').textContent = { nutri: 'Nutrición', run: 'Running', ajustes: 'Ajustes' }[sec];
  document.querySelector('meta[name=theme-color]').content = (matchMedia('(prefers-color-scheme: dark)').matches ? '#000000' : getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#ff6a00');
  window.scrollTo(0, 0);
  if (sec === 'ajustes' || Object.keys(D).length) render();
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3800); }

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

$$('.tabs button').forEach(b => b.addEventListener('click', () => irA(b.dataset.tab)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) irA(g.dataset.goto); });
$('#fab').addEventListener('click', () => abrirSheet());
$('#sheet-close').addEventListener('click', cerrarSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') cerrarSheet(); });
$('#btn-sync').addEventListener('click', cargar);
document.addEventListener('visibilitychange', () => { if (!document.hidden && cfg.token && $('#sheet').hidden) cargar(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

gestos();
irA(location.hash === '#run' ? 'run' : 'nutri');
cargar().then(() => { if (location.hash === '#comida' && cfg.token) abrirSheet(); });
