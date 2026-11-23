'use strict';
// Agente Running — PWA. Lee y escribe los CSV del repo privado vía API de GitHub.
// Fotos: Gemini (plan gratuito, clave del usuario). Códigos de barras: Open Food Facts.

const VERSION = '1.2.0';
const TZ = 'Europe/Madrid';
const FILES = {
  perfil: 'perfil.md', plan: 'running/plan.md',
  comidas: 'nutricion/comidas.csv', alimentos: 'nutricion/alimentos.csv', actividad: 'nutricion/actividad.csv',
  entrenos: 'running/entrenos.csv', peso: 'peso.csv',
};
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
cfg = { owner: 'antonioprieto22', repo: 'agentes-running', token: '', gemini: '', gModel: '', ...cfg };
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
      <span><b>Energía de hoy: ${fmt(n.t.kcal)} kcal ingeridas</b>
      <span class="muted">${bal != null ? `Balance ${bal > 0 ? '+' : ''}${fmt(bal)} kcal · ` : ''}Proteína ${Math.round(n.t.P)}/${n.protRef} g${bal != null && bal < -1000 ? ' · déficit alto para recuperar bien' : ''}</span></span>
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
      <p class="muted">Plan gratuito: Google puede usar las fotos para mejorar sus productos.${cfg.gModel ? ` Modelo: ${esc(cfg.gModel.replace('models/', ''))}.` : ''}</p>
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
    if (gem !== cfg.gemini) cfg.gModel = '';
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
async function modeloGemini() {
  if (cfg.gModel) return cfg.gModel;
  const r = await fetch(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(cfg.gemini)}`);
  if (!r.ok) throw new Error('Clave de Gemini no válida (Ajustes)');
  const ms = ((await r.json()).models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent') &&
    /gemini-[\d.]+-flash$/.test(m.name.replace('models/', '')));
  const ver = n => parseFloat((n.match(/gemini-([\d.]+)/) || [])[1] || 0);
  ms.sort((a, b) => ver(b.name) - ver(a.name));
  if (!ms.length) throw new Error('No encuentro un modelo Gemini Flash disponible');
  cfg.gModel = ms[0].name; saveCfg(); return cfg.gModel;
}
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
  if (!cfg.gemini) throw new Error('Añade tu clave gratuita de Gemini en Ajustes');
  for (let intento = 0; intento < 2; intento++) {
    const model = await modeloGemini();
    const parts = [{ text: promptNutri(texto) }];
    if (dataUrl) parts.push({ inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } });
    const r = await fetch(`${GEMINI}/${model}:generateContent?key=${encodeURIComponent(cfg.gemini)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    if (r.status === 404 && intento === 0) { cfg.gModel = ''; saveCfg(); continue; }
    if (r.status === 429) throw new Error('Límite gratuito de Gemini alcanzado; prueba en un rato');
    if (!r.ok) throw new Error(`Gemini respondió ${r.status}`);
    const j = await r.json();
    const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    const out = JSON.parse(txt);
    if (!Array.isArray(out.items) || !out.items.length) throw new Error('No he reconocido alimentos; prueba con otra foto o descríbelo');
    return out;
  }
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

irA(location.hash === '#run' ? 'run' : 'nutri');
cargar().then(() => { if (location.hash === '#comida' && cfg.token) abrirSheet(); });
