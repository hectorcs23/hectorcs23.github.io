// ===== Core optimizer =====

// Restricciones modificables en tiempo de ejecución
const CONSTRAINTS = {
  H_MAX: 5200,        // mm
  W_MAX: 180000,      // kg
  N_MAX: 5,           // rollos por carga
  N_MIN: 2,
  SPACER: 80,         // mm between rolls (vertical stacking)
  CAL_P1_MAX: 25,     // calibre máximo en P1 (base)
  MAX_ANTIG: 30       // días para normalizar score antigüedad
};

// Permite actualizar restricciones desde la UI
function updateConstraints(newVals) {
  Object.assign(CONSTRAINTS, newVals);
}

const ABOVE = { s: [], c: ['s'], a: ['c', 's'] };

function buildByStack(pool) {
  const bs = {};
  // Detectar conflictos primero (varios rollos misma posición+nivel)
  const posCounts = {};
  pool.forEach(r => {
    const k = `${r.fila}${r.col}|${r.nivel}`;
    posCounts[k] = (posCounts[k] || 0) + 1;
  });
  pool.forEach(r => {
    const posKey = `${r.fila}${r.col}|${r.nivel}`;
    // Si hay conflicto en esta posición, usar ID único de rollo como clave de estiba
    // para que cada rollo en conflicto pueda ser combinado libremente
    const k = posCounts[posKey] > 1 ? `${r.fila}${r.col}_${r.mat}` : `${r.fila}${r.col}`;
    if (!bs[k]) bs[k] = {};
    if (!bs[k][r.nivel]) bs[k][r.nivel] = [];
    bs[k][r.nivel].push(r);
  });
  return bs;
}

// buildByStack original sin desambiguación, usado solo para detectar conflictos
function buildByStackRaw(pool) {
  const bs = {};
  pool.forEach(r => {
    const k = `${r.fila}${r.col}`;
    if (!bs[k]) bs[k] = {};
    if (!bs[k][r.nivel]) bs[k][r.nivel] = [];
    bs[k][r.nivel].push(r);
  });
  return bs;
}

function detectConflicts(rolls) {
  const bs = buildByStackRaw(rolls);
  const conflicts = [];
  Object.entries(bs).forEach(([stk, levels]) => {
    Object.entries(levels).forEach(([nv, group]) => {
      if (group.length > 1) conflicts.push({ stack: stk, nivel: nv, rolls: group });
    });
  });
  return conflicts;
}

function craneCost(rolls, bs) {
  const matSet = new Set(rolls.map(r => r.mat));
  let blocking = 0;
  rolls.forEach(r => {
    const stack = bs[`${r.fila}${r.col}`];
    (ABOVE[r.nivel] || []).forEach(up => {
      const upRolls = (stack && stack[up]) || [];
      if (upRolls.length > 0 && !upRolls.some(ur => matSet.has(ur.mat))) blocking++;
    });
  });
  const stacks = new Set(rolls.map(r => `${r.fila}${r.col}`));
  return { blocking, traversals: stacks.size - 1, total: blocking + (stacks.size - 1) };
}

function loadFeasibility(rolls, opts = {}) {
  const { enforceLAV = true, enforceCalibreP1 = true } = opts;
  const stacks = new Set(rolls.map(r => `${r.fila}${r.col}`));
  const practs = new Set(rolls.map(r => r.practica));
  const lavSet = new Set(rolls.map(r => r.lav));
  const n = rolls.length;
  const w = rolls.reduce((s, r) => s + r.peso, 0);
  const h = rolls.reduce((s, r) => s + r.ancho, 0) + Math.max(0, n - 1) * CONSTRAINTS.SPACER;

  // P1 = base = widest roll
  const ordered = [...rolls].sort((a, b) => b.ancho - a.ancho);
  const p1 = ordered[0];
  const p1Calibre = p1 ? p1.calibre : null;
  const p1CalibreOK = !enforceCalibreP1 || p1Calibre == null || p1Calibre <= CONSTRAINTS.CAL_P1_MAX;

  return {
    samePract: practs.size === 1,
    sameLAV: !enforceLAV || lavSet.size === 1,
    nOK: n <= CONSTRAINTS.N_MAX && n >= CONSTRAINTS.N_MIN,
    wOK: w <= CONSTRAINTS.W_MAX,
    hOK: h <= CONSTRAINTS.H_MAX,
    p1CalibreOK,
    n, w, h, p1Calibre,
    stacks: [...stacks],
    practs: [...practs]
  };
}

function isFeasible(f) {
  return f.samePract && f.sameLAV && f.nOK && f.wOK && f.hOK && f.p1CalibreOK;
}

