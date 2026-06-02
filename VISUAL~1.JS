// ===== Rendering / visualization =====

const PRACT_COLORS = {
  30:  { bg: '#FAECE7', fg: '#4A1B0C' },
  31:  { bg: '#E6F1FB', fg: '#042C53' },
  32:  { bg: '#E2F0F8', fg: '#03345E' },
  33:  { bg: '#E1F5EE', fg: '#04342C' },
  34:  { bg: '#9FE1CB', fg: '#04342C' },
  35:  { bg: '#EAF3DE', fg: '#173404' },
  36:  { bg: '#C0DD97', fg: '#173404' },
  37:  { bg: '#DCE9C8', fg: '#1B3D08' },
  38:  { bg: '#FAEEDA', fg: '#412402' },
  39:  { bg: '#EEEDFE', fg: '#26215C' },
  40:  { bg: '#FCEBEB', fg: '#501313' },
  41:  { bg: '#FBE7E0', fg: '#4F1C0A' },
  42:  { bg: '#F5E4F1', fg: '#3F1635' },
  43:  { bg: '#E4E3FB', fg: '#26215C' },
  44:  { bg: '#FFE9CD', fg: '#5C2F00' },
  45:  { bg: '#FBEAF0', fg: '#4B1528' },
  46:  { bg: '#F1EFE8', fg: '#2C2C2A' },
  47:  { bg: '#D3D1C7', fg: '#2C2C2A' },
  48:  { bg: '#E8DACC', fg: '#3A2208' },
  141: { bg: '#F4C0D1', fg: '#4B1528' }
};

function practColor(p) {
  return PRACT_COLORS[p] || { bg: '#F1EFE8', fg: '#2C2C2A' };
}

const NIV_LBL = { s: 'S', c: 'C', a: 'A' };
const NIVS = ['s', 'c', 'a'];
const COLS_CUADRO = ['A', 'B', 'C', 'D', 'E', 'F'];
const ROWS_CUADRO = [46, 47, 48, 49, 50, 51, 52, 53, 54];
const ROWS_LINEA = [...Array(40).keys()].map(i => i + 1).concat(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

function fmtLoc(r) {
  return r.col === '_' ? `${r.fila}·${NIV_LBL[r.nivel]}` : `${r.fila}${r.col}·${NIV_LBL[r.nivel]}`;
}

function fmtLocShort(r) {
  return r.col === '_' ? `${r.fila}${NIV_LBL[r.nivel]}` : `${r.fila}${r.col}${NIV_LBL[r.nivel]}`;
}

// ===== Cuadro 46-54 =====
function renderCuadro(container, rolls, byStack, opts) {
  const { selected, hiddenPract, onClick, onHover, onLeave } = opts;
  const hasCuadro = rolls.some(r => typeof r.fila === 'number' && r.fila >= 46 && r.fila <= 54);
  if (!hasCuadro) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary)">Sin rollos en el cuadro 46–54</div>';
    return;
  }
  let html = '<div class="grid"><div class="hdr"></div>';
  COLS_CUADRO.forEach(c => html += `<div class="hdr">${c}</div>`);
  ROWS_CUADRO.forEach(fila => {
    html += `<div class="row-h">${fila}</div>`;
    COLS_CUADRO.forEach(col => {
      const stack = byStack[`${fila}${col}`] || {};
      html += '<div class="cell">';
      NIVS.forEach(nv => {
        const rs = stack[nv] || [];
        if (rs.length === 0) { html += '<div class="slot empty"></div>'; return; }
        if (rs.length === 1) {
          const r = rs[0];
          const c = practColor(r.practica);
          const cls = ['slot', 'occ',
            selected.has(r.mat) ? 'sel' : '',
            hiddenPract.has(r.practica) ? 'dim' : '',
            r.excluded ? 'excluded' : ''].filter(Boolean).join(' ');
          html += `<div class="${cls}" style="background:${c.bg};color:${c.fg}" data-mat="${escapeAttr(r.mat)}"><span class="lvl-tag">${NIV_LBL[nv]}</span>${r.practica}</div>`;
        } else {
          html += '<div class="slot conflict">';
          rs.forEach(r => {
            const c = practColor(r.practica);
            const cls = ['half',
              selected.has(r.mat) ? 'sel' : '',
              hiddenPract.has(r.practica) ? 'dim' : '',
              r.excluded ? 'excluded' : ''].filter(Boolean).join(' ');
            html += `<div class="${cls}" style="background:${c.bg};color:${c.fg}" data-mat="${escapeAttr(r.mat)}"><span class="lvl-tag">${NIV_LBL[nv]}</span>${r.practica}</div>`;
          });
          html += '</div>';
        }
      });
      html += '</div>';
    });
  });
  html += '</div>';
  container.innerHTML = html;
  attachClickAndHover(container, onClick, onHover, onLeave);
}

