'use strict';
// Compatibilidad con Safari/iPadOS antiguos (< 15.4): Array.prototype.at
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', { value(i) { i = Math.trunc(i) || 0; return this[i < 0 ? this.length + i : i]; }, configurable: true, writable: true });
}
// APEX — PWA. Lee y escribe los CSV del repo privado vía API de GitHub.
// Fotos: Gemini (plan gratuito, clave del usuario). Códigos de barras: Open Food Facts.

const VERSION = '2.11.0';
const TZ = 'Europe/Madrid';
const FILES = {
  perfil: 'perfil.md', plan: 'running/plan.md',
  comidas: 'nutricion/comidas.csv', alimentos: 'nutricion/alimentos.csv', actividad: 'nutricion/actividad.csv',
  entrenos: 'running/entrenos.csv', peso: 'peso.csv', analisis: 'running/analisis.md',
  stravaEstado: 'running/strava-estado.json', stravaReg: 'running/strava.csv',
  fuerza: 'fuerza/sesiones.csv', rutinas: 'fuerza/rutinas.md', valoraciones: 'nutricion/valoraciones.csv',
  recuperacion: 'running/recuperacion.csv',
};
const OPCIONALES = new Set(['analisis', 'stravaEstado', 'stravaReg', 'fuerza', 'rutinas', 'valoraciones', 'recuperacion']);   // pueden no existir todavía
const CLAUDE_URL = 'https://claude.ai/code';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const COMIDAS = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack'];
// Iconos de línea (sustituyen a los emojis)
const L = p => `<svg viewBox="0 0 24 24" class="li">${p}</svg>`;
const EMOJI = {
  desayuno: L('<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5"/>'),
  almuerzo: L('<path d="M4 15c0-4 3.6-7 8-7s8 3 8 7z"/><path d="M3 15h18M8 11.5l1 3.5M12 10.5v4.5M16 11.5l-1 3.5"/>'),
  comida: L('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/><path d="M2.5 4v5M2.5 9v11M21.5 4c-1.5 1-2 3.5-2 6h2M21.5 4v16"/>'),
  merienda: L('<path d="M12 7c-1.5-2.5-6-3-7.5 1C3 12 6 20 9.5 20c1 0 1.5-.5 2.5-.5s1.5.5 2.5.5C18 20 21 12 19.5 8 18 4 13.5 4.5 12 7z"/><path d="M12 7c0-2 1-3.5 2.5-4"/>'),
  cena: L('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  snack: L('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M5 9.5h14M5 14.5h14M12 4v16"/>'),
};
const ICO = {
  apex: L('<path d="M4.5 19.5 12 5l7.5 14.5"/>'),
  barras: L('<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>'),
  medalla: L('<circle cx="12" cy="15" r="5"/><path d="M8.5 3.5 11 10M15.5 3.5 13 10M7 3.5h3.5M13.5 3.5H17"/>'),
  pesa: L('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  meta: L('<path d="M5 21V4M5 4h11l-2 3.5L16 11H5"/>'),
  llave: L('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>'),
  aviso: L('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  ok: L('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>'),
  medio: L('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  mejora: L('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>'),
  reloj: L('<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5l1-3.5h4l1 3.5M9 17.5l1 3.5h4l1-3.5M12 10v2.2l1.3 1"/>'),
  trofeo: L('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>'),
  play: '<svg viewBox="0 0 24 24" class="li fill"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" class="li fill"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  saltar: '<svg viewBox="0 0 24 24" class="li fill"><path d="M5 5.5v13l9-6.5zM16 5.5h3v13h-3z"/></svg>',
};

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
const etags = new Map();   // ruta → { etag, text, sha } (solo en memoria)
async function getFile(path) {
  const prev = etags.get(path);
  const res = await api(`${path}?ref=main`, prev ? { headers: { 'If-None-Match': prev.etag } } : {});
  if (res.status === 304 && prev) return { text: prev.text, sha: prev.sha };   // sin cambios: no se descarga
  if (!res.ok) throw new Error(`GitHub ${res.status} al leer ${path}`);
  const j = await res.json();
  const out = { text: b64dec(j.content), sha: j.sha };
  const et = res.headers.get('ETag');
  if (et) etags.set(path, { etag: et, ...out }); else etags.delete(path);
  return out;
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
    if (res.ok) { const j = await res.json(); D[key] = { text, sha: j.content.sha }; etags.delete(FILES[key]); return; }
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
let ultimaCarga = 0;   // marca de la última carga completa de datos
let abiertas = new Set();      // comidas desplegadas
let macrosAbiertos = false;
let balDia = null;
let balVolteado = false;    // día cerrado: se ve la rueda (true) o el balance (false)

async function cargar() {
  if (!cfg.token) { irA('ajustes'); return; }
  const b = $('#btn-sync'); b.classList.add('spin');
  try {
    const pares = await Promise.all(Object.entries(FILES).map(async ([k, p]) =>
      [k, OPCIONALES.has(k) ? await getFile(p).catch(() => ({ text: '', sha: undefined })) : await getFile(p)]));
    D = Object.fromEntries(pares);
    ultimaCarga = Date.now();
    render();
  } catch (e) { toast(e.message); if (!Object.keys(D).length) irA('ajustes'); }
  finally { b.classList.remove('spin'); }
}
function perfil() { return memoizar('perfil', D.perfil?.text || '', leerPerfil); }
function leerPerfil() {
  const o = {};
  for (const m of (D.perfil?.text || '').matchAll(/^\s*-\s*([a-z_]+)\s*:\s*(.*)$/gim)) o[m[1].toLowerCase()] = m[2].replace(/\s+#.*$/, '').trim();
  return o;
}
function planRows() { return memoizar('plan', D.plan?.text || '', leerPlan); }
function leerPlan() {
  return (D.plan?.text || '').split(/\r?\n/).filter(l => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l)).map(l => {
    const [fecha, dia, sesion, detalle] = l.split('|').slice(1).map(s => s.trim());
    return { fecha, dia, sesion, detalle };
  });
}
// Memo: cada archivo se procesa una vez y se reutiliza mientras su texto no cambie.
const memo = new Map();
const memoizar = (clave, texto, fn) => { const m = memo.get(clave); if (m && m.t === texto) return m.v; const v = fn(texto); memo.set(clave, { t: texto, v }); return v; };
const csv = k => memoizar('csv:' + k, D[k]?.text || '', parseCsv);

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
    g.innerHTML = `${ICO.meta}<span>${esc(lugar)}${marca ? ' · ' + esc(marca) : ''}${dias != null ? ' · ' + dias + ' días' : ''}</span>`;
  }
  if (seccion === 'nutri') renderNutri(fecha);
  if (seccion === 'run') renderRun(fecha);
  if (seccion === 'fuerza') renderFuerza(fecha);
  if (seccion === 'ajustes') renderAjustes();
}

const ICON_RUN = '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-4 4 1 2 4 3 1M11 15l-2-3"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

const R = 92, CIRC = 2 * Math.PI * R;

function renderNutri(hoy) {
  const n = nutriDia(hoy);
  const ref = n.gasto ?? n.tmb;
  const bal = n.gasto != null ? Math.round(n.t.kcal - n.gasto) : null;
  const restante = Math.round(ref - n.t.kcal);
  const porComida = COMIDAS.map(c => ({ c, rs: n.rows.filter(r => r.comida === c) })).filter(x => x.rs.length);
  const vals = Object.fromEntries(csv('valoraciones').rows.filter(v => v.fecha === hoy && v.texto).map(v => [v.comida, v]));
  const vistas = valVistas();

  // Día cerrado → el balance es lo principal de la pantalla.
  const def = bal != null && bal < 0;
  const balanceHero = bal == null ? '' : `
    <button class="balance ${def ? 'def' : 'sup'}" id="bal-hero">
      <span class="bal-label">${def ? 'Déficit' : 'Superávit'} del día</span>
      <b class="bal-num"><span id="bal-num">0</span><small>kcal</small></b>
      <div class="bal-bars">
        <div><span>Ingesta</span><i><em style="width:${Math.min(100, (n.t.kcal / Math.max(n.gasto, n.t.kcal)) * 100)}%"></em></i><b>${fmt(n.t.kcal)}</b></div>
        <div><span>Gasto</span><i><em class="g" style="width:${Math.min(100, (n.gasto / Math.max(n.gasto, n.t.kcal)) * 100)}%"></em></i><b>${fmt(n.gasto)}</b></div>
      </div>
      <span class="bal-eq">${def ? '≈ ' + (Math.abs(bal) / 7700).toFixed(2).replace('.', ',') + ' kg de grasa' : 'Mañana compensa con un día más ligero'} · ${fmt(n.act.pasos || 0)} pasos</span>
    </button>`;

  const cerrado = bal != null;
  // El giro de la tarjeta es solo del día en curso: un día nuevo empieza mostrando el balance.
  if (balDia !== hoy) { balDia = hoy; balVolteado = false; }
  const ringCard = `
    <div class="card hero2 ${cerrado ? 'fc-face fc-back' : ''}">
      <button class="ring2" id="ring" aria-label="${cerrado ? 'Volver al balance' : 'Ver macros'}">
        <svg viewBox="0 0 220 220">
          <defs>
            <linearGradient id="gArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#22d3ee"/><stop offset=".55" stop-color="#2f7bff"/><stop offset="1" stop-color="#6d28d9"/>
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
          <span class="ring-hint">${cerrado ? '↺' : ICON_DOWN}</span>
        </div>
      </button>
      <div class="pill-row">
        ${bal != null
          ? `<button class="pill soft" id="btn-cierre">${ICO.reloj}Editar cierre</button>`
          : `<span class="pill soft">${restante >= 0 ? `Quedan ${fmt(restante)}` : `+${fmt(-restante)} sobre TMB`}</span>
             <button class="pill action" id="btn-cierre">${ICO.reloj}Cerrar día</button>`}
      </div>
      <div class="macros-panel ${macrosAbiertos || cerrado ? 'open' : ''}" id="macros">
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
    </div>`;

  // Día cerrado: tarjeta giratoria → delante el balance (lo único visible), detrás la rueda.
  $('#v-nutri').innerHTML = `${cerrado
    ? `<div class="flipcard ${balVolteado ? 'flipped' : ''}" id="bal-flip"><div class="fc-inner">
        <div class="fc-face fc-front">${balanceHero}</div>${ringCard}
      </div></div>`
    : ringCard}
    <div id="pend-fotos"></div>
    ${porComida.length ? porComida.map(({ c, rs }) => {
      const sub = rs.reduce((s, r) => s + num(r.kcal), 0), open = abiertas.has(c), v = vals[c];
      const m = rs.reduce((s, r) => ({ P: s.P + num(r.prot_g), HC: s.HC + num(r.hc_g), G: s.G + num(r.grasa_g) }), { P: 0, HC: 0, G: 0 });
      const k = v ? `${hoy}|${c}|${v.texto.length}|${v.texto.slice(0, 12)}` : '';
      return `<div class="meal-card ${open ? 'open' : ''} ${v && !vistas.includes(k) ? 'nuevo' : ''}">
        <button class="meal-top" data-meal="${c}" aria-expanded="${open}">
          <span class="meal-ico">${EMOJI[c] || EMOJI.comida}</span>
          <span class="grow"><b>${c}</b><small>${rs.length} ${rs.length === 1 ? 'alimento' : 'alimentos'}</small></span>
          <span class="meal-kcal">${fmt(sub)}<small>kcal</small></span>
          <span class="meal-chev">${ICON_DOWN}</span>
        </button>
        <div class="meal-items"><div class="mi-in">
          ${v ? `<p class="meal-val t-${esc(v.tono)}" data-k="${esc(k)}"><span class="mv-ico">${ICO.apex}</span><span class="mv-txt">${esc(v.texto)}</span></p>` : ''}
          <div class="meal-macros"><span><i class="dot p"></i>Prot. <b>${Math.round(m.P)} g</b></span><span><i class="dot h"></i>Hidr. <b>${Math.round(m.HC)} g</b></span><span><i class="dot g"></i>Grasa <b>${Math.round(m.G)} g</b></span></div>
          ${rs.map(r => `<div class="item"><span class="grow name">${esc(r.alimento)}${r.fuente === 'estimado' ? ' <span class="tag">est.</span>' : ''}<small class="muted"> · ${esc(r.cantidad_g)} g</small></span>
          <b>${esc(r.kcal)}</b><button class="del" data-del="${encodeURIComponent(r._raw)}" aria-label="Borrar">${ICON_X}</button></div>`).join('')}
        </div></div>
      </div>`;
    }).join('') : `<button class="empty-cta" id="empty-add"><span><svg viewBox="0 0 24 24" class="ti-svg"><path d="M3.5 8.5h3.2l1.8-2.5h7l1.8 2.5h3.2v10.5h-17z"/><circle cx="12" cy="13.5" r="3.6"/></svg></span><b>Registra tu primera comida</b><small>Haz una foto del plato</small></button>`}
    ${histCta(hoy)}`;

  if (cerrado) {
    contar($('#bal-num'), Math.abs(bal), def ? '−' : '+');
    if (balVolteado) animarAnillo(n.t.kcal, ref);
    const girar = () => {
      balVolteado = !balVolteado;
      $('#bal-flip').classList.toggle('flipped', balVolteado);
      if (balVolteado) animarAnillo(n.t.kcal, ref); else contar($('#bal-num'), Math.abs(bal), def ? '−' : '+');
    };
    $('#bal-hero').addEventListener('click', girar);
    $('#ring').addEventListener('click', girar);
  } else {
    animarAnillo(n.t.kcal, ref);
    $('#ring').addEventListener('click', () => { macrosAbiertos = !macrosAbiertos; $('#macros').classList.toggle('open', macrosAbiertos); });
  }
  $('#btn-cierre')?.addEventListener('click', () => abrirSheet('cierre'));
  $('#empty-add')?.addEventListener('click', () => abrirSheet());
  $('#btn-hist')?.addEventListener('click', abrirHistorial);
  $$('[data-meal]').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.meal; abiertas.has(c) ? abiertas.delete(c) : abiertas.add(c);
    const abierta = b.parentElement.classList.toggle('open');
    b.setAttribute('aria-expanded', abierta);
    if (abierta) escribirValoraciones(b.parentElement);
  }));
  $$('[data-del]').forEach(b => b.addEventListener('click', () => borrarComida(decodeURIComponent(b.dataset.del))));
  pintarPendientes();
  escribirValoraciones();
  completarValoraciones(hoy);
}

