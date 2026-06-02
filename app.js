// ===== Main app =====

const STORAGE_KEY = 'ternium_optimizer_v2';
const STRAT_LBL = { best: 'Best loads', altura: 'Altura', peso: 'Peso', balanceada: 'Balanceada', antiguedad: 'Antigüedad' };

const CONSTRAINTS_DEFAULT = { H_MAX: 5200, W_MAX: 180000, N_MAX: 5, N_MIN: 2, SPACER: 80, CAL_P1_MAX: 25, MAX_ANTIG: 30 };

const state = {
  rolls: [],
  byMat: {},
  byStack: {},
  conflicts: [],
  format: null,
  fileName: '',
  selected: new Set(),
  hiddenPract: new Set(),
  confirmed: [],
  confirmedMats: new Set(),
  confirmCounter: 0,
  lambda: 0.15,
  topN: 10,
  mode: 'ranked',
  strategy: 'best',
  enforceLAV: true,
  enforceCalibreP1: true,
  activeTab: 'constructor',
  deletedMats: new Set()  // rollos eliminados permanentemente
};

// ===== Storage =====
function saveState() {
  try {
    const data = {
      confirmed: state.confirmed.map(c => ({
        id: c.id, mats: c.rolls.map(r => r.mat), strategy: c.strategy, lambda: c.lambda
      })),
      excludedMats: state.rolls.filter(r => r.excluded).map(r => r.mat),
      deletedMats: [...state.deletedMats],
      lambda: state.lambda, topN: state.topN, mode: state.mode, strategy: state.strategy,
      enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1,
      fileName: state.fileName,
      constraints: { ...optimizer.CONSTRAINTS }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { console.warn('No se pudo guardar estado:', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function restorePreferences(saved) {
  if (!saved) return;
  if (saved.lambda != null) state.lambda = saved.lambda;
  if (saved.topN != null) state.topN = saved.topN;
  if (saved.mode) state.mode = saved.mode;
  if (saved.strategy) state.strategy = saved.strategy;
  if (saved.enforceLAV != null) state.enforceLAV = saved.enforceLAV;
  if (saved.enforceCalibreP1 != null) state.enforceCalibreP1 = saved.enforceCalibreP1;
  if (saved.constraints) {
    optimizer.updateConstraints(saved.constraints);
    syncConstraintInputs();
  }
}

function syncConstraintInputs() {
  const C = optimizer.CONSTRAINTS;
  const el = id => document.getElementById(id);
  if (el('c-hmax')) el('c-hmax').value = C.H_MAX;
  if (el('c-wmax')) el('c-wmax').value = C.W_MAX;
  if (el('c-nmax')) el('c-nmax').value = C.N_MAX;
  if (el('c-nmin')) el('c-nmin').value = C.N_MIN;
  if (el('c-spacer')) el('c-spacer').value = C.SPACER;
  if (el('c-calp1')) el('c-calp1').value = C.CAL_P1_MAX;
  if (el('c-maxantig')) el('c-maxantig').value = C.MAX_ANTIG;
}

function restoreFromInventory(saved) {
  if (!saved) return;
  // Restore excluded
  const excludedSet = new Set(saved.excludedMats || []);
  state.rolls.forEach(r => { if (excludedSet.has(r.mat)) r.excluded = true; });
  // Restore deleted
  (saved.deletedMats || []).forEach(m => state.deletedMats.add(m));
  // Restore confirmed (only if all mats still exist)
  (saved.confirmed || []).forEach(savedCarga => {
    const rolls = savedCarga.mats.map(m => state.byMat[m]).filter(Boolean);
    if (rolls.length === savedCarga.mats.length && rolls.length >= 2) {
      const f = optimizer.loadFeasibility(rolls, { enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1 });
      if (optimizer.isFeasible(f)) {
        const bs = currentByStack();
        const cc = optimizer.craneCost(rolls, bs);
        const { score: phys, hEff, wEff } = optimizer.strategyScore(rolls, savedCarga.strategy || 'best');
        state.confirmCounter++;
        state.confirmed.push({
          id: state.confirmCounter, rolls, practica: rolls[0].practica, lav: rolls[0].lav,
          cc, phys, hEff, wEff, f, strategy: savedCarga.strategy || 'best', lambda: savedCarga.lambda || 0.15
        });
        rolls.forEach(r => state.confirmedMats.add(r.mat));
      }
    }
  });
}

// ===== Inventory management =====
function availableRolls() {
  return state.rolls.filter(r => !state.confirmedMats.has(r.mat) && !r.excluded && !state.deletedMats.has(r.mat));
}

// Elimina un rollo permanentemente del inventario (sesión actual)
function deleteRoll(mat) {
  if (!confirm(`¿Eliminar el rollo ${mat} del inventario?\nEsto lo quita de todas las sugerencias en esta sesión.`)) return;
  state.deletedMats.add(mat);
  state.selected.delete(mat);
  saveState();
  renderAll();
}
function currentByStack() { return optimizer.buildByStack(availableRolls()); }

// ===== Excel upload =====
async function handleFile(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const parsed = parseExcel(buf);
    state.rolls = parsed.rolls;
    state.format = parsed.format;
    state.fileName = file.name;
    state.byMat = {};
    state.rolls.forEach(r => state.byMat[r.mat] = r);
    state.conflicts = optimizer.detectConflicts(state.rolls);

    // Restore from storage AFTER inventory is loaded
    const saved = loadState();
    if (saved && saved.fileName === file.name) restoreFromInventory(saved);

    document.querySelector('.app-content').classList.add('loaded');
    document.getElementById('upload-stats').innerHTML =
      `<strong>${parsed.stats.total}</strong> rollos posicionados (${parsed.stats.cuadro} cuadro · ${parsed.stats.linea} línea)` +
      ` · <strong>${parsed.stats.unplaced}</strong> sin ubicación estructurada` +
      ` · formato <span class="format-pill">${parsed.format}</span>`;
    document.getElementById('upload-zone-msg').textContent = `${file.name} — recargar`;

    renderAll();
    saveState();
  } catch (e) {
    alert('Error al leer el Excel: ' + e.message);
    console.error(e);
  }
}

// ===== Suggestions =====
function suggest() {
  const opts = { enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1 };
  const pool = availableRolls();
  const fn = state.mode === 'ranked' ? optimizer.suggestRanked : optimizer.suggestDisjoint;
  return fn(pool, state.lambda, state.topN, state.strategy, opts);
}

// ===== Confirm / undo =====
function confirmCurrent() {
  const sels = [...state.selected].map(m => state.byMat[m]);
  const f = optimizer.loadFeasibility(sels, { enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1 });
  if (!optimizer.isFeasible(f)) return;
  const bs = currentByStack();
  const cc = optimizer.craneCost(sels, bs);
  const { score: phys, hEff, wEff } = optimizer.strategyScore(sels, state.strategy);
  state.confirmCounter++;
  state.confirmed.push({
    id: state.confirmCounter, rolls: sels, practica: sels[0].practica, lav: sels[0].lav,
    cc, phys, hEff, wEff, f, strategy: state.strategy, lambda: state.lambda
  });
  sels.forEach(r => state.confirmedMats.add(r.mat));
  state.selected.clear();
  saveState();
  renderAll();
}

function confirmFromSuggestion(mats) {
  const rolls = mats.map(m => state.byMat[m]);
  const f = optimizer.loadFeasibility(rolls, { enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1 });
  if (!optimizer.isFeasible(f)) return;
  const bs = currentByStack();
  const cc = optimizer.craneCost(rolls, bs);
  const { score: phys, hEff, wEff } = optimizer.strategyScore(rolls, state.strategy);
  state.confirmCounter++;
  state.confirmed.push({
    id: state.confirmCounter, rolls, practica: rolls[0].practica, lav: rolls[0].lav,
    cc, phys, hEff, wEff, f, strategy: state.strategy, lambda: state.lambda
  });
  rolls.forEach(r => state.confirmedMats.add(r.mat));
  mats.forEach(m => state.selected.delete(m));
  saveState();
  renderAll();
}

function undoConfirmed(id) {
  const idx = state.confirmed.findIndex(c => c.id === id);
  if (idx < 0) return;
  state.confirmed[idx].rolls.forEach(r => state.confirmedMats.delete(r.mat));
  state.confirmed.splice(idx, 1);
  saveState();
  renderAll();
}

function undoAll() {
  if (state.confirmed.length === 0) return;
  if (!confirm(`¿Deshacer las ${state.confirmed.length} cargas confirmadas?`)) return;
  state.confirmed.length = 0;
  state.confirmedMats.clear();
  saveState();
  renderAll();
}

// ===== Selection =====
function toggleSelected(mat) {
  const r = state.byMat[mat];
  if (!r || r.excluded || state.confirmedMats.has(mat)) return;
  if (state.selected.has(mat)) state.selected.delete(mat);
  else state.selected.add(mat);
  renderAll();
}

function toggleExcluded(mat) {
  const r = state.byMat[mat];
  if (!r) return;
  r.excluded = !r.excluded;
  if (r.excluded) state.selected.delete(mat);
  saveState();
  renderAll();
}

// ===== Tooltip =====
const tt = document.getElementById('tt');
function showTT(e, mat, justMove = false) {
  const r = state.byMat[mat];
  if (!r) return;
  if (justMove && tt.style.display === 'block') {
    tt.style.left = (e.clientX + 12) + 'px';
    tt.style.top = (e.clientY + 12) + 'px';
    return;
  }
  const bs = currentByStack();
  const stack = bs[`${r.fila}${r.col}`];
  const samePos = (stack && stack[r.nivel]) || [];
  const conflict = samePos.length > 1;
  const loc = r.col === '_' ? `Estiba ${r.fila} (línea) · ${r.nivel.toUpperCase()}` : `${r.fila}${r.col} · ${r.nivel.toUpperCase()}`;
  tt.innerHTML = `<div class="mat">${r.mat}</div>
    <div class="row"><span>Ubicación</span><span>${loc}</span></div>
    <div class="row"><span>Práctica</span><span>${r.practica} ${r.lav ? '· LAV' : ''}</span></div>
    <div class="row"><span>Ancho · Peso</span><span>${r.ancho} mm · ${(r.peso/1000).toFixed(1)} t</span></div>
    <div class="row"><span>Espesor · OD</span><span>${r.espesor} · ${r.od} mm</span></div>
    ${r.calibre ? `<div class="row"><span>Calibre</span><span>${r.calibre}</span></div>` : ''}
    <div class="row"><span>Antigüedad</span><span>${r.antig} d</span></div>
    <div class="row"><span>Cliente</span><span style="text-align:right;max-width:140px">${r.cliente}</span></div>
    ${r.auto ? `<div class="auto-note">ℹ Nivel auto-asignado por antigüedad</div>` : ''}
    ${conflict ? `<div class="conflict-note">⚠ ${samePos.length} rollos comparten esta posición</div>` : ''}
    <div style="font-size:9px;color:var(--text-tertiary);margin-top:6px;font-style:italic">Click derecho: ${r.excluded ? 'incluir' : 'excluir como dañado'}</div>`;
  tt.style.display = 'block';
  tt.style.left = (e.clientX + 12) + 'px';
  tt.style.top = (e.clientY + 12) + 'px';
}
function hideTT() { tt.style.display = 'none'; }

// ===== Rendering =====
function renderConflictBanner() {
  const b = document.getElementById('warn-banner');
  if (state.conflicts.length === 0) { b.style.display = 'none'; return; }
  b.style.display = 'flex';
  document.getElementById('warn-text').textContent =
    `${state.conflicts.length} posiciones con conflicto: ${state.conflicts.map(c=>c.stack.replace('_','')+'-'+c.nivel.toUpperCase()).join(', ')}`;
}

function showConflictsModal() {
  document.getElementById('modal-body').innerHTML = `<h3>Conflictos de posición</h3>
    <div class="subt">Estas posiciones tienen dos rollos asignados al mismo slot físico en el Excel. Físicamente imposible — error de captura. La app los conserva a ambos para optimización; el grid los muestra divididos con un ⚠.</div>` +
    state.conflicts.map(c => {
      let html = `<div class="conflict-block"><div class="loc">📍 ${c.stack.replace('_','')} · nivel ${c.nivel.toUpperCase()}</div>`;
      c.rolls.forEach(r => {
        const col = viz.practColor(r.practica);
        const used = state.confirmedMats.has(r.mat) ? ' (ya confirmado)' : '';
        const exc = r.excluded ? ' (excluido)' : '';
        html += `<div class="conflict-row" style="background:${col.bg};color:${col.fg}">
          <span style="font-family:var(--font-mono);font-size:10px">${r.mat}${used}${exc}</span>
          <span>P${r.practica}</span><span>${(r.peso/1000).toFixed(1)}t</span><span>${r.antig}d</span></div>`;
      });
      return html + `</div>`;
    }).join('');
  document.getElementById('modal-bg').classList.add('show');
}

function renderConfirmed() {
  const sec = document.getElementById('confirmed-sec');
  if (state.confirmed.length === 0) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  const totRollos = state.confirmed.reduce((s, c) => s + c.rolls.length, 0);
  const totW = state.confirmed.reduce((s, c) => s + c.f.w, 0);
  document.getElementById('cs-title').textContent =
    `Cargas confirmadas — ${state.confirmed.length} cargas · ${totRollos} rollos · ${(totW/1000).toFixed(1)} t`;
  document.getElementById('cs-list').innerHTML = state.confirmed.map((c, i) => {
    const pc = viz.practColor(c.practica);
    const mats = c.rolls.map(r => viz.fmtLocShort(r)).join(' · ');
    return `<div class="cf-row">
      <span class="rk">C${i+1}</span>
      <span class="pr" style="background:${pc.bg};color:${pc.fg}">P${c.practica}</span>
      <span class="mt" title="${mats}">${mats}</span>
      <span class="st">h ${(c.hEff*100).toFixed(0)}% · w ${(c.wEff*100).toFixed(0)}%</span>
      <span class="cg">⚙ ${c.cc.total}</span>
      <button class="det" onclick="window._app.showDetails(${c.id})">Detalles</button>
      <button onclick="window._app.undoConfirmed(${c.id})">Deshacer</button>
    </div>`;
  }).join('');
}

function renderPanel() {
  const sels = [...state.selected].map(m => state.byMat[m]);
  const p = document.getElementById('panel');
  if (sels.length === 0) {
    p.innerHTML = `<h3 class="p-t">Carga actual</h3>
      <div class="verdict v-idle">Sin selección</div>
      <div style="font-size:11px;color:var(--text-tertiary);line-height:1.5">Clic en rollos para armar manualmente, o usa "Sugerir cargas".</div>`;
    return;
  }
  const f = optimizer.loadFeasibility(sels, { enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1 });
  const bs = currentByStack();
  const cc = optimizer.craneCost(sels, bs);
  const ok = optimizer.isFeasible(f);
  let html = `<h3 class="p-t">Carga actual</h3>
    <div class="verdict ${ok?'v-ok':'v-bad'}">${ok?'✓ Factible':'✗ No factible'}</div>
    <div class="sr"><span class="l">Rollos</span><span class="v ${f.nOK?'ok':'bad'}">${f.n}/${optimizer.CONSTRAINTS.N_MAX}</span></div>
    <div class="sr"><span class="l">Misma práctica</span><span class="v ${f.samePract?'ok':'bad'}">${f.practs.join(',')}</span></div>
    <div class="sr"><span class="l">Misma ruta</span><span class="v ${f.sameLAV?'ok':'bad'}">${state.enforceLAV ? (sels.every(r=>r.lav)?'LAV':sels.every(r=>!r.lav)?'NO-LAV':'mezcla') : 'off'}</span></div>
    <div class="sr"><span class="l">Altura</span><span class="v ${f.hOK?'ok':'bad'}">${f.h}/${optimizer.CONSTRAINTS.H_MAX}</span></div>
    <div class="sr"><span class="l">Peso</span><span class="v ${f.wOK?'ok':'bad'}">${(f.w/1000).toFixed(1)}/180t</span></div>
    <div class="sr"><span class="l">Calibre P1</span><span class="v ${f.p1CalibreOK?'ok':'bad'}">${f.p1Calibre != null ? f.p1Calibre : 'n/d'}</span></div>
    <div class="sr" style="border-top:0.5px solid var(--border-tertiary);padding-top:6px;margin-top:4px"><span class="l">Estibas</span><span class="v neutral">${f.stacks.length}</span></div>
    <div class="sr"><span class="l">Bloqueos</span><span class="v neutral">${cc.blocking}</span></div>
    <div class="sr"><span class="l">Traslados</span><span class="v neutral">${cc.traversals}</span></div>
    <div class="sr"><span class="l">Costo grúa</span><span class="v" style="color:var(--text-warning)">${cc.total}</span></div>
    <div class="sel-list">`;
  sels.forEach(r => {
    const c = viz.practColor(r.practica);
    const cost = { s: 0, c: 1, a: 2 }[r.nivel];
    const bg = { s: '#C0DD97', c: '#FAC775', a: '#F7C1C1' }[r.nivel];
    const fg = { s: '#173404', c: '#412402', a: '#501313' }[r.nivel];
    html += `<div class="sel-row">
      <span class="mat" style="color:${c.fg};background:${c.bg};padding:1px 4px;border-radius:3px">${r.mat.slice(-8)}</span>
      <span style="font-size:9.5px;color:var(--text-secondary)">${viz.fmtLoc(r)}${r.auto?'*':''}</span>
      <span class="cb" style="background:${bg};color:${fg}">+${cost}</span></div>`;
  });
  html += `</div>
    <button class="success btn-full" onclick="window._app.confirmCurrent()" ${ok?'':'disabled'}>Cargar al horno</button>
    <button class="btn-full" onclick="window._app.clearSelection()">Limpiar selección</button>`;
  p.innerHTML = html;
}

function renderSuggestions() {
  const cands = suggest();
  const sg = document.getElementById('suggest');
  sg.style.display = 'block';
  const modeLabel = state.mode === 'ranked' ? 'Ranked (puede repetir rollos)' : `Sin repetir · ${STRAT_LBL[state.strategy]}`;
  document.getElementById('sg-title').textContent = `Top cargas — ${modeLabel}`;
  document.getElementById('sg-meta').textContent = `λ=${state.lambda.toFixed(2)} · ${cands.length} cargas`;
  const fmlas = {
    best: 'score = 0.45·h + 0.45·w + 0.10·(n/5) − λ·grúa/10',
    altura: 'h − λ·grúa/10', peso: 'w − λ·grúa/10',
    balanceada: '(h+w)/2 − λ·grúa/10',
    antiguedad: '0.25·(h+w) + 0.5·antig/30 − λ·grúa/10'
  };
  document.getElementById('fmla').textContent = (state.mode === 'ranked' ? '(Ranked usa balanceada) ' : '') + (fmlas[state.mode === 'ranked' ? 'balanceada' : state.strategy]);
  const list = document.getElementById('sg-list');
  if (cands.length === 0) { list.innerHTML = '<div class="sg-row empty">Sin candidatos factibles</div>'; return; }
  const seen = new Set();
  cands.forEach(c => { c._reused = c.rolls.filter(r => seen.has(r.mat)).length; c.rolls.forEach(r => seen.add(r.mat)); });
  list.innerHTML = cands.map((c, i) => {
    const pc = viz.practColor(c.practica);
    const mats = c.rolls.map(r => viz.fmtLocShort(r)).join(' · ');
    const reuse = (state.mode === 'ranked' && c._reused > 0) ? `<span class="reused">↻${c._reused}</span>` : '';
    const matsJson = JSON.stringify(c.rolls.map(r => r.mat));
    // Botones eliminar por rollo dentro de la sugerencia
    const deleteButtons = c.rolls.map(r =>
      `<button class="danger" style="font-size:9.5px;padding:2px 5px" title="Eliminar ${r.mat}" onclick='window._app.deleteRoll("${r.mat}")'>${r.mat.slice(-6)} ✕</button>`
    ).join('');
    return `<div class="sg-row" style="grid-template-columns:38px 50px 1fr 70px 60px 50px auto">
      <span class="rank">#${i+1}${reuse}</span>
      <span class="prac" style="background:${pc.bg};color:${pc.fg}">P${c.practica}</span>
      <span class="mats" title="${mats}">${mats}</span>
      <span class="stats">h ${(c.hEff*100).toFixed(0)}% · w ${(c.wEff*100).toFixed(0)}%</span>
      <span class="crane-pill">⚙ ${c.cc.total}</span>
      <span class="score">${c.score.toFixed(3)}</span>
      <div class="actions" style="flex-wrap:wrap;gap:3px">
        <button onclick='window._app.previewCombo(${matsJson})'>Ver</button>
        <button class="success" onclick='window._app.confirmFromSuggestion(${matsJson})'>Cargar</button>
        ${deleteButtons}
      </div></div>`;
  }).join('');
}

function showDetails(id) {
  const c = state.confirmed.find(x => x.id === id);
  if (!c) return;
  const pc = viz.practColor(c.practica);
  const ordered = [...c.rolls].sort((a, b) => b.ancho - a.ancho);
  const espesores = c.rolls.map(r => r.espesor);
  const antigs = c.rolls.map(r => r.antig);
  const anchos = c.rolls.map(r => r.ancho);
  const calibres = c.rolls.map(r => r.calibre).filter(Boolean);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const max = a => Math.max(...a);
  const min = a => Math.min(...a);
  const maxA = max(anchos);

  let stackHtml = '';
  ordered.forEach((r, i) => {
    const pn = ordered.length - i;
    const widthPct = (r.ancho / maxA) * 90 + 10;
    stackHtml += `<div class="stack-roll" style="width:${widthPct}%;background:${pc.bg};color:${pc.fg}">
      <span class="pn">P${pn}</span>${r.mat.slice(-9)}
      <span class="meta">${r.ancho}mm · ${(r.peso/1000).toFixed(1)}t · ${r.espesor}mm · ${viz.fmtLoc(r)}${r.auto?'*':''}</span></div>`;
  });

  const tableHtml = ordered.map((r, i) => {
    const pn = ordered.length - i;
    return `<tr class="${pn===1?'p1':''}">
      <td>P${pn}</td><td class="mono">${r.mat}</td>
      <td>${viz.fmtLoc(r)}${r.auto?'*':''}</td>
      <td>${r.ancho}</td><td>${(r.peso/1000).toFixed(2)}</td><td>${r.espesor}</td>
      <td>${r.od}</td><td>${r.largo}</td><td>${r.calibre||'-'}</td>
      <td>${r.antig}d</td><td>${r.cliente}</td></tr>`;
  }).join('');

  document.getElementById('modal-body').innerHTML = `
    <h3>Carga #${c.id} · <span style="background:${pc.bg};color:${pc.fg};padding:2px 8px;border-radius:4px;font-size:13px;font-weight:500">Práctica ${c.practica}</span>
      ${c.lav ? '<span style="font-size:11px;color:var(--text-secondary);margin-left:8px">LAV</span>' : ''}</h3>
    <div class="subt">Estrategia: ${STRAT_LBL[c.strategy] || c.strategy} · λ=${c.lambda.toFixed(2)} · score=${(c.phys - c.lambda*c.cc.total/10).toFixed(3)}${ordered.some(r=>r.auto) ? ' · * nivel auto-asignado' : ''}</div>
    <div class="det-h">KPIs</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="lbl">Altura</div><div class="val">${(c.hEff*100).toFixed(1)}%</div><div class="sub-val">${c.f.h} / ${optimizer.CONSTRAINTS.H_MAX} mm</div></div>
      <div class="kpi"><div class="lbl">Peso</div><div class="val">${(c.wEff*100).toFixed(1)}%</div><div class="sub-val">${(c.f.w/1000).toFixed(2)} / 180 t</div></div>
      <div class="kpi"><div class="lbl">Rollos</div><div class="val">${c.f.n}</div><div class="sub-val">${c.f.n}/${optimizer.CONSTRAINTS.N_MAX}</div></div>
      <div class="kpi"><div class="lbl">Costo grúa</div><div class="val">${c.cc.total}</div><div class="sub-val">${c.cc.blocking} bloqueos · ${c.cc.traversals} traslados</div></div>
      <div class="kpi"><div class="lbl">Antigüedad prom.</div><div class="val">${avg(antigs).toFixed(1)}d</div><div class="sub-val">min ${min(antigs)} · max ${max(antigs)}</div></div>
      <div class="kpi"><div class="lbl">Espesor prom.</div><div class="val">${avg(espesores).toFixed(3)}</div><div class="sub-val">min ${min(espesores)} · max ${max(espesores)}</div></div>
      <div class="kpi"><div class="lbl">Δ Ancho</div><div class="val">${max(anchos)-min(anchos)}</div><div class="sub-val">${min(anchos)}–${max(anchos)} mm</div></div>
      <div class="kpi"><div class="lbl">Calibre P1</div><div class="val">${c.f.p1Calibre || '–'}</div><div class="sub-val">${calibres.length>0 ? `${calibres.length} con calibre` : 'sin datos'}</div></div>
      <div class="kpi" style="grid-column:span 2"><div class="lbl">Estibas usadas</div><div class="val" style="font-size:14px">${c.f.stacks.map(s=>s.replace('_','')).join(' · ')}</div></div>
    </div>
    <div class="det-h">Apilado en horno (P1=base · Pn=tope)</div>
    <div class="stack-viz">${stackHtml}</div>
    <div class="det-h">Detalle de rollos</div>
    <table class="det-table">
      <thead><tr><th>Pos</th><th>Material</th><th>Origen</th><th>Ancho</th><th>Peso (t)</th><th>Esp.</th><th>OD</th><th>Largo</th><th>Cal.</th><th>Antig.</th><th>Cliente</th></tr></thead>
      <tbody>${tableHtml}</tbody>
    </table>`;
  document.getElementById('modal-bg').classList.add('show');
}

function closeModal() { document.getElementById('modal-bg').classList.remove('show'); }

function renderComparador() {
  const c = document.getElementById('comparador-content');
  if (state.rolls.length === 0) { c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">Carga un Excel primero.</div>'; return; }
  c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">Calculando comparación entre las 5 estrategias...</div>';
  setTimeout(() => {
    const pool = availableRolls();
    const opts = { enforceLAV: state.enforceLAV, enforceCalibreP1: state.enforceCalibreP1 };
    const cmp = optimizer.compareStrategies(pool, state.lambda, state.topN, opts);
    c.innerHTML = `
      <div style="margin-bottom:14px;font-size:12px;color:var(--text-secondary)">
        Cada estrategia corre en modo <strong>Sin repetir</strong> con λ=${state.lambda.toFixed(2)}, Top N=${state.topN}, con ${pool.length} rollos disponibles.
        El ganador combina utilización (40% rollos, 30% altura, 20% peso) y eficiencia de grúa (10%).
      </div>
      <div class="comp-grid">
        ${Object.entries(cmp.results).map(([k, r]) => `
          <div class="comp-card ${k === cmp.winner ? 'winner' : ''}">
            <h4>${STRAT_LBL[k]} ${k === cmp.winner ? '<span class="winner-badge">★ MEJOR</span>' : ''}</h4>
            <div class="metric"><span class="l">Cargas</span><span class="v">${r.n_cargas}</span></div>
            <div class="metric"><span class="l">Rollos usados</span><span class="v">${r.n_rollos} / ${pool.length}</span></div>
            <div class="metric"><span class="l">Peso total</span><span class="v">${(r.peso_total/1000).toFixed(1)} t</span></div>
            <div class="metric"><span class="l">Altura promedio</span><span class="v">${(r.avg_h_fill*100).toFixed(1)}%</span></div>
            <div class="metric"><span class="l">Peso promedio</span><span class="v">${(r.avg_w_fill*100).toFixed(1)}%</span></div>
            <div class="metric"><span class="l">Grúa total</span><span class="v">${r.crane_total}</span></div>
            <div class="metric"><span class="l">Antigüedad prom.</span><span class="v">${r.avg_antig.toFixed(1)} d</span></div>
            <button style="width:100%;margin-top:10px" onclick="window._app.applyStrategy('${k}')">Usar esta estrategia</button>
          </div>`).join('')}
      </div>`;
  }, 30);
}

function applyStrategy(s) {
  state.strategy = s;
  state.mode = 'disjoint';
  document.getElementById('strategy').value = s;
  document.getElementById('m-ranked').classList.remove('active');
  document.getElementById('m-disjoint').classList.add('active');
  document.getElementById('strat-grp').style.display = 'flex';
  saveState();
  // Switch to constructor tab
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'constructor'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.dataset.tab === 'constructor'));
  state.activeTab = 'constructor';
  renderSuggestions();
}

function renderEstadisticas() {
  viz.renderStatistics(document.getElementById('stats-content'), state.rolls);
}

// ===== Master render =====
function renderAll() {
  renderConflictBanner();
  renderConfirmed();
  const pool = availableRolls();
  const bs = currentByStack();
  document.getElementById('invsub').textContent =
    `${pool.length} rollos disponibles · ${state.confirmedMats.size} confirmados · ${state.rolls.filter(r=>r.excluded).length} excluidos`;
  viz.renderLegend(document.getElementById('legend'), pool, state.hiddenPract, p => {
    if (state.hiddenPract.has(p)) state.hiddenPract.delete(p); else state.hiddenPract.add(p);
    renderAll();
  });
  const opts = {
    selected: state.selected, hiddenPract: state.hiddenPract,
    onClick: toggleSelected, onHover: showTT, onLeave: hideTT
  };
  viz.renderLinea(document.getElementById('linea'), state.rolls, optimizer.buildByStack(state.rolls), opts);
  viz.renderCuadro(document.getElementById('cuadro'), state.rolls, optimizer.buildByStack(state.rolls), opts);
  renderPanel();
  if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();

  if (state.activeTab === 'comparador') renderComparador();
  if (state.activeTab === 'estadisticas') renderEstadisticas();
}

// ===== Export =====
function exportResults() {
  exportConfirmedToExcel(state.confirmed, {
    sourceFile: state.fileName,
    format: state.format,
    strategy: state.strategy,
    mode: state.mode,
    lambda: state.lambda,
    enforceLAV: state.enforceLAV,
    enforceCalibreP1: state.enforceCalibreP1,
    remaining: availableRolls()
  });
}

// ===== Event wiring =====
function init() {
  restorePreferences(loadState());

  // Sync UI to state
  document.getElementById('lambda').value = state.lambda;
  document.getElementById('lambda-out').textContent = state.lambda.toFixed(2);
  document.getElementById('topn').value = state.topN;
  document.getElementById('topn-out').textContent = state.topN;
  document.getElementById('strategy').value = state.strategy;
  document.getElementById('opt-lav').checked = state.enforceLAV;
  document.getElementById('opt-cal').checked = state.enforceCalibreP1;
  if (state.mode === 'disjoint') {
    document.getElementById('m-disjoint').classList.add('active');
    document.getElementById('m-ranked').classList.remove('active');
    document.getElementById('strat-grp').style.display = 'flex';
  }

  // Upload
  const dz = document.getElementById('upload-zone');
  const fi = document.getElementById('file-input');
  dz.onclick = () => fi.click();
  fi.onchange = (e) => handleFile(e.target.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); };

  // Controls
  document.getElementById('lambda').oninput = (e) => {
    state.lambda = +e.target.value;
    document.getElementById('lambda-out').textContent = state.lambda.toFixed(2);
    saveState();
    if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();
  };
  document.getElementById('topn').oninput = (e) => {
    state.topN = +e.target.value;
    document.getElementById('topn-out').textContent = state.topN;
    saveState();
    if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();
  };
  document.getElementById('strategy').onchange = (e) => {
    state.strategy = e.target.value; saveState();
    if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();
  };
  document.getElementById('m-ranked').onclick = () => {
    state.mode = 'ranked';
    document.getElementById('m-ranked').classList.add('active');
    document.getElementById('m-disjoint').classList.remove('active');
    document.getElementById('strat-grp').style.display = 'none';
    saveState();
    if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();
  };
  document.getElementById('m-disjoint').onclick = () => {
    state.mode = 'disjoint';
    document.getElementById('m-disjoint').classList.add('active');
    document.getElementById('m-ranked').classList.remove('active');
    document.getElementById('strat-grp').style.display = 'flex';
    saveState();
    if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();
  };
  document.getElementById('opt-lav').onchange = (e) => { state.enforceLAV = e.target.checked; saveState(); renderAll(); };
  document.getElementById('opt-cal').onchange = (e) => { state.enforceCalibreP1 = e.target.checked; saveState(); renderAll(); };
  document.getElementById('btn-sugg').onclick = renderSuggestions;
  document.getElementById('btn-export').onclick = exportResults;

  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelector(`.tab-content[data-tab="${t.dataset.tab}"]`).classList.add('active');
      state.activeTab = t.dataset.tab;
      if (state.activeTab === 'comparador') renderComparador();
      if (state.activeTab === 'estadisticas') renderEstadisticas();
    };
  });

  // Modal
  document.getElementById('modal-bg').onclick = (e) => { if (e.target.id === 'modal-bg') closeModal(); };
  document.querySelector('.modal-close').onclick = closeModal;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // Right-click on slot → toggle excluded
  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-mat]');
    if (!el) return;
    e.preventDefault();
    toggleExcluded(el.dataset.mat);
  });

  document.getElementById('btn-undo-all').onclick = undoAll;

  // ===== Panel de restricciones =====
  const constraintsPanel = document.getElementById('constraints-panel');
  document.getElementById('btn-constraints').onclick = () => {
    const visible = constraintsPanel.style.display !== 'none';
    constraintsPanel.style.display = visible ? 'none' : 'block';
  };
  document.getElementById('btn-constraints-close').onclick = () => {
    constraintsPanel.style.display = 'none';
  };
  document.getElementById('btn-constraints-apply').onclick = () => {
    const getVal = id => parseFloat(document.getElementById(id).value);
    optimizer.updateConstraints({
      H_MAX:      getVal('c-hmax'),
      W_MAX:      getVal('c-wmax'),
      N_MAX:      Math.round(getVal('c-nmax')),
      N_MIN:      Math.round(getVal('c-nmin')),
      SPACER:     getVal('c-spacer'),
      CAL_P1_MAX: getVal('c-calp1'),
      MAX_ANTIG:  getVal('c-maxantig')
    });
    saveState();
    renderAll();
    if (document.getElementById('suggest').style.display !== 'none') renderSuggestions();
    // Feedback visual
    const btn = document.getElementById('btn-constraints-apply');
    btn.textContent = '✓ Aplicadas';
    btn.style.background = 'var(--accent-green)';
    setTimeout(() => { btn.textContent = 'Aplicar restricciones'; btn.style.background = ''; }, 1500);
  };
  document.getElementById('btn-constraints-reset').onclick = () => {
    optimizer.updateConstraints({ ...CONSTRAINTS_DEFAULT });
    syncConstraintInputs();
    saveState();
    renderAll();
  };
}

const id = s => document.getElementById(s);

window._app = {
  confirmCurrent, confirmFromSuggestion, undoConfirmed, undoAll, deleteRoll,
  clearSelection: () => { state.selected.clear(); renderAll(); },
  previewCombo: (mats) => { state.selected.clear(); mats.forEach(m => state.selected.add(m)); renderAll(); document.getElementById('cuadro').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  showDetails, closeModal, applyStrategy, showConflictsModal,
  state
};

init();