// ===== Línea 1-40 + A-G =====
function renderLinea(container, rolls, byStack, opts) {
  const { selected, hiddenPract, onClick, onHover, onLeave } = opts;
  let html = '<div class="strip-scroll"><div>';
  ROWS_LINEA.forEach(fila => {
    if (fila === 'A') html += '<div class="strip-sep"><span>letras</span></div>';
    const stack = byStack[`${fila}_`] || {};
    const hasAuto = NIVS.some(nv => (stack[nv] || []).some(r => r.auto));
    html += `<div class="strip-cell"><div class="strip-num">${fila}</div><div class="strip-stack ${hasAuto ? 'auto' : ''}">`;
    NIVS.forEach(nv => {
      const rs = stack[nv] || [];
      if (rs.length === 0) { html += '<div class="strip-slot"></div>'; return; }
      const r = rs[0]; // for conflict, show first; conflict styling not visualized in narrow strip
      const c = practColor(r.practica);
      const cls = ['strip-slot', 'occ',
        selected.has(r.mat) ? 'sel' : '',
        hiddenPract.has(r.practica) ? 'dim' : '',
        r.excluded ? 'excluded' : ''].filter(Boolean).join(' ');
      const label = rs.length > 1 ? `${r.practica}*` : r.practica;
      html += `<div class="${cls}" style="background:${c.bg};color:${c.fg}" data-mat="${escapeAttr(r.mat)}">${label}</div>`;
    });
    html += '</div></div>';
  });
  html += '</div></div>';
  container.innerHTML = html;
  attachClickAndHover(container, onClick, onHover, onLeave);
}