// Valoración de APEX: vive dentro del desglose. La primera vez que se abre la comida, "APEX está escribiendo…"
// y se teclea; las siguientes, aparece con un fundido. Una comida con comentario sin leer lleva un punto en la flechita.
function valVistas() { try { return JSON.parse(localStorage.getItem('valVistas') || '[]'); } catch { return []; } }
function escribirValoraciones(ambito = document) {
  if ($('#splash:not(.fuera)')) return;
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let vistas = valVistas();
  const els = ambito === document ? $$('.meal-card.open .meal-val[data-k]') : $$('.meal-val[data-k]', ambito);
  els.filter(el => !el.dataset.anim).forEach((el, i) => {
    const span = $('.mv-txt', el), txt = span.textContent, k = el.dataset.k, card = el.closest('.meal-card');
    if (reducido || vistas.includes(k)) {                     // ya leída: fundido suave
      el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade');
      card.classList.remove('nuevo'); return;
    }
    el.dataset.anim = '1';
    span.textContent = ''; el.classList.add('pensando');
    setTimeout(() => {
      if (!el.isConnected) return;
      el.classList.replace('pensando', 'typing');
      let j = 0;
      const paso = () => {
        if (!el.isConnected) return;
        j = Math.min(txt.length, j + 2); span.textContent = txt.slice(0, j);
        if (j < txt.length) return setTimeout(paso, 24);
        el.classList.remove('typing'); delete el.dataset.anim; card.classList.remove('nuevo');
        vistas = [...valVistas().filter(x => x !== k), k].slice(-80);
        try { localStorage.setItem('valVistas', JSON.stringify(vistas)); } catch { /* sin almacenamiento */ }
      };
      paso();
    }, 650 + i * 500);
  });
}