function strategyScore(combo, strat) {
  const n = combo.length;
  const w = combo.reduce((s, r) => s + r.peso, 0);
  const h = combo.reduce((s, r) => s + r.ancho, 0) + Math.max(0, n - 1) * CONSTRAINTS.SPACER;
  const avgAntig = combo.reduce((s, r) => s + r.antig, 0) / n;
  const hEff = h / CONSTRAINTS.H_MAX;
  const wEff = w / CONSTRAINTS.W_MAX;
  let s;
  switch (strat) {
    case 'altura':     s = hEff; break;
    case 'peso':       s = wEff; break;
    case 'balanceada': s = (hEff + wEff) / 2; break;
    case 'antiguedad': s = 0.5 * (hEff + wEff) / 2 + 0.5 * Math.min(1, avgAntig / CONSTRAINTS.MAX_ANTIG); break;
    case 'best':
    default:           s = 0.45 * hEff + 0.45 * wEff + 0.10 * (n / CONSTRAINTS.N_MAX); break;
  }
  return { score: s, hEff, wEff };
}

function* combinations(arr, k) {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function enumerateCandidates(pool, lambda, strat, opts = {}) {
  const bs = buildByStack(pool);
  // Pre-group by (practica, lav) since both must match
  const groups = {};
  pool.forEach(r => {
    const k = `${r.practica}|${r.lav ? 1 : 0}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const cands = [];
  Object.values(groups).forEach(rolls => {
    const maxK = Math.min(CONSTRAINTS.N_MAX, rolls.length);
    for (let k = CONSTRAINTS.N_MIN; k <= maxK; k++) {
      for (const combo of combinations(rolls, k)) {
        const f = loadFeasibility(combo, opts);
        if (!isFeasible(f)) continue;
        const cc = craneCost(combo, bs);
        const { score: phys, hEff, wEff } = strategyScore(combo, strat);
        const score = phys - lambda * cc.total / 10;
        cands.push({ rolls: combo, practica: combo[0].practica, lav: combo[0].lav, f, cc, phys, score, hEff, wEff });
      }
    }
  });
  cands.sort((a, b) => b.score - a.score);
  return cands;
}

function suggestRanked(pool, lambda, topN, strat, opts) {
  return enumerateCandidates(pool, lambda, strat, opts).slice(0, topN);
}

function suggestDisjoint(pool, lambda, topN, strat, opts) {
  let workingPool = [...pool];
  const picks = [];
  while (picks.length < topN) {
    const cands = enumerateCandidates(workingPool, lambda, strat, opts);
    if (cands.length === 0) break;
    const best = cands[0];
    picks.push(best);
    const used = new Set(best.rolls.map(r => r.mat));
    workingPool = workingPool.filter(r => !used.has(r.mat));
  }
  return picks;
}

function compareStrategies(pool, lambda, topN, opts) {
  const results = {};
  const strats = ['best', 'altura', 'peso', 'balanceada', 'antiguedad'];
  strats.forEach(s => {
    const picks = suggestDisjoint(pool, lambda, topN, s, opts);
    const totalRollos = picks.reduce((sum, p) => sum + p.rolls.length, 0);
    const totalPeso = picks.reduce((sum, p) => sum + p.f.w, 0);
    const totalCrane = picks.reduce((sum, p) => sum + p.cc.total, 0);
    const avgHFill = picks.length > 0 ? picks.reduce((sum, p) => sum + p.hEff, 0) / picks.length : 0;
    const avgWFill = picks.length > 0 ? picks.reduce((sum, p) => sum + p.wEff, 0) / picks.length : 0;
    const avgAntig = totalRollos > 0
      ? picks.reduce((s, p) => s + p.rolls.reduce((s2, r) => s2 + r.antig, 0), 0) / totalRollos
      : 0;
    results[s] = {
      strategy: s,
      n_cargas: picks.length,
      n_rollos: totalRollos,
      peso_total: totalPeso,
      crane_total: totalCrane,
      avg_h_fill: avgHFill,
      avg_w_fill: avgWFill,
      avg_antig: avgAntig,
      picks
    };
  });
  // Determine winner by composite (more rollos used + higher fills, less crane)
  const scores = {};
  Object.entries(results).forEach(([k, r]) => {
    scores[k] = 0.4 * (r.n_rollos / pool.length)
              + 0.3 * r.avg_h_fill
              + 0.2 * r.avg_w_fill
              - 0.1 * (r.crane_total / Math.max(1, r.n_cargas) / 10);
  });
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return { results, winner, scores };
}

window.optimizer = {
  CONSTRAINTS, updateConstraints, buildByStack, buildByStackRaw, detectConflicts, craneCost,
  loadFeasibility, isFeasible, strategyScore, suggestRanked, suggestDisjoint,
  compareStrategies, enumerateCandidates
};