function attachClickAndHover(container, onClick, onHover, onLeave) {
  container.querySelectorAll('[data-mat]').forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); onClick(el.dataset.mat); };
    el.onmouseenter = (e) => onHover(e, el.dataset.mat);
    el.onmousemove = (e) => onHover(e, el.dataset.mat, true);
    el.onmouseleave = onLeave;
  });
}

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// ===== Legend =====
function renderLegend(container, rolls, hiddenPract, onClick) {
  const counts = {};
  rolls.forEach(r => { counts[r.practica] = (counts[r.practica] || 0) + 1; });
  const practs = Object.keys(counts).map(Number).sort((a, b) => a - b);
  if (practs.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = practs.map(p => {
    const c = practColor(p);
    const off = hiddenPract.has(p) ? 'off' : '';
    return `<div class="lg-item ${off}" data-p="${p}"><span class="lg-sw" style="background:${c.bg};border:0.5px solid ${c.fg}33"></span>P${p} · ${counts[p]}</div>`;
  }).join('');
  container.querySelectorAll('.lg-item').forEach(el => {
    el.onclick = () => onClick(+el.dataset.p);
  });
}

// ===== Statistics =====
function renderStatistics(container, rolls) {
  const total = rolls.length;
  if (total === 0) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">Sin datos</div>'; return; }

  const totalPeso = rolls.reduce((s, r) => s + r.peso, 0);
  const avgAntig = rolls.reduce((s, r) => s + r.antig, 0) / total;
  const maxAntig = Math.max(...rolls.map(r => r.antig));
  const cuadroCount = rolls.filter(r => typeof r.fila === 'number' && r.fila >= 46 && r.fila <= 54).length;
  const lineaCount = rolls.filter(r => r.col === '_').length;
  const lavCount = rolls.filter(r => r.lav).length;
  const conflicts = optimizer.detectConflicts(rolls);

  // Práctica distribution
  const byPract = {};
  rolls.forEach(r => { byPract[r.practica] = (byPract[r.practica] || 0) + 1; });
  const practSorted = Object.entries(byPract).sort((a, b) => b[1] - a[1]);
  const maxPract = Math.max(...Object.values(byPract));

  // Width buckets
  const widthBuckets = { '< 800': 0, '800–1000': 0, '1000–1200': 0, '1200–1400': 0, '> 1400': 0 };
  rolls.forEach(r => {
    if (r.ancho < 800) widthBuckets['< 800']++;
    else if (r.ancho < 1000) widthBuckets['800–1000']++;
    else if (r.ancho < 1200) widthBuckets['1000–1200']++;
    else if (r.ancho < 1400) widthBuckets['1200–1400']++;
    else widthBuckets['> 1400']++;
  });
  const maxWB = Math.max(...Object.values(widthBuckets));

  // Antiquity buckets
  const antigBuckets = { '0–7d': 0, '7–14d': 0, '14–30d': 0, '30–60d': 0, '> 60d': 0 };
  rolls.forEach(r => {
    if (r.antig < 7) antigBuckets['0–7d']++;
    else if (r.antig < 14) antigBuckets['7–14d']++;
    else if (r.antig < 30) antigBuckets['14–30d']++;
    else if (r.antig < 60) antigBuckets['30–60d']++;
    else antigBuckets['> 60d']++;
  });
  const maxAB = Math.max(...Object.values(antigBuckets));

  const renderBars = (data, max, colorFn) => Object.entries(data).map(([label, count]) => {
    const pct = max > 0 ? (count / max) * 100 : 0;
    const c = colorFn ? colorFn(label) : { bg: '#E6F1FB', fg: '#042C53' };
    return `<div class="bar-row"><div class="label">${label}</div><div class="bar"><div class="bar-fill" style="background:${c.bg};width:${pct}%"></div></div><div class="count">${count}</div></div>`;
  }).join('');

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <h4>Resumen</h4>
        <div class="big-num">${total}</div>
        <div class="sub">rollos en inventario</div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11.5px">
          <div><div style="color:var(--text-secondary)">Peso total</div><div style="font-weight:500">${(totalPeso/1000).toFixed(1)} t</div></div>
          <div><div style="color:var(--text-secondary)">Cuadro 46–54</div><div style="font-weight:500">${cuadroCount}</div></div>
          <div><div style="color:var(--text-secondary)">Línea 1–40+A–G</div><div style="font-weight:500">${lineaCount}</div></div>
          <div><div style="color:var(--text-secondary)">Antigüedad prom.</div><div style="font-weight:500">${avgAntig.toFixed(1)} d</div></div>
          <div><div style="color:var(--text-secondary)">LAV</div><div style="font-weight:500">${lavCount} (${(lavCount/total*100).toFixed(0)}%)</div></div>
          <div><div style="color:var(--text-secondary)">Conflictos</div><div style="font-weight:500">${conflicts.length}</div></div>
        </div>
      </div>

      <div class="stat-card">
        <h4>Distribución por práctica</h4>
        ${practSorted.map(([p, count]) => {
          const pct = (count / maxPract) * 100;
          const c = practColor(+p);
          return `<div class="bar-row"><div class="label">P${p}</div><div class="bar"><div class="bar-fill" style="background:${c.bg};width:${pct}%"></div></div><div class="count">${count}</div></div>`;
        }).join('')}
      </div>

      <div class="stat-card">
        <h4>Distribución de ancho (mm)</h4>
        ${renderBars(widthBuckets, maxWB)}
      </div>

      <div class="stat-card">
        <h4>Antigüedad (días)</h4>
        ${renderBars(antigBuckets, maxAB, (label) => {
          if (label === '> 60d') return { bg: '#FAECE7' };
          if (label === '30–60d') return { bg: '#FAEEDA' };
          return { bg: '#E1F5EE' };
        })}
        <div class="sub" style="margin-top:8px">Máx: ${maxAntig} días</div>
      </div>
    </div>
  `;
}

window.viz = {
  PRACT_COLORS, practColor, NIV_LBL, NIVS, COLS_CUADRO, ROWS_CUADRO, ROWS_LINEA,
  fmtLoc, fmtLocShort, renderCuadro, renderLinea, renderLegend, renderStatistics
};