// ---------- Historial de balance ----------
// Semanas: bloques lunes→domingo, deslizables (lo anterior a la izquierda). Debajo, el balance mensual por semanas.
const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const kcalTxt = v => `${v < 0 ? '−' : '+'}${fmt(Math.abs(v))}`;
const kgTxt = v => (Math.abs(v) / 7700).toFixed(2).replace('.', ',');
const diaMes = f => `${+f.slice(8)} ${MES_C[+f.slice(5, 7) - 1]}`;
const sigMes = m => { let [y, mo] = m.split('-').map(Number); if (++mo > 12) { mo = 1; y++; } return `${y}-${String(mo).padStart(2, '0')}`; };
function balanceDia(f) {
  const n = nutriDia(f);
  return { bal: n.gasto != null ? Math.round(n.t.kcal - n.gasto) : null, kcal: Math.round(n.t.kcal), comidas: n.rows.length };
}
function primerDia() {
  const fs = [...csv('comidas').rows, ...csv('actividad').rows].map(r => r.fecha).filter(f => /^\d{4}-/.test(f)).sort();
  return fs[0] || ahora().fecha;
}
function balanceRango(a, b, hoy) {
  let tot = 0, n = 0;
  for (let f = a; f <= b && f <= hoy; f = addDays(f, 1)) { const d = balanceDia(f); if (d.bal != null) { tot += d.bal; n++; } }
  return { tot, n };
}
// Semanas del mes en curso (si es su primera semana, también las 2 anteriores), desde que hay datos.
function semanasHist(hoy) {
  const lHoy = lunes(hoy), ini = lunes(primerDia());
  let l = lunes(hoy.slice(0, 8) + '01');
  if (l === lHoy) l = addDays(l, -14);
  const out = [];
  for (; l <= lHoy; l = addDays(l, 7)) if (l >= ini) out.push(l);
  return out.length ? out : [lHoy];
}
// Casillas tipo emoji: ✅ verde con check (déficit) / roja con flecha (superávit).
const HB_OK = '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>';
const HB_KO = '<svg viewBox="0 0 24 24"><path d="M12 18V6M6.5 11.5 12 6l5.5 5.5"/></svg>';
function bloqueSemana(l, hoy) {
  const dias = Array.from({ length: 7 }, (_, i) => addDays(l, i)).map(f => ({ f, ...(f > hoy ? { bal: null, fut: true } : balanceDia(f)) }));
  const cerr = dias.filter(d => d.bal != null), tot = cerr.reduce((s, d) => s + d.bal, 0);
  const enDef = cerr.filter(d => d.bal < 0).length, max = Math.max(500, ...cerr.map(d => Math.abs(d.bal)));
  const cajas = dias.map((d, i) => {
    const et = `<span class="hb-d">${DIAS[dow(d.f)]} <em>${+d.f.slice(8)}</em></span>`;
    if (d.fut) return `<div class="hb-dia fut"><span class="hb-ic vacio"></span>${et}<b class="hb-txt">—</b></div>`;
    if (d.bal == null) return `<div class="hb-dia ${d.f === hoy ? 'hoy' : 'vacio'}"><span class="hb-ic vacio"></span>${et}<b class="hb-txt">${d.f === hoy ? `En curso · ${fmt(d.kcal)} kcal` : d.comidas ? 'Sin cerrar' : 'Sin datos'}</b></div>`;
    const def = d.bal < 0;
    return `<div class="hb-dia ${def ? 'def' : 'sup'}" style="--w:${Math.round(Math.abs(d.bal) / max * 100)}%;--d:${i * 60}ms">
      <i class="hb-fill"></i><span class="hb-ic">${def ? HB_OK : HB_KO}</span>${et}<b>${kcalTxt(d.bal)}<small> kcal</small></b></div>`;
  }).join('');
  const puntos = dias.map(d => `<i class="${d.bal == null ? '' : d.bal < 0 ? 'def' : 'sup'}"></i>`).join('');
  return `<section class="hb-sem">
    <header><span><b>${diaMes(l)} – ${diaMes(addDays(l, 6))}</b><small>${cerr.length ? `${enDef} de ${cerr.length} ${cerr.length === 1 ? 'día' : 'días'} en déficit` : 'Aún sin días cerrados'}</small></span>
      <span class="hb-puntos">${puntos}</span></header>
    <div class="hb-dias">${cajas}</div>
    <footer class="hb-tot ${cerr.length ? (tot < 0 ? 'def' : 'sup') : ''}">
      <span class="hb-ic">${cerr.length ? (tot < 0 ? HB_OK : HB_KO) : ''}</span>
      <span class="grow">Balance semanal<small>${cerr.length ? (tot < 0 ? `≈ ${kgTxt(tot)} kg de grasa` : 'Superávit esta semana') : '—'}</small></span>
      <b>${cerr.length ? `${kcalTxt(tot)}<small> kcal</small>` : '—'}</b></footer>
  </section>`;
}
function bloqueMes(ym, hoy) {
  const ini = ym + '-01', fin = addDays(sigMes(ym) + '-01', -1), sems = [];
  for (let l = lunes(ini), k = 1; l <= fin; l = addDays(l, 7), k++) {
    const a = l < ini ? ini : l, b = addDays(l, 6) > fin ? fin : addDays(l, 6);
    sems.push({ k, a, b, ...balanceRango(a, b, hoy) });
  }
  const total = sems.reduce((s, x) => s + x.tot, 0), dias = sems.reduce((s, x) => s + x.n, 0);
  const max = Math.max(1, ...sems.map(s => Math.abs(s.tot)));
  const col = s => {
    const h = s.n ? Math.max(3, Math.round(Math.abs(s.tot) / max * 82)) : 0, sup = s.tot > 0;
    const bar = s.n ? `<i class="hm-bar ${sup ? 'sup' : 'def'}" style="height:${h}%"></i>` : '';
    const val = `<em class="hm-val">${s.n ? kcalTxt(s.tot) : ''}</em>`;
    return `<button class="hm-col" data-hm="${esc(`${diaMes(s.a)} – ${diaMes(s.b)} · ${s.n ? `${kcalTxt(s.tot)} kcal · ${s.n} ${s.n === 1 ? 'día cerrado' : 'días cerrados'}` : 'sin días cerrados'}`)}">
      <span class="hm-up">${sup ? val + bar : ''}</span><span class="hm-dn">${sup ? '' : bar + (s.n ? val : '')}</span>
      <span class="hm-x">S${s.k}<small>${+s.a.slice(8)}–${+s.b.slice(8)}</small></span></button>`;
  };
  return `<section class="hm-mes">
    <header><h2>${MES_L[+ym.slice(5) - 1]} ${ym.slice(0, 4)}</h2>
      <div class="hm-total">${dias ? `<b>${kcalTxt(total)}<small> kcal</small></b><span class="hm-pill ${total < 0 ? 'def' : 'sup'}">${total < 0 ? `Déficit · ≈ ${kgTxt(total)} kg` : 'Superávit'}</span>` : '<b>—</b>'}</div>
      <small class="muted">${dias} ${dias === 1 ? 'día cerrado' : 'días cerrados'} · por semanas del mes</small></header>
    <div class="hm-chart">${sems.map(col).join('')}</div>
    <div class="hm-leg"><span><i class="def"></i>Déficit</span><span><i class="sup"></i>Superávit</span></div>
    <p class="hm-det">Toca una barra para ver el detalle</p>
  </section>`;
}
function histCta(hoy) {
  const { tot, n } = balanceRango(lunes(hoy), hoy, hoy);
  return `<button class="hist-cta" id="btn-hist"><span class="meal-ico">${ICO.barras}</span>
    <span class="grow"><b>Historial de balance</b><small>${n ? `Esta semana: ${kcalTxt(tot)} kcal · ${n} ${n === 1 ? 'día cerrado' : 'días cerrados'}` : 'Déficit y superávit por día, semana y mes'}</small></span>
    <span class="meal-chev rot">${ICON_DOWN}</span></button>`;
}
function paginar(track, dots) {
  const n = track.children.length;
  dots.innerHTML = n > 1 ? '<i></i>'.repeat(n) : '';
  const upd = () => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); };
  track.addEventListener('scroll', upd, { passive: true }); upd();
}
function abrirHistorial() {
  const hoy = ahora().fecha, meses = [];
  for (let m = primerDia().slice(0, 7); m <= hoy.slice(0, 7); m = sigMes(m)) meses.push(m);
  let el = $('#hist');
  if (!el) { el = document.createElement('div'); el.id = 'hist'; el.className = 'hist'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="hist-bar"><button class="icon-btn" id="hist-x" aria-label="Cerrar">${ICON_X}</button><b id="hist-tit">Historial de balance</b></div>
    <div class="hist-pages" id="hist-pages">
      <section class="hist-page"><div class="hist-track" id="hb-track">${semanasHist(hoy).map(l => bloqueSemana(l, hoy)).join('')}</div>
        <div class="hist-dots" id="hb-dots"></div>
        <p class="hist-hint">${ICON_DOWN}Desliza hacia abajo · balance mensual</p></section>
      <section class="hist-page"><div class="hist-track" id="hm-track">${meses.map(m => bloqueMes(m, hoy)).join('')}</div>
        <div class="hist-dots" id="hm-dots"></div></section>
    </div>`;
  el.hidden = false; document.body.classList.add('hist-on');
  navPush();
  // Se abre en la semana y el mes actuales; lo anterior queda a la izquierda.
  requestAnimationFrame(() => {
    for (const [t, d] of [['#hb-track', '#hb-dots'], ['#hm-track', '#hm-dots']]) { $(t).scrollLeft = $(t).scrollWidth; paginar($(t), $(d)); }
  });
  const pages = $('#hist-pages');
  pages.addEventListener('scroll', () => {
    $('#hist-tit').textContent = pages.scrollTop > pages.clientHeight / 2 ? 'Balance mensual' : 'Historial de balance';
  }, { passive: true });
  $$('[data-hm]', el).forEach(b => b.addEventListener('click', () => {
    const mes = b.closest('.hm-mes');
    $$('.hm-col', mes).forEach(x => x.classList.toggle('sel', x === b));
    $('.hm-det', mes).textContent = b.dataset.hm;
  }));
  $('#hist-x').addEventListener('click', cerrarHistorial);
}
function cerrarHistorial() { const el = $('#hist'); if (el) el.hidden = true; document.body.classList.remove('hist-on'); }

// ---------- «Atrás» del sistema (gesto lateral de Android / botón atrás) ----------
// Cada sección, subpestaña o capa abierta deja una entrada en el historial: «atrás» la deshace en vez de salir de la app.
// Si una entrada ya no cambia nada (p. ej. la hoja se cerró con la X), se salta sola hasta la anterior que sí lo haga.
let navPop = false;
function capaAbierta() {
  if ($('#hist') && !$('#hist').hidden) return 'hist';
  if (!$('#inmersion').hidden) return 'inm';
  if (!$('#sheet').hidden) return 'sheet';
  return '';
}
const navEstado = () => ({ apex: 1, sec: seccion, rt: runTab, ov: capaAbierta() });
function navPush() {
  if (navPop) return;
  const st = navEstado(), cur = history.state;
  if (!cur?.apex) return history.replaceState(st, '');     // primera pantalla al abrir la app
  if (cur.sec === st.sec && cur.rt === st.rt && cur.ov === st.ov) return;
  history.pushState(st, '');
}
window.addEventListener('popstate', e => {
  const st = e.state?.apex ? e.state : { sec: 'nutri', rt: 'resumen', ov: '' };
  let cambio = false;
  navPop = true;
  try {
    if (st.ov !== 'hist' && $('#hist') && !$('#hist').hidden) { cerrarHistorial(); cambio = true; }
    if (st.ov !== 'inm' && !$('#inmersion').hidden && $('#inmersion').classList.contains('open')) {
      const x = $('#im-close');
      if (x) x.click(); else { $('#inmersion').hidden = true; document.body.classList.remove('inmerso'); }
      cambio = true;
    }
    if (st.ov !== 'sheet' && !$('#sheet').hidden) { cerrarSheet(); cambio = true; }
    if (st.sec !== seccion) {
      if (st.sec === 'run' && st.rt) runTab = st.rt;
      irA(st.sec, ORDEN.indexOf(st.sec) < ORDEN.indexOf(seccion) ? 'right' : 'left');
      cambio = true;
    } else if (st.sec === 'run' && st.rt && st.rt !== runTab) { irRunTab(st.rt); cambio = true; }
  } finally { navPop = false; }
  // Entrada "vacía" (nada que deshacer): se salta a la anterior. Desde la primera, «atrás» sale de la app.
  if (!cambio) history.back();
});

// ---------- Fotos pendientes (IndexedDB, solo en este dispositivo) ----------
// La foto se guarda antes de analizarla y se borra al terminar bien: si Gemini falla o se cierra la app, sigue aquí.
function fotosDB(modo, fn) {
  return new Promise((ok, ko) => {
    const rq = indexedDB.open('apex', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('fotos', { keyPath: 'id' });
    rq.onerror = () => ko(rq.error);
    rq.onsuccess = () => {
      const tx = rq.result.transaction('fotos', modo), q = fn(tx.objectStore('fotos'));
      tx.oncomplete = () => ok(q.result); tx.onerror = () => ko(tx.error);
    };
  });
}
const fotosPend = () => fotosDB('readonly', s => s.getAll()).catch(() => []);
const guardarFoto = f => fotosDB('readwrite', s => s.put(f)).catch(() => toast('No he podido guardar la foto en el móvil'));
const borrarFoto = id => fotosDB('readwrite', s => s.delete(id)).catch(() => {});

async function pintarPendientes() {
  const box = $('#pend-fotos'); if (!box) return;
  const fs = (await fotosPend()).sort((a, b) => a.id - b.id), hoy = ahora().fecha;
  box.innerHTML = fs.length ? `<div class="card pend"><h3>Fotos sin analizar<span class="tag">${fs.length}</span></h3>
    ${fs.map(f => `<div class="pend-row"><img src="${f.dataUrl}" alt="">
      <span class="grow"><b>${esc(f.comida)}</b><small>${f.fecha === hoy ? 'hoy' : f.fecha === addDays(hoy, -1) ? 'ayer' : esc(f.fecha)} · ${esc(f.hora)}${f.nota ? ` · “${esc(f.nota)}”` : ''}</small></span>
      <button class="pill action" data-pf="${f.id}">Analizar</button>
      <button class="del" data-pfx="${f.id}" aria-label="Descartar">${ICON_X}</button></div>`).join('')}
    <p class="muted">Se guardan en este dispositivo hasta que se analizan.</p></div>` : '';
  $$('[data-pf]', box).forEach(b => b.addEventListener('click', () => {
    const f = fs.find(x => String(x.id) === b.dataset.pf); if (!f) return;
    $('#sheet').hidden = false; analizarFoto(f);
  }));
  $$('[data-pfx]', box).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('¿Descartar esta foto?')) return;
    await borrarFoto(+b.dataset.pfx); pintarPendientes();
  }));
}

function miniRing(nombre, v, ref, color) {
  const r = 26, c = 2 * Math.PI * r, pct = Math.min(1, v / ref);
  return `<div class="mini"><svg viewBox="0 0 64 64"><g transform="rotate(-90 32 32)">
    <circle cx="32" cy="32" r="${r}" stroke="${color}" stroke-opacity=".18" stroke-width="7" fill="none"/>
    <circle cx="32" cy="32" r="${r}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" class="mini-arc"/></g></svg>
    <b>${Math.round(v)}<small>g</small></b><span>${nombre}</span></div>`;
}

// Contador animado genérico (número grande del balance / logro).
function contar(el, valor, prefijo = '', dec = 0) {
  if (!el) return;
  const t0 = performance.now(), dur = 1200;
  const paso = now => {
    const t = Math.min(1, (now - t0) / dur), v = valor * (1 - Math.pow(1 - t, 3));
    el.textContent = prefijo + (dec ? v.toFixed(dec).replace('.', ',') : fmt(v));
    if (t < 1 && el.isConnected !== false) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
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
let verProx = false;   // con el logro hecho, la noria se abre desde el botón negro
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
  // La semana va arriba del todo (misma altura que en Fuerza), encima de los tres botones.
  $('#v-run').innerHTML = `${semanaHTML(hoy)}
    <div class="subtabs">${RUN_TABS.map(([k, l, ic]) => `<button data-rt="${k}" class="${runTab === k ? 'on' : ''} ${k}">${ic}<span>${l}</span></button>`).join('')}</div>
    <div id="run-body" class="${dir ? 'slide-' + dir : ''}"></div>`;
  $$('[data-rt]').forEach(b => b.addEventListener('click', () => irRunTab(b.dataset.rt)));
  bindSemana(hoy);
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
    $$('[data-ses]').forEach(b => b.addEventListener('click', ev => inmersion(r.all[+b.dataset.ses], ev)));
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

  const tarjeta = (x, i) => tarjetaHTML(x, i, hoy);

  // Entreno de hoy hecho → "Logro del día" (principal). Si no, aviso del análisis más reciente.
  const hoyE = r.hoyE.at(-1), aHoy = hoyE && analisisDe(hoyE);
  let chip = '';
  if (hoyE) chip = logroHTML(hoyE, aHoy, fallidos.get(refDe(hoyE)));
  else if (ultima && aUlt) chip = `<button class="analysis-chip ${valClase(aUlt)}" id="chip-an">${valIcon(aUlt)} <span>${esc(tituloAn(aUlt))}</span></button>`;
  else if (ultima && !cfg.gemini) chip = `<button class="analysis-chip" id="chip-an">${ICO.llave}<span>Añade la clave de Gemini para analizar tus entrenos</span></button>`;
  else if (ultima && fallo) chip = `<button class="analysis-chip mid" id="chip-an">${ICO.aviso}<span>${esc(fallo)} · <u>Reintentar</u></span></button>`;
  else if (ultima) chip = `<div class="analysis-chip"><i class="spinner"></i><span>Analizando tu ${esc(ultima.tipo)} del ${new Date(ultima.fecha + 'T12:00:00Z').getUTCDate()}…</span></div>`;

  // Con el logro del día hecho, la noria se esconde tras un botón negro.
  const ocultarRueda = hoyE && ruedaN && !verProx;
  const sig = pend[0], dSig = sig && new Date(sig.fecha + 'T12:00:00Z');
  body.innerHTML = `${chip}${recuperacionHTML()}
    ${ocultarRueda ? `<button class="btn-negro" id="btn-prox">
        <span class="bn-sym">${SIMBOLO[tipoSesion(`${sig.sesion} ${sig.detalle}`)]}</span>
        <span class="grow"><b>Próximas sesiones</b><small>${sig.fecha === addDays(hoy, 1) ? 'Mañana' : DIAS_LARGOS[dSig.getUTCDay()]} · ${esc(sig.sesion)}</small></span>
        <span class="bn-arrow">›</span></button>`
    : `<div class="rueda ${hoyE ? 'aparece' : ''}" id="rueda">${pend.map(tarjeta).join('') || '<div class="next pos0"><b class="next-what">Sin sesiones pendientes</b><span class="next-detail">Pide un plan nuevo al agente</span></div>'}
      ${ruedaN > 1 ? `<div class="rueda-dots">${pend.map((_, i) => `<i data-d="${i}"></i>`).join('')}</div>` : ''}
    </div>
    ${ruedaN > 1 ? '<p class="rueda-hint">Desliza ↑↓ para ver más sesiones</p>' : ''}`}
    <div class="card vol">
      <div class="vol-head"><span>Esta semana</span><span class="pill soft">ACWR ${r.acwr ?? '—'}${r.fiable ? '' : '*'}</span></div>
      <div class="vol-num"><b>${semAct.km}</b><span>/ ${semPlan || '—'} km</span></div>
      <div class="vol-track"><i style="width:${pct * 100}%"></i><span class="runner" style="left:${pct * 100}%">${ICON_RUN}</span></div>
      <div class="weeks2">${r.semanas.map(s => `<div class="wk2 ${s.now ? 'now' : ''}">
        <div class="col2"><i style="height:${(s.km / maxKm) * 100}%"></i>${s.now && semPlan ? `<em style="bottom:${(semPlan / maxKm) * 100}%"></em>` : ''}</div>
        <b>${s.km}</b><span>${s.now ? 'hoy' : new Date(s.lunes + 'T12:00:00Z').getUTCDate() + ' ' + MESES[new Date(s.lunes + 'T12:00:00Z').getUTCMonth()]}</span></div>`).join('')}</div>
    </div>`;

  colocarRueda();
  $$('#rueda .next').forEach(c => c.addEventListener('click', () => {
    const i = +c.dataset.i;
    if (i !== ruedaIdx) { ruedaIdx = i; colocarRueda(); } else c.classList.toggle('flipped');
  }));
  $('#btn-prox')?.addEventListener('click', ev => abrirProximas(pend.map(tarjeta).join(''), pend.length, ev));
  arrancarRecuperacion();
  if (hoyE) {
    $('#logro')?.addEventListener('click', ev => {
      if (aHoy) return inmersion(hoyE, ev);
      if (!cfg.gemini) return irA('ajustes');
      fallidos.delete(refDe(hoyE)); renderRun(hoy); analizarAuto(hoyE);
    });
    contar($('#logro-km'), num(hoyE.distancia_km), '', 2);
    if (!aHoy && !fallidos.has(refDe(hoyE)) && cfg.gemini) analizarAuto(hoyE);
    return;
  }
  $('#chip-an')?.addEventListener('click', () => {
    if (aUlt) return inmersion(ultima);
    if (!cfg.gemini) return irA('ajustes');
    fallidos.delete(refDe(ultima)); renderRun(hoy); analizarAuto(ultima);
  });
  if (ultima && !aUlt && !fallo && cfg.gemini) analizarAuto(ultima);
}

// ---------- Tiempo de recuperación (Mi Fitness o estimado por APEX) ----------
// running/recuperacion.csv: fecha (de la sesión), hasta (AAAA-MM-DD HH:MM, hora de Madrid), horas, fuente.
// Las horas se comparan como "hora de Madrid sin zona" (mismo reloj en ambos lados).
const RECUP_COLS = ['fecha', 'hasta', 'horas', 'fuente'];
const tsMadrid = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) || 0, +s.slice(14, 16) || 0, +s.slice(17, 19) || 0);
function ahoraTs() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return tsMadrid(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`);
}
const fmtTs = ts => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
// Momento desde el que cuenta: la hora de fin si se conoce; si la sesión es de hoy, ahora; si no, ese día a las 20:00.
function baseRecuperacion(fecha, fin) {
  if (/^\d{1,2}:\d{2}$/.test(fin || '')) return tsMadrid(`${fecha} ${fin.padStart(5, '0')}`);
  return fecha === ahora().fecha ? ahoraTs() : tsMadrid(`${fecha} 20:00`);
}
const guardarRecuperacion = (fecha, horas, fuente, fin) => {
  const h = Math.round(num(horas) * 10) / 10;
  if (!(h > 0 && h <= 120)) return Promise.resolve();
  const hasta = fmtTs(baseRecuperacion(fecha, fin) + h * 36e5);
  return modify('recuperacion', t => {
    const ls = (t.trim() ? t : RECUP_COLS.join(',')).split('\n').filter(l => l.trim() && !l.startsWith(fecha + ','));
    return [...ls, toLine(RECUP_COLS, { fecha, hasta, horas: h, fuente })].join('\n');
  }, `recuperación ${fecha} (${h} h)`);
};
function recuperacionHTML() {
  const r = csv('recuperacion').rows.filter(x => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.hasta)).sort((a, b) => a.hasta.localeCompare(b.hasta)).at(-1);
  if (!r) return '';
  const fin = tsMadrid(r.hasta), ini = fin - (num(r.horas) || 24) * 36e5;
  if (ahoraTs() > fin + 6 * 36e5) return '';                 // tras recuperarse, el aviso se queda 6 h
  const dia = r.hasta.slice(0, 10), hoy = ahora().fecha;
  const cuando = dia === hoy ? 'hoy' : dia === addDays(hoy, 1) ? 'mañana' : DIAS_LARGOS[dow(dia)];
  return `<div class="recup" id="recup" data-ini="${ini}" data-fin="${fin}">
    <span class="rc-ic"><svg viewBox="0 0 24 24"><path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 8 4.5 8 8.5s-8 4-8 8.5M16 3.5c0 4.5-8 4.5-8 8.5s8 4 8 8.5"/></svg></span>
    <span class="grow"><small>Recuperación · ${norm(r.fuente).includes('fitness') ? 'Mi Fitness' : 'estimada por APEX'}</small>
      <b class="rc-t" id="rc-t">—</b>
      <span class="rc-sub" id="rc-sub">hasta ${cuando} a las ${r.hasta.slice(11)}</span></span>
    <i class="rc-bar"><em id="rc-bar"></em></i>
  </div>`;
}
let recupTimer = 0;
function arrancarRecuperacion() {
  clearInterval(recupTimer);
  const el = $('#recup'); if (!el) return;
  const ini = +el.dataset.ini, fin = +el.dataset.fin, sub = $('#rc-sub').textContent;
  const tic = () => {
    if (!el.isConnected) return clearInterval(recupTimer);
    const ahoraMs = ahoraTs(), falta = fin - ahoraMs;
    if (falta <= 0) {
      el.classList.add('listo');
      $('#rc-t').textContent = 'Recuperado';
      $('#rc-sub').textContent = 'Listo para volver a entrenar';
      $('#rc-bar').style.width = '100%';
      return clearInterval(recupTimer);
    }
    const s = Math.floor(falta / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sg = s % 60;
    $('#rc-t').textContent = `${h ? h + ' h ' : ''}${String(m).padStart(h ? 2 : 1, '0')} min ${String(sg).padStart(2, '0')} s`;
    $('#rc-sub').textContent = sub;
    $('#rc-bar').style.width = `${Math.max(0, Math.min(100, (ahoraMs - ini) / (fin - ini) * 100))}%`;
  };
  tic(); recupTimer = setInterval(tic, 1000);
}

// Tarjeta de sesión de la noria (cara: día + símbolo + nombre; dorso: detalle).
function tarjetaHTML(x, i, hoy) {
  const d = new Date(x.fecha + 'T12:00:00Z'), t = tipoSesion(`${x.sesion} ${x.detalle}`);
  const cuando = x.fecha === hoy ? 'Hoy' : x.fecha === addDays(hoy, 1) ? 'Mañana' : DIAS_LARGOS[d.getUTCDay()];
  const partes = x.detalle.split(/\s+\+\s+|\s+·\s+/).filter(Boolean);
  const fichas = partes.map(fichaDetalle);
  const porTiempo = /\d+\s*s\b|rondas/.test(norm(x.detalle)) && t === 'fuerza';
  return `<div class="next t-${t}" data-i="${i}"><div class="flip">
    <div class="face cara">
      <span class="next-when">${cuando} · ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}</span>
      <span class="sym">${SIMBOLO[t]}</span>
      <b class="next-what">${esc(x.sesion)}</b>
      <span class="tap-hint">Toca para ver la sesión</span>
    </div>
    <div class="face dorso">
      <span class="dorso-tit">${SIMBOLO[t]}<b>${esc(x.sesion)}</b></span>
      <div class="fichas ${fichas.length > 4 ? 'dos' : ''}">${fichas.map(f =>
        `<div class="ficha ${f.tipo}"><b>${esc(f.num || '•')}</b><span>${esc(f.txt)}</span></div>`).join('')}</div>
      ${porTiempo ? `<button class="tabata-go" data-tabata="${encodeURIComponent(x.sesion + '|' + x.detalle)}">⏱ Iniciar con temporizador</button>` : ''}
    </div>
  </div></div>`;
}
// Separa cada parte del detalle en "cifra clave" + descripción (p. ej. "3×13" + "Flexiones").
function fichaDetalle(p) {
  const m = /parada/i.test(p) ? null : p.match(/\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:m\b|s\b|min\b)?(?:\s*\(total\)|\/pierna)?|\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?|\d+(?:[.,]\d+)?\s*km|\d+\s*s\b|\d+\s*rondas?|\d{3}\s*[–-]\s*\d{3}/i);
  const num = m ? m[0].replace(/\s+/g, ' ').trim() : '';
  let txt = m ? (p.slice(0, m.index) + p.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').replace(/^[\s:·,-]+|[\s:·,-]+$/g, '') : p;
  const n = norm(p);
  const tipo = /calentamiento/.test(n) ? 'cal' : /enfriamiento/.test(n) ? 'enf' : /alerta|fc/.test(n) ? 'fc' : /descarga/.test(n) ? 'desc' : /finisher/.test(n) ? 'fin' : '';
  if (!txt) txt = /km/.test(num) ? 'distancia' : /:/.test(num) ? 'duración' : '';
  return { num, txt, tipo };
}
const pendRun = hoy => {
  const hechos = new Set(csv('entrenos').rows.map(e => e.fecha));
  return planRows().filter(x => esSesion(x) && (x.fecha > hoy || (x.fecha === hoy && !hechos.has(hoy)))).slice(0, 12);
};

// ---------- Semana unificada (running + fuerza) ----------
const esFuerza = x => /fuerza/.test(norm(x.sesion));
const MINI = {
  run: '<svg viewBox="0 0 24 24" class="mini-ico"><circle cx="15" cy="4" r="2" class="f"/><path d="M13.5 7.5l-3 6 3.5 2.5-1.5 5M10.5 13.5l-4 2-2.5-1M7.5 10l3.5-2.5 3.5 1.5 2 3"/></svg>',
  fuerza: '<svg viewBox="0 0 24 24" class="mini-ico"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
};
function semanaHTML(hoy) {
  const plan = planRows(), lun = lunes(hoy);
  const runH = new Set(csv('entrenos').rows.map(e => e.fecha)), fzH = new Set(csv('fuerza').rows.map(s => s.fecha));
  return `<div class="semana">${[...'LMXJVSD'].map((l, i) => {
    const f = addDays(lun, i), rows = plan.filter(x => x.fecha === f);
    const run = rows.some(esSesion) || runH.has(f), fz = rows.some(esFuerza) || fzH.has(f);
    const hecho = (run && runH.has(f)) || (fz && fzH.has(f));
    const k = run ? 'run' : fz ? 'fuerza' : '';
    return `<button class="sd ${f === hoy ? 'hoy' : ''} ${f < hoy ? 'pasado' : ''} ${k}" data-sd="${f}" data-k="${k}">
      <span>${l}</span><i>${run ? MINI.run : ''}${fz ? MINI.fuerza : ''}${!run && !fz ? '·' : ''}</i><em>${hecho ? '✓' : ''}</em></button>`;
  }).join('')}</div>`;
}
function bindSemana(hoy) {
  $$('[data-sd]').forEach(b => b.addEventListener('click', ev => {
    const f = b.dataset.sd, k = b.dataset.k;
    if (k === 'fuerza') { fuerzaSel = f; if (seccion !== 'fuerza') irA('fuerza', 'left'); else render(); return; }
    if (k !== 'run') return;
    const hecho = csv('entrenos').rows.filter(e => e.fecha === f).at(-1);
    if (seccion !== 'run') { runTab = 'resumen'; irA('run', 'right'); }
    if (hecho) return inmersion(hecho, ev);
    const pend = pendRun(hoy), idx = pend.findIndex(x => x.fecha === f);
    if (idx >= 0) abrirProximas(pend.map((x, i) => tarjetaHTML(x, i, hoy)).join(''), pend.length, ev, idx);
  }));
}

// ---------- Fuerza ----------
let fuerzaSel = null;
function rutinas() {
  return [...(D.rutinas?.text || '').matchAll(/^## (.+)$/gm)].map(m => m[1].trim()).filter(n => !n.startsWith('<'));
}
function renderFuerza(hoy) {
  const plan = planRows(), fz = csv('fuerza').rows;
  const hechas = new Set(fz.map(s => s.fecha)), hoyS = fz.filter(s => s.fecha === hoy).at(-1);
  const prox = plan.filter(x => esFuerza(x) && (x.fecha > hoy || (x.fecha === hoy && !hechas.has(hoy))));
  const sel = (fuerzaSel && plan.find(x => x.fecha === fuerzaSel && esFuerza(x))) || prox[0];
  // Si la sesión es por tiempo (core), el contador se abre ya programado con ella.
  const porTiempo = sel && /\brondas?\b/.test(norm(sel.detalle));   // core: "2 rondas × 20 s" (las de reps no llevan rondas)
  $('#v-fuerza').innerHTML = `
    ${semanaHTML(hoy)}
    ${hoyS ? `<div class="logro fz-logro"><span class="logro-tag">${ICO.pesa}Fuerza completada</span>
        <span class="sym big">${MINI.fuerza}</span>
        <b class="logro-km cap" style="font-size:34px">${esc(hoyS.rutina)}</b>
        <span class="logro-val">${esc(hoyS.duracion_min)}' · RPE ${esc(hoyS.rpe || '—')}</span></div>` : ''}
    ${sel ? `<p class="sec-title">${sel.fecha === hoy ? 'Hoy' : 'Próxima sesión de fuerza'}</p>
      <div class="rueda fz-una" id="rueda">${tarjetaHTML({ ...sel, sesion: sel.sesion.replace(/^descanso \+ /, '') }, 0, hoy)}</div>`
      : '<div class="empty card">Sin sesiones de fuerza en el plan.</div>'}
    <button class="btn-negro tb-acceso" id="btn-tabata"><span class="bn-sym">${ICO.play}</span><span class="grow"><b>Comienza tu entrenamiento</b></span><span class="bn-arrow">›</span></button>
    <div class="fz-botones">
      <button class="btn-negro fz-b" id="btn-rutinas"><span class="bn-sym">${SIMBOLO.fuerza}</span><b>Mis rutinas</b></button>
      <button class="btn-negro fz-b" id="btn-historial"><span class="bn-sym">${ic('calendario')}</span><b>Historial</b></button>
    </div>`;
  bindSemana(hoy);
  $('#btn-tabata').addEventListener('click', ev => porTiempo ? abrirTabata(ev, presetDesdeDetalle(sel.sesion, sel.detalle)) : abrirTabata(ev));
  $('#btn-rutinas').addEventListener('click', ev => verRutinas(ev));
  $('#btn-historial').addEventListener('click', ev => verHistorialFuerza(ev, fz));
  $$('#rueda .next').forEach(c => { c.classList.add('pos0'); c.addEventListener('click', () => c.classList.toggle('flipped')); });
}
// Mis rutinas a pantalla completa (inmersión): cada rutina con sus ejercicios en fichas.
function verRutinas(ev) {
  const txt = D.rutinas?.text || '';
  const secciones = [...txt.matchAll(/(?:^|\n)## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/g)].map(m => {
    const lineas = m[2].split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
    // Solo se muestra el formato (sin días, duración ni impacto en piernas).
    const info = lineas.filter(l => /^(d[ií]as|formato|solo si)/i.test(l));
    const ej = lineas.filter(l => !info.includes(l)).flatMap(l => l.split(/\s+·\s+/));
    const formato = info.find(l => /^formato/i.test(l))?.replace(/^formato:?\s*/i, '')
      || (info.find(l => /^solo si/i.test(l))?.split(' · ').find(x => /trabajo|descanso/.test(x)))
      || (ej.some(x => /\d+\s*[x×]\s*\d+/.test(x)) ? 'Por repeticiones · 60–90 s de descanso entre series' : '');
    return { nombre: m[1], meta: formato, ej };
  }).filter(s => !/pausa/i.test(s.nombre));
  abrirCapa(ev, 'im-fz', `
    <button class="im-close" id="im-close" aria-label="Cerrar">${ICON_X}</button>
    <div class="im-content">
      <div class="im-hero"><span class="sym big">${SIMBOLO.fuerza}</span><b class="im-km" style="font-size:40px">Mis rutinas</b></div>
      ${secciones.length ? secciones.map(s => `<section class="im-sec rut">
        <h4>${esc(s.nombre)}</h4>${s.meta ? `<p class="im-mot">${esc(s.meta)}</p>` : ''}
        <div class="fichas dos">${s.ej.map(fichaDetalle).map(f => `<div class="ficha ${f.tipo}"><b>${esc(f.num || '•')}</b><span>${esc(f.txt)}</span></div>`).join('')}</div>
      </section>`).join('') : '<p class="im-mot">Aún no hay rutinas: pásaselas al agente de Claude.</p>'}
    </div>`);
}
function verHistorialFuerza(ev, fz) {
  abrirCapa(ev, 'im-fz', `
    <button class="im-close" id="im-close" aria-label="Cerrar">${ICON_X}</button>
    <div class="im-content">
      <div class="im-hero"><span class="sym big">${ic('calendario')}</span><b class="im-km" style="font-size:40px">Historial</b>
        <span class="im-sub">${fz.length} sesiones · ${fz.reduce((s, x) => s + num(x.duracion_min), 0)} min en total</span></div>
      ${fz.slice().reverse().map(s => {
        const d = new Date(s.fecha + 'T12:00:00Z');
        return `<div class="im-item"><span class="im-day">${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}</span>
          <span><b class="cap">${esc(s.rutina)}</b><br><small>${esc(s.duracion_min)} min${s.rpe ? ' · RPE ' + esc(s.rpe) : ''}${s.notas ? ' · ' + esc(s.notas) : ''}</small></span></div>`;
      }).join('') || '<p class="im-mot">Aún no has registrado sesiones de fuerza.</p>'}
    </div>`);
}
function formFuerza() {
  const { fecha } = ahora(), plan = planRows().find(x => x.fecha === fecha && esFuerza(x));
  const opciones = [...new Set([...(plan ? [plan.sesion.replace(/^(descanso \+ )?fuerza\s*/i, '') || 'fuerza'] : []), ...rutinas(), 'core', 'tren superior', 'piernas', 'movilidad'])];
  $('#sheet-title').textContent = 'Registrar fuerza';
  $('#sheet-body').innerHTML = `<div class="stack">
    ${plan ? `<p class="muted">Plan de hoy: <b>${esc(plan.sesion)}</b> · ${esc(plan.detalle)}</p>` : ''}
    <label>Rutina<select id="z-rut">${opciones.map(o => `<option>${esc(o)}</option>`).join('')}</select></label>
    <div class="row2"><label>Fecha<input id="z-f" type="date" value="${fecha}"></label>
      <label>Duración (min)<input id="z-min" type="number" inputmode="numeric" placeholder="35"></label></div>
    <label>Esfuerzo (RPE 1–10)<input id="z-rpe" type="number" inputmode="numeric" min="1" max="10"></label>
    <label>Notas / molestias<input id="z-notas" placeholder="p. ej. rodillas bien, plancha 3×45 s"></label>
    <button class="btn primary" id="z-save">Guardar sesión</button></div>`;
  $('#z-save').addEventListener('click', async () => {
    const min = Math.round(num($('#z-min').value)), rpe = Math.round(num($('#z-rpe').value));
    if (!min) return toast('Indica la duración');
    const { header } = csv('fuerza');
    const fila = { fecha: $('#z-f').value, rutina: limpio($('#z-rut').value), duracion_min: min, rpe: rpe || '', carga: rpe ? rpe * min : '', notas: limpio($('#z-notas').value) };
    try { await appendLines('fuerza', [toLine(header, fila)], `fuerza ${fila.fecha} ${fila.rutina}`); cerrarSheet(); toast('Sesión de fuerza guardada ✓'); render(); }
    catch (e) { toast(e.message); }
  });
}

// ---------- Temporizador Tabata (sonido + voz + vibración) ----------
let tbPref = { sonido: true, voz: true };
try { Object.assign(tbPref, JSON.parse(localStorage.getItem('tabata') || '{}')); } catch { /* sin almacenamiento */ }
const TB = { seq: [], i: 0, t0: 0, quedaba: 0, pausa: false, timer: null, ctx: null, lock: null, seg: null, rutina: '' };

function beep(f = 880, d = 0.15, v = 0.3) {
  if (!tbPref.sonido) return;
  try {
    const c = TB.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(v, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d);
  } catch { /* sin audio */ }
}
function decir(t) {
  if (!tbPref.voz || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t); u.lang = 'es-ES'; u.rate = 1.05;
  speechSynthesis.speak(u);
}

// Secuencia de intervalos. modo 'ejercicio' = todas las rondas de un ejercicio antes del siguiente; 'circuito' = vuelta completa.
function secuencia({ ejercicios, rondas, trabajo, descanso, modo = 'ejercicio', finisher }) {
  const s = [{ tipo: 'prep', dur: 10, nombre: 'Prepárate' }];
  const bloques = [];
  if (modo === 'ejercicio') ejercicios.forEach((e, k) => { for (let r = 1; r <= rondas; r++) bloques.push({ nombre: e, info: `${k + 1}/${ejercicios.length} · serie ${r}/${rondas}` }); });
  else for (let r = 1; r <= rondas; r++) ejercicios.forEach((e, k) => bloques.push({ nombre: e, info: `vuelta ${r}/${rondas} · ${k + 1}/${ejercicios.length}` }));
  bloques.forEach((b, k) => {
    s.push({ tipo: 'trabajo', dur: trabajo, ...b });
    if (k < bloques.length - 1 || finisher) s.push({ tipo: 'descanso', dur: descanso, nombre: 'Descanso' });
  });
  if (finisher) s.push({ tipo: 'trabajo', dur: finisher.dur, nombre: finisher.nombre, info: 'finisher' });
  return s;
}
// Preset a partir de una sesión del plan (p. ej. core: "2 rondas × 20 s · Crunch… · Finisher plancha codos 30 s").
function presetDesdeDetalle(sesion, detalle) {
  const partes = detalle.split(/\s+·\s+/).map(p => p.trim()).filter(Boolean);
  const n = norm(detalle);
  const rondas = +((n.match(/(\d+)\s*rondas?/) || [])[1] || (/descarga/.test(n) ? 1 : 2));
  const trabajo = +((n.match(/rondas?\s*[x×]\s*(\d+)\s*s/) || [])[1] || 20);
  const finP = partes.find(p => /^finisher/i.test(p));
  const finisher = finP ? { nombre: finP.replace(/^finisher:?\s*/i, '').replace(/\s*\d+\s*s$/, ''), dur: +((finP.match(/(\d+)\s*s$/) || [])[1] || 30) } : null;
  const ejercicios = partes.filter(p => !/rondas?|^finisher|^descarga/i.test(p));
  return { titulo: sesion.replace(/^fuerza\s*/i, ''), ejercicios, rondas, trabajo, descanso: 20, modo: 'ejercicio', finisher };
}
function presetsRutinas() {
  const txt = D.rutinas?.text || '', out = [];
  for (const m of txt.matchAll(/(?:^|\n)## (core [^\n]+)\n([\s\S]*?)(?=\n## |$)/g)) {
    const lineas = m[2].split('\n').map(l => l.replace(/^-\s*/, '').trim());
    const ej = lineas.find(l => l.includes(' · ') && !/^d[ií]as|^formato/i.test(l));
    const fin = lineas.find(l => /^finisher/i.test(l));
    if (ej) out.push(presetDesdeDetalle(m[1], `2 rondas × 20 s · ${ej}${fin ? ' · ' + fin.replace(/,\s*/, ' ') : ''}`));
  }
  return out;
}

function abrirTabata(ev, preset) {
  const cerrar = abrirCapa(ev, 'im-timer', `
    <button class="im-close" id="im-close" aria-label="Cerrar">${ICON_X}</button>
    <div class="tb" id="tb"></div>`);
  $('#im-close').addEventListener('click', tbParar);
  TB.cerrar = cerrar;
  preset ? tbPreparar(preset) : tbMenu();
}
function tbMenu() {
  const { fecha } = ahora();
  const prox = planRows().find(x => x.fecha >= fecha && /core/.test(norm(x.sesion)));
  const presets = [
    ...(prox ? [{ ...presetDesdeDetalle(prox.sesion, prox.detalle), etiqueta: `${prox.fecha === fecha ? 'Hoy' : 'Próximo'}: ${prox.sesion.replace(/^fuerza\s*/i, '')}` }] : []),
    ...presetsRutinas(),
    { titulo: 'Tabata clásico', ejercicios: ['Tabata'], rondas: 8, trabajo: 20, descanso: 10, modo: 'circuito' },
    { titulo: 'Isométrica en pared', ejercicios: ['Sentadilla isométrica en pared'], rondas: 2, trabajo: 30, descanso: 60, modo: 'circuito' },
  ];
  $('#tb').innerHTML = `
    <h2 class="tb-h">⏱ Temporizador</h2>
    <div class="tb-presets">${presets.map((p, k) => `<button class="tb-pre" data-pre="${k}">
      <b>${esc(p.etiqueta || p.titulo)}</b>
      <span>${p.ejercicios.length > 1 ? p.ejercicios.length + ' ejercicios · ' : ''}${p.rondas} × ${p.trabajo} s / ${p.descanso} s${p.finisher ? ' · finisher' : ''}</span></button>`).join('')}</div>
    <details class="tb-custom"><summary>Personalizado</summary>
      <div class="tb-grid">
        <label>Trabajo (s)<input id="tb-w" type="number" inputmode="numeric" value="20"></label>
        <label>Descanso (s)<input id="tb-r" type="number" inputmode="numeric" value="10"></label>
        <label>Rondas<input id="tb-n" type="number" inputmode="numeric" value="8"></label>
      </div>
      <label>Ejercicios (opcional, separados por comas)<input id="tb-e" placeholder="Plancha, Bicicleta, Nadador"></label>
      <button class="im-btn" id="tb-custom-go">Preparar</button>
    </details>
    <div class="tb-prefs">
      <label class="check"><input type="checkbox" id="tb-snd" ${tbPref.sonido ? 'checked' : ''}> Sonido</label>
      <label class="check"><input type="checkbox" id="tb-voz" ${tbPref.voz ? 'checked' : ''}> Voz</label>
    </div>`;
  const guardarPref = () => { tbPref = { sonido: $('#tb-snd').checked, voz: $('#tb-voz').checked }; try { localStorage.setItem('tabata', JSON.stringify(tbPref)); } catch { /* */ } };
  $('#tb-snd').addEventListener('change', guardarPref); $('#tb-voz').addEventListener('change', guardarPref);
  $$('[data-pre]').forEach(b => b.addEventListener('click', () => tbPreparar(presets[+b.dataset.pre])));
  $('#tb-custom-go').addEventListener('click', () => {
    const ej = $('#tb-e').value.split(',').map(s => s.trim()).filter(Boolean);
    tbPreparar({ titulo: 'Personalizado', ejercicios: ej.length ? ej : ['Trabajo'], rondas: Math.max(1, +$('#tb-n').value || 1),
      trabajo: Math.max(5, +$('#tb-w').value || 20), descanso: Math.max(0, +$('#tb-r').value || 0), modo: ej.length > 1 ? 'circuito' : 'circuito' });
  });
}
function tbPreparar(p) {
  TB.seq = secuencia(p); TB.rutina = p.titulo; TB.i = 0; TB.pausa = false;
  const total = TB.seq.reduce((s, x) => s + x.dur, 0);
  $('#tb').innerHTML = `
    <h2 class="tb-h">${esc(p.titulo)}</h2>
    <p class="tb-sub">${fmtSeg(total)} en total · ${TB.seq.filter(x => x.tipo === 'trabajo').length} intervalos de trabajo</p>
    <ol class="tb-lista">${p.ejercicios.map(e => `<li>${esc(e)}</li>`).join('')}${p.finisher ? `<li class="fin">Finisher: ${esc(p.finisher.nombre)} · ${p.finisher.dur} s</li>` : ''}</ol>
    <button class="tb-start" id="tb-start">${ICO.play}Empezar</button>
    <button class="tb-link" id="tb-back">‹ Otros temporizadores</button>`;
  $('#tb-start').addEventListener('click', tbEmpezar);
  $('#tb-back').addEventListener('click', tbMenu);
}
const fmtSeg = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const TB_R = 120, TB_C = 2 * Math.PI * TB_R;

async function tbEmpezar() {
  beep(1, 0.01, 0.001);   // desbloquea el audio con el toque del usuario
  try { TB.lock = await navigator.wakeLock?.request('screen'); } catch { TB.lock = null; }
  $('#tb').innerHTML = `
    <div class="tb-run">
      <span class="tb-fase" id="tb-fase"></span>
      <div class="tb-ring">
        <svg viewBox="0 0 260 260"><g transform="rotate(-90 130 130)">
          <circle cx="130" cy="130" r="${TB_R}" class="tb-track"/>
          <circle cx="130" cy="130" r="${TB_R}" class="tb-arc" id="tb-arc" stroke-dasharray="${TB_C}"/></g></svg>
        <div class="tb-num"><b id="tb-s">0</b><span id="tb-info"></span></div>
      </div>
      <b class="tb-ej" id="tb-ej"></b>
      <span class="tb-next" id="tb-next"></span>
      <div class="tb-ctrl">
        <button id="tb-pause" aria-label="Pausa">${ICO.pausa}</button>
        <button id="tb-skip" aria-label="Saltar">${ICO.saltar}</button>
      </div>
      <div class="tb-prog"><i id="tb-prog"></i></div>
    </div>`;
  $('#tb-pause').addEventListener('click', tbPausa);
  $('#tb-skip').addEventListener('click', () => tbEntrar(TB.i + 1));
  TB.inicio = Date.now();
  tbEntrar(0);
  clearInterval(TB.timer);
  TB.timer = setInterval(tbTick, 100);
}
function tbEntrar(i) {
  TB.i = i; TB.seg = null; TB.t0 = Date.now(); TB.pausa = false;
  const p = TB.seq[i];
  if (!p) return tbFin();
  const sig = TB.seq.slice(i + 1).find(x => x.tipo === 'trabajo');
  const ov = $('#inmersion'); ov.dataset.fase = p.tipo;
  $('#tb-fase').textContent = { prep: 'PREPÁRATE', trabajo: '¡DALE!', descanso: 'DESCANSO' }[p.tipo];
  $('#tb-ej').textContent = p.tipo === 'descanso' ? (sig ? sig.nombre : '') : p.nombre;
  $('#tb-next').textContent = p.tipo === 'trabajo' ? (sig ? `Siguiente: ${sig.nombre}` : 'Último intervalo') : p.tipo === 'descanso' ? 'Siguiente' : '';
  $('#tb-info').textContent = p.info || '';
  $('#tb-prog').style.width = `${(i / TB.seq.length) * 100}%`;
  $('#tb-pause').innerHTML = ICO.pausa;
  if (p.tipo === 'trabajo') { beep(1320, 0.45); navigator.vibrate?.([120, 60, 120]); decir(p.nombre); }
  else if (p.tipo === 'descanso') { beep(660, 0.45); navigator.vibrate?.(200); decir(sig ? `Descanso. Siguiente: ${sig.nombre}` : 'Descanso'); }
  else decir(`Prepárate. Empezamos con ${sig ? sig.nombre : 'el primer ejercicio'}`);
}
function tbTick() {
  const p = TB.seq[TB.i];
  if (!p || TB.pausa) return;
  const quedan = Math.max(0, p.dur - (Date.now() - TB.t0) / 1000);
  const seg = Math.ceil(quedan);
  if (seg !== TB.seg) {
    TB.seg = seg;
    $('#tb-s').textContent = seg;
    if (seg <= 3 && seg > 0) { beep(880, 0.12); navigator.vibrate?.(40); }
  }
  $('#tb-arc').setAttribute('stroke-dashoffset', TB_C * (1 - quedan / p.dur));
  if (quedan <= 0) tbEntrar(TB.i + 1);
}
function tbPausa() {
  const p = TB.seq[TB.i]; if (!p) return;
  if (!TB.pausa) { TB.pausa = true; TB.quedaba = p.dur - (Date.now() - TB.t0) / 1000; $('#tb-pause').innerHTML = ICO.play; speechSynthesis?.cancel(); }
  else { TB.pausa = false; TB.t0 = Date.now() - (p.dur - TB.quedaba) * 1000; $('#tb-pause').innerHTML = ICO.pausa; }
}
function tbFin() {
  clearInterval(TB.timer);
  const min = Math.max(1, Math.round((Date.now() - TB.inicio) / 60000));
  beep(1320, 0.2); setTimeout(() => beep(1320, 0.2), 260); setTimeout(() => beep(1760, 0.6), 520);
  navigator.vibrate?.([200, 100, 200, 100, 400]);
  decir('Entrenamiento completado. ¡Buen trabajo!');
  $('#inmersion').dataset.fase = 'fin';
  $('#tb').innerHTML = `<div class="tb-done"><span class="tb-trofeo">${ICO.trofeo}</span><b>¡Completado!</b><span>${esc(TB.rutina)} · ${min} min</span>
    <button class="tb-start" id="tb-reg">Registrar sesión</button><button class="tb-link" id="tb-otra">Otro temporizador</button></div>`;
  liberarPantalla();
  $('#tb-reg').addEventListener('click', () => {
    const rut = TB.rutina; TB.cerrar?.();
    setTimeout(() => {
      irA('fuerza'); abrirSheet();
      $('#z-min').value = min;
      const sel = $('#z-rut'); const op = [...sel.options].find(o => norm(o.value) === norm(rut));
      if (op) sel.value = op.value; else { sel.add(new Option(rut, rut, true, true)); }
    }, 600);
  });
  $('#tb-otra').addEventListener('click', tbMenu);
}
function liberarPantalla() { try { TB.lock?.release(); } catch { /* */ } TB.lock = null; }
function tbParar() { clearInterval(TB.timer); TB.timer = null; speechSynthesis?.cancel?.(); liberarPantalla(); }
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && TB.timer && !TB.lock) { try { TB.lock = await navigator.wakeLock?.request('screen'); } catch { /* */ } }
});
// Botón "Iniciar con temporizador" dentro de una tarjeta: no debe girar la tarjeta.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tabata]'); if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const [sesion, detalle] = decodeURIComponent(b.dataset.tabata).split('|');
  abrirTabata(e, presetDesdeDetalle(sesion, detalle));
}, true);

// Tipo de sesión → símbolo propio.
function tipoSesion(txt) {
  const s = norm(txt);
  if (/fuerza|core|full body|superior/.test(s)) return 'fuerza';   // antes que "series" (2×10 no son series de running)
  if (/series|interval|\d+\s*[x×]\s*\d+/.test(s)) return 'series';
  if (/tempo|umbral|progresiv/.test(s)) return 'tempo';
  if (/tirada|largo/.test(s)) return 'tirada';
  if (/competic|carrera popular|media maraton/.test(s)) return 'carrera';
  if (/z2|zona 2|suave|regenera/.test(s)) return 'z2';
  return 'rodaje';
}
const SIMBOLO = {
  // Fuerza: mancuerna
  fuerza: '<svg viewBox="0 0 48 48" class="sym-svg"><path class="ln" d="M14 12v24M34 12v24M8 17v14M40 17v14M14 24h20M3 24h5M40 24h5"/></svg>',
  // Series: bloques de intensidad que suben y bajan
  series: '<svg viewBox="0 0 48 48" class="sym-svg"><rect x="5" y="26" width="6" height="16" rx="2"/><rect x="15" y="12" width="6" height="30" rx="2"/><rect x="25" y="26" width="6" height="16" rx="2"/><rect x="35" y="8" width="6" height="34" rx="2"/><path d="M4 6l4 4 4-4" class="ln"/></svg>',
  // Zona 2: corazón con pulso tranquilo
  z2: '<svg viewBox="0 0 48 48" class="sym-svg"><path class="ln" d="M24 41S6 30 6 17a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z"/><path class="ln" d="M11 24h7l3-5 4 9 3-4h9"/></svg>',
  // Rodaje: camino continuo
  rodaje: '<svg viewBox="0 0 48 48" class="sym-svg"><path class="ln" d="M8 40c10 0 6-12 16-12s6-12 16-12"/><circle cx="8" cy="40" r="3.5"/><circle cx="40" cy="16" r="3.5"/><path class="ln dash" d="M8 40c10 0 6-12 16-12s6-12 16-12" transform="translate(0 0)"/></svg>',
  // Tirada: ruta larga con bandera de meta
  tirada: '<svg viewBox="0 0 48 48" class="sym-svg"><path class="ln" d="M6 38c6-8 12 2 18-6s10-10 16-6"/><path class="ln" d="M38 26V8"/><path d="M38 8h8l-3 4 3 4h-8z"/><circle cx="6" cy="38" r="3"/></svg>',
  // Tempo / progresivo: velocímetro
  tempo: '<svg viewBox="0 0 48 48" class="sym-svg"><path class="ln" d="M8 34a16 16 0 1 1 32 0"/><path class="ln" d="M24 34l9-11"/><circle cx="24" cy="34" r="3"/></svg>',
  // Competición: medalla
  carrera: '<svg viewBox="0 0 48 48" class="sym-svg"><path class="ln" d="M16 4l8 14 8-14"/><circle class="ln" cx="24" cy="30" r="11"/><path d="M24 23l2 5h5l-4 3 1.5 5-4.5-3-4.5 3 1.5-5-4-3h5z"/></svg>',
};

function logroHTML(e, a, fallo) {
  const t = tipoSesion(`${e.tipo} ${e.notas}`);
  // Solo el resumen; ritmo, FC, puntos fuertes y mejoras aparecen al tocar la tarjeta.
  return `<button class="logro t-${t} ${a ? valClase(a) : ''}" id="logro">
    <span class="logro-tag">${ICO.medalla}Logro del día</span>
    <span class="sym big">${SIMBOLO[t]}</span>
    <b class="logro-km"><span id="logro-km">0</span><small>km</small></b>
    ${a ? `<span class="logro-val">${valIcon(a)} ${esc(tituloAn(a))}</span><span class="tap-hint">Toca para ver el análisis</span>`
    : !cfg.gemini ? `<span class="logro-val">${ICO.llave}Añade la clave de Gemini para el análisis</span>`
    : fallo ? `<span class="logro-val">${ICO.aviso}${esc(fallo)} · <u>Reintentar</u></span>`
    : '<span class="logro-val"><i class="spinner"></i> Analizando tu sesión…</span>'}
  </button>`;
}

// Noria: cada tarjeta se coloca según su distancia a la seleccionada.
function colocarRueda() {
  $$('#rueda .next').forEach(c => {
    const o = +c.dataset.i - ruedaIdx;
    c.classList.remove('gone', 'pos0', 'pos1', 'pos2', 'hide', 'flipped');
    c.classList.add(o < 0 ? 'gone' : o === 0 ? 'pos0' : o === 1 ? 'pos1' : o === 2 ? 'pos2' : 'hide');
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
  navPush();
}

// Gestos.
// - Horizontal entre secciones (Nutrición ⇄ Running ⇄ Fuerza): la vista sigue al dedo, se suelta por distancia o
//   velocidad, sale y entra animada, y el indicador de la barra inferior se desliza a la vez.
// - En Running, el horizontal cambia antes de subpestaña; solo en la primera/última (o sobre el calendario) cambia de sección.
// - Vertical sobre la noria = girarla.
const ORDEN = ['nutri', 'run', 'fuerza'];
function destinoGesto(dir, target) {
  if (!ORDEN.includes(seccion)) return null;
  if (seccion === 'run' && !target.closest('.semana') && RUN_TABS[RUN_TABS.findIndex(x => x[0] === runTab) + dir]) return 'subtab';
  return ORDEN[ORDEN.indexOf(seccion) + dir] || null;
}
function moverIndicador(pos, animar = true) {
  const ind = $('#tab-ind'); if (!ind) return;
  ind.style.transition = animar ? '' : 'none';
  ind.style.setProperty('--i', pos);
  ind.style.opacity = pos == null ? 0 : 1;
}
function gestos() {
  const main = $('main');
  const NO = '.meal-chips, .hist-track, #rueda, input, textarea, select, [data-noswipe]';
  let x0 = 0, y0 = 0, t0 = 0, modo = null, destino = null, dir = 0, vista = null, objetivo = null;
  main.addEventListener('touchstart', e => {
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); objetivo = e.target;
    modo = e.touches.length > 1 || e.target.closest(NO) ? 'no' : null;
    vista = $(`#v-${seccion}`);
  }, { passive: true });
  main.addEventListener('touchmove', e => {
    if (modo === 'no' || modo === 'v' || modo === 'sub') return;
    const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (!modo) {
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) { modo = 'v'; return; }
      dir = dx < 0 ? 1 : -1;
      destino = destinoGesto(dir, objetivo);
      if (destino === 'subtab') { modo = 'sub'; return; }     // lo resuelve el cambio de subpestaña al soltar
      modo = 'h';
      vista.style.transition = 'none';
      vista.style.willChange = 'transform, opacity';          // la vista va por GPU mientras se arrastra
    }
    e.preventDefault();                                       // sin scroll vertical mientras se arrastra en horizontal
    const ahoraDir = dx < 0 ? 1 : -1;                         // si cambia de sentido a mitad, se recalcula el destino
    if (ahoraDir !== dir) { dir = ahoraDir; destino = destinoGesto(dir, objetivo); }
    const libre = destino && destino !== 'subtab';
    const d = libre ? dx : dx / 4;                            // sin sección al lado: resistencia elástica
    vista.style.transform = `translateX(${d}px)`;
    vista.style.opacity = String(1 - Math.min(0.4, Math.abs(d) / innerWidth * 0.6));
    if (libre) moverIndicador(ORDEN.indexOf(seccion) + Math.max(-1, Math.min(1, -dx / innerWidth)), false);
  }, { passive: false });
  const soltar = e => {
    if (modo === 'sub') {
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) irRunTab(RUN_TABS[RUN_TABS.findIndex(x => x[0] === runTab) + (dx < 0 ? 1 : -1)][0]);
    }
    if (modo !== 'h') { modo = null; return; }
    modo = null;
    const dx = (e.changedTouches?.[0]?.clientX ?? x0) - x0, vel = Math.abs(dx) / Math.max(1, Date.now() - t0);
    const sec = destino;
    const va = sec && sec !== 'subtab' && (Math.abs(dx) > innerWidth * 0.25 || (vel > 0.45 && Math.abs(dx) > 40));
    vista.style.transition = 'transform .15s cubic-bezier(.4,0,1,1), opacity .15s';
    if (!va) {                                                // vuelve a su sitio
      vista.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1.2), opacity .25s';
      vista.style.transform = ''; vista.style.opacity = ''; vista.style.willChange = '';
      moverIndicador(ORDEN.indexOf(seccion));
      return;
    }
    vista.style.transform = `translateX(${dx < 0 ? -100 : 100}%)`; vista.style.opacity = '0';
    moverIndicador(ORDEN.indexOf(sec));
    const v = vista;
    setTimeout(() => {
      v.style.transition = 'none'; v.style.transform = ''; v.style.opacity = ''; v.style.willChange = '';
      if (sec === 'run') runTab = 'resumen';
      irA(sec, dx < 0 ? 'left' : 'right');
    }, 140);
  };
  main.addEventListener('touchend', soltar, { passive: true });
  main.addEventListener('touchcancel', soltar, { passive: true });

  // Noria: vertical (dedo) o rueda del ratón.
  const v = $('#v-run');
  let ry = 0, rx = 0, rt = 0;
  v.addEventListener('touchstart', e => { const t = e.touches[0]; rx = t.clientX; ry = t.clientY; rt = Date.now(); }, { passive: true });
  v.addEventListener('touchend', e => {
    if (!e.target.closest('#rueda') || Date.now() - rt > 800) return;
    const t = e.changedTouches[0], dx = t.clientX - rx, dy = t.clientY - ry;
    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) girarRueda(dy < 0 ? 1 : -1);
  }, { passive: true });
  let bloqueo = 0;
  v.addEventListener('wheel', e => {
    if (!e.target.closest('#rueda') || Date.now() < bloqueo) return;
    e.preventDefault(); bloqueo = Date.now() + 350; girarRueda(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
}

const valClase = a => (/Valoración:\*\* bien/.test(a) ? 'ok' : /Valoración:\*\* regular/.test(a) ? 'mid' : 'bad');
const valIcon = a => `<span class="val-ic ${valClase(a)}">${{ ok: ICO.ok, mid: ICO.medio, bad: ICO.mejora }[valClase(a)]}</span>`;
const tituloAn = a => (a.match(/\*\*Valoración:\*\* \w+ — (.+)/) || [])[1] || 'Ver análisis';

function renderStrava(body, r) {
  const sv = r.all.filter(e => e.fuente === 'strava');
  const reg = parseCsv(D.stravaReg?.text || 'x').rows;
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
        <div><span>En Strava</span><b>${reg.length || sv.length}</b></div>
        <div><span>Última</span><b>${fCorta((reg.at(-1) || sv.at(-1))?.fecha)}</b></div>
        <div><span>Comprobado</span><b id="st-run">—</b></div>
      </div>
      ${reg.length ? `<div class="st-list">${reg.slice().reverse().slice(0, 15).map(x => `<div class="item">
        <span class="date mini-date"><small>${DIAS[new Date(x.fecha + 'T12:00:00Z').getUTCDay()]}</small><b>${new Date(x.fecha + 'T12:00:00Z').getUTCDate()}</b></span>
        <span class="grow"><b>${esc(x.distancia_km)} km</b> · ${esc(x.ritmo_min_km)}/km<br><small class="muted">${esc(x.nombre)}</small></span>
        <span class="tag ${x.uso.startsWith('dup') ? '' : 'st'}">${x.uso.startsWith('dup') ? 'Mi Fitness' : 'importada'}</span></div>`).join('')}</div>` : ''}
      ${u && u.fecha < addDays(ahora().fecha, -2) && r.all.some(e => e.fecha > u.fecha)
        ? `<p class="aviso">${ICO.aviso}Tienes entrenos posteriores al ${fCorta(u.fecha)} que no han llegado a Strava. Revisa en Mi Fitness → Perfil → Cuentas vinculadas → Strava.</p>` : ''}
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
  return `Eres APEX, mi entrenador de running (media distancia, prevención de lesiones). Hoy es ${fecha}.
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
Estima también el tiempo de recuperación en horas como lo haría Mi Fitness (rodaje suave 12–24 · rodaje exigente 24–36 · series o tempo 36–48 · tirada larga o competición 48–72), según intensidad, FC, RPE y carga reciente.
Responde SOLO JSON:
{"recuperacion_h":24,"valoracion":"bien|regular|mejorable","titulo":"frase corta (máx 8 palabras)","positivo":["máx 3, frases cortas"],"mejorar":["máx 3, frases cortas"],
"ajuste":{"necesario":false,"motivo":"una frase","sesiones":[{"fecha":"AAAA-MM-DD","dia":"mar","sesion":"rodaje Z2","detalle":"..."}]}}`;
}
async function analizarSesion(e) {
  // Otro dispositivo (móvil/iPad) puede haberla analizado ya: se comprueba antes de gastar una llamada a Gemini.
  try {
    const fresco = await getFile(FILES.analisis);
    D.analisis = fresco;
    if (fresco.text.includes(`<!-- ref:${refDe(e)} -->`)) return analisisDe(e);
  } catch { /* si falla la comprobación, se analiza igualmente */ }
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
  // Sin el dato de Mi Fitness, la recuperación la estima APEX (nunca pisa la de Mi Fitness).
  if (!csv('recuperacion').rows.some(r => r.fecha === e.fecha)) await guardarRecuperacion(e.fecha, out.recuperacion_h, 'estimado').catch(() => {});
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

// ---------- Inmersión: análisis a pantalla completa sobre negro ----------
const IC = {
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ritmo: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>',
  corazon: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/><path d="M7.5 12h2.5l1.5-2 2 4 1.5-2h1.5"/>',
  llama: '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 4 4 4 6 1-1 2-2 2-3 2 2 2 4 2 7 0 3-2 6-6 6z"/>',
  monte: '<path d="M3 19l6-10 4 6 3-4 5 8z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  diana: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  calendario: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  nota: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>',
  trofeo: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>',
  regular: '<circle cx="12" cy="12" r="9"/><path d="M8 15h8M9 9.5h.01M15 9.5h.01"/>',
  llave: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>',
};
const ic = k => `<svg viewBox="0 0 24 24" class="im-ic">${IC[k]}</svg>`;

// Abre/cierra la capa negra con la animación de círculo desde el punto tocado.
function abrirCapa(ev, clase, html) {
  const ov = $('#inmersion');
  ov.style.setProperty('--x', (ev?.clientX ?? innerWidth / 2) + 'px');
  ov.style.setProperty('--y', (ev?.clientY ?? innerHeight / 3) + 'px');
  ov.className = clase;
  ov.ontouchstart = ov.ontouchend = ov.onwheel = null;
  ov.innerHTML = html;
  ov.hidden = false;
  document.body.classList.add('inmerso');
  navPush();
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('open')));
  const cerrar = () => {
    ov.classList.remove('open');
    setTimeout(() => { ov.hidden = true; ov.innerHTML = ''; document.body.classList.remove('inmerso'); }, 560);
  };
  $('#im-close').addEventListener('click', cerrar);
  return cerrar;
}

// Próximas sesiones a pantalla completa: solo la noria.
function abrirProximas(tarjetasHTML, n, ev, inicio = 0) {
  ruedaIdx = inicio; ruedaN = n;
  abrirCapa(ev, 'im-prox', `
    <button class="im-close" id="im-close" aria-label="Cerrar">${ICON_X}</button>
    <div class="prox-wrap">
      <div class="rueda" id="rueda">${tarjetasHTML}
        ${n > 1 ? `<div class="rueda-dots">${Array.from({ length: n }, (_, i) => `<i data-d="${i}"></i>`).join('')}</div>` : ''}
      </div>
      ${n > 1 ? '<p class="rueda-hint">Desliza ↑↓ · toca para ver la sesión</p>' : ''}
    </div>`);
  colocarRueda();
  $$('#rueda .next').forEach(c => c.addEventListener('click', () => {
    const i = +c.dataset.i;
    if (i !== ruedaIdx) { ruedaIdx = i; colocarRueda(); } else c.classList.toggle('flipped');
  }));
  const ov = $('#inmersion');
  let y0 = 0, x0 = 0, bloqueo = 0;
  ov.ontouchstart = e => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; };
  ov.ontouchend = e => {
    const dy = e.changedTouches[0].clientY - y0, dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) girarRueda(dy < 0 ? 1 : -1);
  };
  ov.onwheel = e => { if (Date.now() < bloqueo) return; e.preventDefault(); bloqueo = Date.now() + 350; girarRueda(e.deltaY > 0 ? 1 : -1); };
}

function inmersion(e, ev) {
  const ov = $('#inmersion'), a = analisisDe(e), t = tipoSesion(`${e.tipo} ${e.notas}`);
  const x = ev?.clientX ?? innerWidth / 2, y = ev?.clientY ?? innerHeight / 3;
  const pos = a ? a.split('\n').filter(l => l.startsWith('- ✅')).map(l => l.slice(4)) : [];
  const mej = a ? a.split('\n').filter(l => l.startsWith('- 🔧')).map(l => l.slice(4)) : [];
  const prop = a ? propuestaDe(a) : [], aplicado = a?.includes('ajuste aplicado');
  const motivo = a ? (a.match(/\*\*Ajuste propuesto:\*\* (.+)/) || [])[1] || '' : '';
  const d = new Date(e.fecha + 'T12:00:00Z'), vc = a ? valClase(a) : '';
  const stat = (k, lbl, v) => v ? `<div class="im-stat">${ic(k)}<b>${esc(v)}</b><span>${lbl}</span></div>` : '';
  ov.style.setProperty('--x', x + 'px'); ov.style.setProperty('--y', y + 'px');
  ov.className = `t-${t}`;
  ov.ontouchstart = ov.ontouchend = ov.onwheel = null;
  ov.innerHTML = `
    <button class="im-close" id="im-close" aria-label="Cerrar">${ICON_X}</button>
    <div class="im-content">
      <div class="im-hero"><span class="sym big">${SIMBOLO[t]}</span>
        <b class="im-km">${esc(e.distancia_km)}<small>km</small></b>
        <span class="im-sub">${esc(e.tipo)} · ${DIAS_LARGOS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}</span></div>
      <div class="im-stats">
        ${stat('reloj', 'tiempo', e.duracion_min && e.duracion_min + "'")}${stat('ritmo', 'ritmo', e.ritmo_min_km && e.ritmo_min_km + '/km')}
        ${stat('corazon', 'FC media', e.fc_media && e.fc_media + ' ppm')}${stat('llama', 'esfuerzo', e.rpe && 'RPE ' + e.rpe)}
        ${stat('monte', 'desnivel', e.desnivel_m && '+' + e.desnivel_m + ' m')}
      </div>
      ${a ? `
        <div class="im-val ${vc}">${ic({ ok: 'trofeo', mid: 'regular', bad: 'llave' }[vc])}<b>${esc(tituloAn(a))}</b></div>
        ${pos.length ? `<section class="im-sec ok"><h4>${ic('check')} Lo que has hecho bien</h4>${pos.map(p => `<div class="im-item">${ic('check')}<span>${esc(p)}</span></div>`).join('')}</section>` : ''}
        ${mej.length ? `<section class="im-sec mej"><h4>${ic('diana')} A mejorar</h4>${mej.map(p => `<div class="im-item">${ic('diana')}<span>${esc(p)}</span></div>`).join('')}</section>` : ''}
        <section class="im-sec plan"><h4>${ic('calendario')} Plan</h4>
          ${prop.length ? `<p class="im-mot">${esc(motivo)}</p>
            ${prop.map(s => `<div class="im-item"><span class="im-day">${esc(s.dia)} ${new Date(s.fecha + 'T12:00:00Z').getUTCDate()}</span><span><b>${esc(s.sesion)}</b><br><small>${esc(s.detalle)}</small></span></div>`).join('')}
            ${aplicado ? '<p class="im-ok">✓ Ajuste aplicado</p>' : '<button class="im-btn" id="im-apply">Aplicar al plan</button>'}`
          : '<p class="im-mot">El plan sigue igual: no hace falta ajustar nada.</p>'}
        </section>`
      : `<button class="im-btn" id="im-go">${cfg.gemini ? 'Analizar este entreno' : 'Añade la clave de Gemini en Ajustes'}</button>`}
      ${e.notas ? `<section class="im-sec"><h4>${ic('nota')} Notas</h4><p class="im-mot">${esc(e.notas)}</p></section>` : ''}
    </div>`;
  ov.hidden = false;
  document.body.classList.add('inmerso');
  navPush();
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('open')));
  const cerrar = () => {
    ov.classList.remove('open');
    setTimeout(() => { ov.hidden = true; document.body.classList.remove('inmerso'); }, 560);
  };
  $('#im-close').addEventListener('click', cerrar);
  $('#im-apply')?.addEventListener('click', async () => {
    const b = $('#im-apply'); b.disabled = true; b.textContent = 'Aplicando…';
    try { await aplicarAjuste(e, a); toast('Plan actualizado ✓'); cerrar(); render(); }
    catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Aplicar al plan'; }
  });
  $('#im-go')?.addEventListener('click', async () => {
    if (!cfg.gemini) { cerrar(); irA('ajustes'); return; }
    const b = $('#im-go'); b.disabled = true; b.innerHTML = '<i class="spinner"></i> Analizando…';
    try { await analizarSesion(e); inmersion(e); } catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Analizar este entreno'; }
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
      <p class="muted">APEX · versión ${VERSION}</p>
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
let valPend = null;        // valoración de APEX del plato pendiente { tono, texto }
let notaFoto = '';         // comentario de contexto para la próxima foto
// El plato sin guardar sobrevive a cerrar la app (la foto ya se ha borrado al analizarla).
try { const g = JSON.parse(localStorage.getItem('plato') || 'null'); if (g?.plato?.length) ({ plato, valPend, comidaSel } = g); } catch { /* nada guardado */ }
const recordarPlato = () => { try { localStorage.setItem('plato', JSON.stringify({ plato, valPend, comidaSel })); } catch { /* sin almacenamiento */ } };
let stream = null;

function abrirSheet(vista) {
  $('#sheet').hidden = false;
  navPush();
  if (seccion === 'fuerza') return formFuerza();
  if (seccion === 'run') { $('#sheet-title').textContent = 'Registrar entreno'; $('#sheet-body').innerHTML = '<div id="seg-body"></div>'; formEntreno(); return; }
  comidaSel ??= comidaPorHora(ahora().h);
  if (vista === 'cierre') return vistaCierre();
  if (vista === 'peso') return vistaPeso();
  vistaInicio();
}
function cerrarSheet() { pararCamara(); $('#sheet').hidden = true; }

function cabeceraComida() {
  return `<div class="chips meal-chips">${COMIDAS.map(c => `<button class="chip ${c === comidaSel ? 'on' : ''}" data-cs="${c}">${EMOJI[c]}${c}</button>`).join('')}</div>`;
}
function bindCabecera(rerender) {
  $$('[data-cs]').forEach(b => b.addEventListener('click', () => { comidaSel = b.dataset.cs; rerender(); }));
}

function vistaInicio() {
  $('#sheet-title').textContent = 'Añadir';
  $('#sheet-body').innerHTML = `
    ${cabeceraComida()}
    <p class="photo-title">Foto del plato · la IA detecta alimentos y kcal</p>
    <input id="foto-ctx" class="foto-ctx" maxlength="160" value="${esc(notaFoto)}" autocomplete="off"
      placeholder="Contexto opcional · p. ej. cena con amigos, compartido entre 3, frito en aceite">
    <div class="photo-pick">
      <label class="tile hero-tile" for="foto-in"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><path d="M3.5 8.5h3.2l1.8-2.5h7l1.8 2.5h3.2v10.5h-17z"/><circle cx="12" cy="13.5" r="3.6"/></svg></span><b>Hacer foto</b>
        <input type="file" id="foto-in" accept="image/*" capture="environment" hidden></label>
      <label class="tile hero-tile alt" for="gal-in"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-5-5-9.5 9"/></svg></span><b>Galería</b>
        <input type="file" id="gal-in" accept="image/*" hidden></label>
    </div>
    <div class="tiles">
      <button class="tile" data-v="barras"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><path d="M4 5v14M7 5v14M9.5 5v14M13 5v14M15.5 5v14M20 5v14"/></svg></span><b>Código de barras</b></button>
      <button class="tile" data-v="texto"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></span><b>Describir</b></button>
      <button class="tile" data-v="base"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><path d="M5 4.5h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17.5a3 3 0 0 1 3-3h11"/></svg></span><b>Mi base</b></button>
      <button class="tile" data-v="peso"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 10a4.5 4.5 0 0 1 7 0l-3.5 3.5"/></svg></span><b>Peso</b></button>
      <button class="tile" data-v="cierre"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5l1-3.5h4l1 3.5M9 17.5l1 3.5h4l1-3.5M12 10v2.2l1.3 1"/></svg></span><b>Cerrar día</b></button>
    </div>
    ${platoHTML()}`;
  bindCabecera(vistaInicio);
  bindPlato(vistaInicio);
  $('#foto-ctx').addEventListener('input', e => (notaFoto = e.target.value));
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
  if (!plato.length) valPend = null;
  recordarPlato();
  if (!plato.length) return '';
  const tot = plato.reduce((s, x) => s + x.kcal, 0);
  return `<div class="plato">
    <div class="plato-head"><b>${EMOJI[comidaSel]}Tu ${comidaSel}</b><span>${fmt(tot)} kcal</span></div>
    ${valPend ? `<p class="meal-val t-${esc(valPend.tono)}"><span class="mv-ico">${ICO.apex}</span><span class="mv-txt">${esc(valPend.texto)}</span></p>` : ''}
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
    // La valoración de la foto vale si el plato es toda la comida; si se suma a otra ya registrada, la app la rehace entera.
    const fv = plato[0].fecha || fecha, previas = csv('comidas').rows.filter(r => r.fecha === fv && r.comida === comidaSel).length;
    const kcalPlato = Math.round(plato.reduce((s, x) => s + x.kcal, 0));
    if (valPend && !previas) await guardarValoracion(fv, comidaSel, { ...valPend, kcal: kcalPlato }).catch(() => {});   // no bloquea la comida
    plato = []; valPend = null; recordarPlato(); abiertas.add(comidaSel); cerrarSheet(); toast('Comida guardada ✓'); render();
  } catch (e) { toast(e.message); btn.disabled = false; }
}
// Una valoración por comida y día (la última sustituye a la anterior).
const VAL_COLS = ['fecha', 'comida', 'tono', 'texto', 'kcal'];   // kcal = subtotal de la comida al valorarla
const guardarValoracion = (f, c, v) => modify('valoraciones', t => {
  const ls = (t.trim() ? t : VAL_COLS.join(',')).split('\n').filter(l => l.trim() && !l.startsWith(`${f},${c},`));
  return [...ls, toLine(VAL_COLS, { fecha: f, comida: c, ...v })].join('\n');
}, `valoración ${c}`);
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
// Modelos a probar, en orden: el último que funcionó → alias estable "flash-latest" → Flash por versión → Flash-Lite.
// Si uno está saturado se salta al siguiente (la saturación es por modelo).
async function modelosGemini() {
  let lista = cfg.gModels;
  if (!lista?.length || cfg.gModelsV !== 2 || Date.now() - (cfg.gModelsT || 0) > 3 * 864e5) {
    const r = await fetch(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(cfg.gemini)}`);
    if (!r.ok) throw new Error('Clave de Gemini no válida (Ajustes)');
    const ms = ((await r.json()).models || [])
      .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name).filter(n => /^models\/gemini-(flash-latest|flash-lite-latest|[\d.]+-flash(-lite)?)$/.test(n));
    const ver = n => parseFloat((n.match(/gemini-([\d.]+)/) || [])[1] || 0);
    const peso = n => (/flash-latest$/.test(n) ? 0 : /flash-lite-latest$/.test(n) ? 3 : n.includes('lite') ? 2 : 1);
    ms.sort((a, b) => peso(a) - peso(b) || ver(b) - ver(a));
    if (!ms.length) throw new Error('No encuentro un modelo Gemini Flash disponible para tu clave');
    lista = cfg.gModels = ms.slice(0, 6); cfg.gModelsT = Date.now(); cfg.gModelsV = 2; saveCfg();
  }
  return cfg.gOk && lista.includes(cfg.gOk) ? [cfg.gOk, ...lista.filter(m => m !== cfg.gOk)] : lista;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
const REGLAS_VAL = `Además escribe "valoracion" como un nutricionista amable y cercano (tú eres APEX y me hablas de tú):
- 1 o 2 frases cortas (máx. 150 caracteres) sin comas y sin sermones ni consejos médicos.
- Di qué tipo de comida es (p. ej. "Desayuno ligero y alto en proteína") y cómo encaja en mi día según el contexto.
- Si es copiosa o parece social (con amigos o celebración) quita la culpa: celebra que la he disfrutado y si cabe en el gasto del día dilo ("Has disfrutado de un día libre sin salirte del déficit"); si no cabe propón compensar con suavidad.
- "tono": "ligero", "equilibrado" o "copioso".`;
// Toda comida del día lleva valoración: si falta (código de barras, base, chat sin ella) o la comida ha cambiado, se genera aquí.
const valIntentadas = new Set();
let valEnMarcha = false, valOtraVez = false;
async function completarValoraciones(f) {
  if (!cfg.gemini || !D.valoraciones) return;
  if (valEnMarcha) { valOtraVez = true; return; }
  valEnMarcha = true;
  try { await rondaValoraciones(f); } finally { valEnMarcha = false; }
  if (valOtraVez) { valOtraVez = false; completarValoraciones(ahora().fecha); }
}
async function rondaValoraciones(f) {
  const vals = csv('valoraciones').rows.filter(v => v.fecha === f);
  for (const c of COMIDAS) {
    const rs = csv('comidas').rows.filter(r => r.fecha === f && r.comida === c);
    if (!rs.length) continue;
    const kc = Math.round(rs.reduce((s, r) => s + num(r.kcal), 0)), v = vals.find(x => x.comida === c);
    if (v && (v.kcal === '' || v.kcal == null || Math.round(num(v.kcal)) === kc)) continue;
    const clave = `${f}|${c}|${kc}`;
    if (valIntentadas.has(clave)) continue;     // un intento por sesión y versión de la comida
    valIntentadas.add(clave);
    try {
      const out = await geminiJSON(`Eres APEX, mi nutricionista deportivo. Valora mi ${c} completo: ${rs.map(r => `${r.alimento} ${r.cantidad_g} g (${r.kcal} kcal · P${r.prot_g} HC${r.hc_g} G${r.grasa_g})`).join('; ')}. Total ${kc} kcal.
${REGLAS_VAL}
${contextoDia(f, c)}
Responde SOLO con JSON: {"valoracion":"","tono":"equilibrado"}`);
      const val = valoracionDe(out);
      if (!val) continue;
      await guardarValoracion(f, c, { ...val, kcal: kc });
      if (seccion === 'nutri' && $('#sheet').hidden) render();
    } catch { /* sin cupo o sin conexión: se reintenta en la próxima sesión */ }
  }
}
// Contexto del día para que la valoración sepa cómo encaja la comida (déficit, entreno…).
function contextoDia(f, excluir) {
  const n = nutriDia(f), p = perfil();
  const otras = COMIDAS.filter(c => c !== excluir).map(c => [c, n.rows.filter(r => r.comida === c).reduce((s, r) => s + num(r.kcal), 0)]).filter(x => x[1]);
  const ya = otras.map(([c, k]) => `${c} ${Math.round(k)} kcal`).join('; ');
  n.t.kcal = otras.reduce((s, x) => s + x[1], 0);
  const act = csv('actividad').rows.slice(-14).map(r => num(r.kcal_activas)).filter(Boolean);
  const media = act.length ? Math.round(act.reduce((a, b) => a + b, 0) / act.length) : 0;
  const run = csv('entrenos').rows.filter(e => e.fecha === f).map(e => `${e.distancia_km} km`).join(' + ');
  const fz = csv('fuerza').rows.some(e => e.fecha === f);
  return `Contexto de mi día (${fechaLarga(f)}): sin contar esta comida llevo ${ya ? `${ya} (total ${Math.round(n.t.kcal)} kcal)` : '0 kcal'}.
Gasto: TMB ${n.tmb} kcal + kcal activas del reloj ${n.act ? `= ${Math.round(n.gasto)} kcal hoy` : `(aún sin cerrar el día; mi media es ${media || '≈600'} kcal activas)`}.
${run ? `Hoy he corrido ${run}.` : 'Hoy no he corrido.'}${fz ? ' Hoy he hecho fuerza.' : ''} Objetivo: ${p.objetivo || 'perder grasa'}${n.protRef ? `; proteína de referencia ${n.protRef} g/día` : ''}.`;
}
const TONOS = ['ligero', 'equilibrado', 'copioso'];
function valoracionDe(out) {
  const texto = String(out.valoracion || '').replace(/\s*,\s*/g, ' – ').replace(/["\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  return texto ? { tono: TONOS.includes(out.tono) ? out.tono : 'equilibrado', texto } : null;
}
function promptNutri(texto, fecha = ahora().fecha, nota = '') {
  const base = csv('alimentos').rows.map(a => a.alimento).join(', ');
  return `Eres APEX, mi nutricionista deportivo. Analiza ${texto ? 'la descripción' : 'la foto'} de una comida y desglosa cada ingrediente.
Reglas:
- Gramos en el "tope alto realista" (mejor pasarse que quedarse corto).
- No añadas aceite, mantequilla ni salsas si no son evidentes; si se ven o se mencionan, inclúyelos como ingrediente aparte.
- La sal aporta 0 kcal.
- Si un ingrediente coincide con uno de esta base, usa exactamente ese nombre: ${base}.
- Nombres cortos en español, sin comas.
${texto ? `Descripción del usuario: "${texto}"` : ''}
${nota ? `Comentario del usuario sobre la foto (úsalo para raciones, ingredientes ocultos, cocinado y para la valoración): "${nota}"` : ''}
${REGLAS_VAL}
${contextoDia(fecha)}
Responde SOLO con JSON: {"plato":"nombre corto","items":[{"alimento":"","cantidad_g":0,"kcal":0,"prot_g":0,"hc_g":0,"grasa_g":0}],"valoracion":"","tono":"equilibrado"}`;
}
async function preguntarGemini(texto, dataUrl, onIntento, fecha, nota) {
  const out = await geminiJSON(promptNutri(texto, fecha, nota), dataUrl, onIntento);
  if (!Array.isArray(out.items) || !out.items.length) throw new Error('No he reconocido alimentos; prueba con otra foto o descríbelo');
  return out;
}
// Un intento por modelo (máx. 5), con límite de 25 s cada uno. onIntento(n, total) permite mostrar el progreso.
async function geminiJSON(prompt, dataUrl, onIntento) {
  if (!cfg.gemini) throw new Error('Añade tu clave gratuita de Gemini en Ajustes');
  const parts = [{ text: prompt }];
  if (dataUrl) parts.push({ inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } });
  const body = JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } });
  const modelos = (await modelosGemini()).slice(0, 5);
  const fallos = [];
  for (let k = 0; k < modelos.length; k++) {
    const model = modelos[k], corto = model.replace('models/', '');
    onIntento?.(k + 1, modelos.length);
    const ctl = new AbortController(), reloj = setTimeout(() => ctl.abort(), 25000);
    let r;
    try {
      r = await fetch(`${GEMINI}/${model}:generateContent?key=${encodeURIComponent(cfg.gemini)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctl.signal });
    } catch (e) {
      clearTimeout(reloj);
      if (e.name === 'AbortError') { fallos.push(`${corto}: sin respuesta en 25 s`); continue; }
      throw new Error('Sin conexión con Gemini');
    }
    clearTimeout(reloj);
    if (r.ok) {
      const j = await r.json();
      const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
      try { const out = JSON.parse(txt); if (cfg.gOk !== model) { cfg.gOk = model; saveCfg(); } return out; }
      catch { fallos.push(`${corto}: respuesta no válida`); continue; }
    }
    if (r.status === 400 || r.status === 403) {
      const msg = (await r.json().catch(() => ({})))?.error?.message || '';
      if (/api key|API_KEY|permission/i.test(msg) || r.status === 403) throw new Error('Clave de Gemini no válida (Ajustes)');
      fallos.push(`${corto}: ${r.status}`); continue;          // p. ej. el modelo no admite la petición → siguiente
    }
    if (r.status === 404) { cfg.gModels = []; saveCfg(); fallos.push(`${corto}: retirado`); continue; }
    fallos.push(`${corto}: ${r.status === 429 ? 'cupo agotado' : r.status === 503 || r.status === 500 ? 'saturado' : r.status}`);
    if (cfg.gOk === model) { cfg.gOk = ''; saveCfg(); }
    await dormir(500);
  }
  const soloCupo = fallos.length && fallos.every(f => /cupo/.test(f));
  throw new Error(soloCupo ? 'Has agotado el cupo gratuito de Gemini por ahora; vuelve a intentarlo más tarde'
    : `Gemini no responde ahora (${fallos.join(' · ')})`);
}
// foto (opcional): una foto pendiente de otro momento conserva su fecha y hora.
function añadirResultado(out, foto) {
  const cuando = foto ? { fecha: foto.fecha, hora: foto.hora } : {};
  for (const it of out.items) {
    const g = num(it.cantidad_g);
    plato.push({ ...(desdeBase(it.alimento, g) || {
      alimento: limpio(it.alimento), cantidad_g: Math.round(g), kcal: Math.round(num(it.kcal)), prot_g: r1(num(it.prot_g)),
      hc_g: r1(num(it.hc_g)), grasa_g: r1(num(it.grasa_g)), fuente: 'estimado',
    }), ...cuando });
  }
  valPend = valoracionDe(out) || valPend;
}
// src: un File recién hecho o una foto pendiente { id, dataUrl, fecha, hora, comida, nota }.
async function analizarFoto(src) {
  let foto = src;
  if (src instanceof Blob) {
    let dataUrl;
    try { dataUrl = await fotoBase64(src); } catch { toast('No puedo leer esta imagen; prueba con otra'); return; }
    const { fecha, hora } = ahora();
    foto = { id: Date.now(), dataUrl, fecha, hora, comida: comidaSel, nota: limpio(notaFoto) };
    await guardarFoto(foto);   // a salvo hasta que el análisis termine bien
  }
  comidaSel = foto.comida || comidaSel;
  $('#sheet-title').textContent = 'Analizando…';
  $('#sheet-body').innerHTML = `<div class="scan"><img src="${foto.dataUrl}" alt=""><i class="scan-line"></i></div>
    ${foto.nota ? `<p class="center foto-nota">“${esc(foto.nota)}”</p>` : ''}
    <p class="muted center" id="an-estado">Detectando alimentos y raciones…</p>`;
  try {
    const out = await preguntarGemini('', foto.dataUrl, (n, t) => {
      if (n > 1 && $('#an-estado')) $('#an-estado').textContent = `El modelo anterior está saturado · probando otro (${n}/${t})…`;
    }, foto.fecha, foto.nota);
    añadirResultado(out, foto);
    await borrarFoto(foto.id);
    notaFoto = '';
    pintarPendientes();
    vistaInicio();
    toast(`${out.plato || 'Plato'} · ${out.items.length} alimentos`);
  } catch (e) {
    pintarPendientes();
    $('#sheet-title').textContent = 'No se pudo analizar';
    $('#sheet-body').innerHTML = `<div class="scan"><img src="${foto.dataUrl}" alt=""></div>
      <p class="aviso">${ICO.aviso}<span>${esc(e.message)}</span></p>
      <p class="muted center" style="margin-top:10px">La foto queda guardada en Nutrición › Fotos sin analizar: podrás reintentarlo sin repetirla.</p>
      <input id="an-nota" class="foto-ctx" maxlength="160" value="${esc(foto.nota || '')}" autocomplete="off" placeholder="Contexto opcional para el análisis">
      <div class="stack" style="margin-top:12px">
        <button class="btn primary" id="an-retry">Reintentar ahora</button>
        <button class="btn ghost" id="an-luego">Reintentar más tarde</button>
        <button class="btn ghost" id="an-texto">Describirlo con texto</button>
      </div>`;
    const notaNueva = async () => {
      const n = limpio($('#an-nota').value);
      if (n !== (foto.nota || '')) { foto.nota = n; await guardarFoto(foto); }
    };
    $('#an-retry').addEventListener('click', async () => { await notaNueva(); analizarFoto(foto); });
    $('#an-nota').addEventListener('change', notaNueva);
    $('#an-luego').addEventListener('click', () => { cerrarSheet(); render(); });
    $('#an-texto').addEventListener('click', vistaTexto);
  }
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
      <label class="tile hero-tile run-tile" for="e-cam"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><path d="M3.5 8.5h3.2l1.8-2.5h7l1.8 2.5h3.2v10.5h-17z"/><circle cx="12" cy="13.5" r="3.6"/></svg></span><b>Hacer foto</b>
        <input type="file" id="e-cam" accept="image/*" capture="environment" hidden></label>
      <label class="tile hero-tile alt run-alt" for="e-gal"><span class="tile-ico"><svg viewBox="0 0 24 24" class="ti-svg"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-5-5-9.5 9"/></svg></span><b>Galería</b>
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
  let recup = null;   // tiempo de recuperación leído de la captura de Mi Fitness
  const leerCaptura = async file => {
    $('#e-estado').innerHTML = '<i class="spinner"></i> Leyendo la captura…';
    try {
      const x = await geminiJSON(`Extrae los datos de esta captura de una app o reloj de running (Mi Fitness, Strava, Xiaomi…).
Responde SOLO JSON: {"fecha":"AAAA-MM-DD o null","tipo":"rodaje|series|tempo|tirada|fartlek|cuestas|competicion","distancia_km":0,"duracion_min":0,"fc_media":null,"fc_max":null,"cadencia":null,"desnivel_m":null,"recuperacion_h":null,"hora_fin":null,"extra":"parciales u otros datos útiles, breve"}
duracion_min en minutos decimales (tiempo en movimiento si aparece). recuperacion_h = "Tiempo de recuperación" en horas (Mi Fitness lo destaca al acabar). hora_fin = hora de fin de la sesión "HH:MM" si aparece (o la de inicio + duración). Usa null si un dato no aparece.`, await fotoBase64(file));
      recup = num(x.recuperacion_h) > 0 ? { h: num(x.recuperacion_h), fin: x.hora_fin || '' } : null;
      if (x.fecha && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha)) $('#e-f').value = x.fecha;
      if (x.tipo) $('#e-tipo').value = x.tipo;
      if (x.distancia_km) $('#e-km').value = r1(num(x.distancia_km) * 100) / 100;
      if (x.duracion_min) { const m = num(x.duracion_min); $('#e-t').value = `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`; }
      if (x.fc_media) $('#e-fc').value = Math.round(num(x.fc_media));
      const extra = [x.fc_max && `FC máx ${x.fc_max}`, x.cadencia && `cadencia ${x.cadencia}`, x.desnivel_m && `D+${x.desnivel_m}`, x.extra].filter(Boolean).map(limpio).join('; ');
      if (extra) $('#e-notas').value = extra;
      $('#e-estado').textContent = `✓ Datos leídos${recup ? ` · recuperación ${recup.h} h` : ''}. Añade tu RPE y sensaciones y guarda.`;
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
      if (recup) await guardarRecuperacion(f, recup.h, 'mi fitness', recup.fin).catch(() => {});
      // Análisis del entrenador sobre la sesión guardada
      const guardada = csv('entrenos').rows.filter(r => r.fecha === f).at(-1);
      if (guardada && cfg.gemini) {
        $('#e-save').disabled = true; $('#e-save').innerHTML = '<i class="spinner"></i> Analizando el entreno…';
        try { await analizarSesion(guardada); runTab = 'resumen'; cerrarSheet(); render(); inmersion(guardada); return; }
        catch (err) { toast(err.message); }
      }
      cerrarSheet(); toast('Entreno guardado ✓'); render();
    } catch (e) { toast(e.message); }
  });
}

// ---------- navegación ----------
function irA(sec, dir) {
  seccion = sec;
  document.body.dataset.sec = sec;
  ['nutri', 'run', 'fuerza', 'ajustes'].forEach(s => ($(`#v-${s}`).hidden = s !== sec));
  if (dir) { const v = $(`#v-${sec}`); v.classList.remove('slide-left', 'slide-right'); void v.offsetWidth; v.classList.add('slide-' + dir); }
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === sec));
  moverIndicador(ORDEN.includes(sec) ? ORDEN.indexOf(sec) : null);
  navPush();
  const nombre = { nutri: 'Nutrición', run: 'Running', fuerza: 'Fuerza', ajustes: 'Ajustes' }[sec];
  $('#titulo').innerHTML = `<span class="sec-txt">${nombre}</span>`;   // mismo estilo que la palabra APEX
  $('#titulo').setAttribute('aria-label', nombre);
  $('#titulo').classList.remove('pop'); void $('#titulo').offsetWidth; $('#titulo').classList.add('pop');
  document.querySelector('meta[name=theme-color]').content = (matchMedia('(prefers-color-scheme: dark)').matches ? '#000000' : getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#ff6a00');
  window.scrollTo(0, 0);
  if (sec === 'ajustes' || Object.keys(D).length) render();
  else if (cfg.token) $(`#v-${sec}`).innerHTML = esqueleto();
  else $(`#v-${sec}`).innerHTML = `<div class="empty card">Aún no hay datos en este dispositivo.<br><br>
    <button class="btn primary" onclick="irA('ajustes')">Conectar en Ajustes</button>
    <p class="muted" style="margin-top:10px">En iPad/iPhone, pega las claves dentro de la app instalada: no comparte memoria con Safari.</p></div>`;
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  const tipo = /✓|guardad|actualizad|conectado|borrado|cerrado/i.test(msg) ? 'ok'
    : /error|no válid|no encuentro|falló|límite|saturado|sin conexión|conflicto|indica|pon al menos/i.test(msg) ? 'err' : 'info';
  t.className = 'toast ' + tipo;
  t.innerHTML = `${{ ok: ICO.ok, err: ICO.aviso, info: ICO.medio }[tipo]}<span>${esc(String(msg).replace(/\s*✓$/, ''))}</span>`;
  t.hidden = false; t.classList.remove('sale'); void t.offsetWidth; t.classList.add('entra');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.add('sale'); setTimeout(() => (t.hidden = true), 250); }, 3600);
}
const esqueleto = () => `<div class="sk sk-hero"></div><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card corta"></div>`;

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

$$('.tabs button').forEach(b => b.addEventListener('click', () => irA(b.dataset.tab)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) irA(g.dataset.goto); });
$('#fab').addEventListener('click', () => abrirSheet());
$('#sheet-close').addEventListener('click', cerrarSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') cerrarSheet(); });
$('#btn-sync').addEventListener('click', cargar);
$('#btn-ajustes').addEventListener('click', () => irA(seccion === 'ajustes' ? 'nutri' : 'ajustes'));
// Al volver a la app solo se recarga si los datos tienen más de 2 minutos (el botón ⟳ siempre fuerza la recarga).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cfg.token && $('#sheet').hidden && Date.now() - ultimaCarga > 120000) cargar();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

gestos();
irA(location.hash === '#run' ? 'run' : 'nutri');
// Pantalla de carga: 3 s (lo que tarda la rueda) mientras se cargan los datos por detrás.
const splashFin = new Promise(r => setTimeout(r, 3000));
const cargaInicial = cargar();
Promise.all([splashFin, cargaInicial.catch(() => {})]).then(() => {
  const s = $('#splash'); if (!s) return;
  s.classList.add('fuera');
  setTimeout(() => s.remove(), 500);
  // Reanima la rueda/contadores ahora que la pantalla es visible.
  if (seccion === 'nutri' || seccion === 'run') render();
  if (location.hash === '#comida' && cfg.token) abrirSheet();
});
