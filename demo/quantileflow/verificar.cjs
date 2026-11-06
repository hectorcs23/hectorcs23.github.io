/* Cross-checks this demo's JavaScript engine against the Python engine of
 * hectorcs23/QuantileFlow. No network and no private data: only the two
 * reference files that sit next to this script.
 *
 *   node verificar.cjs
 *
 * Exits with code 1 if any deviation goes over its tolerance.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const M = require("./motor.js");

const aqui = __dirname;
const leer = (n) => JSON.parse(fs.readFileSync(path.join(aqui, n), "utf8"));

let fallos = 0;
const linea = (ok, txt) => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${txt}`);
};

// --- 1. Price: 90 cases from the PDE vs closed-form benchmark -------------
console.log("\n1) Price against experiments/valoracion_consistente_20261010 (90 cases)");
const ref = leer("casos_referencia.json");
const { spot, tasa, q } = ref.parametros;
let maxVsBs = 0, maxVsPde = 0, maxRelPde = 0;
for (const c of ref.casos) {
  const mio = M.precioBS(spot, c.strike, c.dias / 365, tasa, q, c.sigma, c.tipo === "C");
  maxVsBs = Math.max(maxVsBs, Math.abs(mio - c.precio_bs));
  const dPde = Math.abs(mio - c.precio_pde);
  maxVsPde = Math.max(maxVsPde, dPde);
  if (c.precio_pde > 1e-3) maxRelPde = Math.max(maxRelPde, dPde / c.precio_pde);
}
console.log(`     cases: ${ref.casos.length}`);
linea(maxVsBs < 1e-10, `vs Python's closed form: largest deviation ${maxVsBs.toExponential(3)} (tolerance 1e-10)`);
linea(maxVsPde < 1e-3, `vs Python's PDE solver: largest deviation ${maxVsPde.toExponential(3)} (tolerance 1e-3)`);
console.log(`     largest relative deviation against the PDE: ${maxRelPde.toExponential(3)}`);

// --- 2. Cumulative normal at known points ---------------------------------
console.log("\n2) Cumulative normal (Hart) at known values");
const conocidos = [
  [0, 0.5], [1, 0.841344746068543], [-1, 0.158655253931457],
  [1.959963984540054, 0.975], [-2.5758293035489, 0.005], [6, 0.999999999013412],
];
let maxN = 0;
for (const [x, esperado] of conocidos) maxN = Math.max(maxN, Math.abs(M.ncdf(x) - esperado));
linea(maxN < 1e-12, `largest deviation ${maxN.toExponential(3)} (tolerance 1e-12)`);

// --- 3. Put-call parity ---------------------------------------------------
console.log("\n3) Put-call parity: C - P = S e^{-qT} - K e^{-rT}");
let maxPar = 0;
for (const dte of [7, 30, 90, 180]) {
  for (const k of [80, 95, 100, 110, 130]) {
    for (const s of [0.1, 0.25, 0.6]) {
      const T = dte / 365;
      const c = M.precioBS(100, k, T, 0.04, 0.013, s, true);
      const p = M.precioBS(100, k, T, 0.04, 0.013, s, false);
      const teorico = 100 * Math.exp(-0.013 * T) - k * Math.exp(-0.04 * T);
      maxPar = Math.max(maxPar, Math.abs(c - p - teorico));
    }
  }
}
linea(maxPar < 1e-10, `largest deviation ${maxPar.toExponential(3)} across 60 combinations (tolerance 1e-10)`);

// --- 4. Analytic greeks against finite differences of the price -----------
console.log("\n4) Analytic greeks against finite differences");
let mD = 0, mG = 0, mV = 0, mT = 0;
for (const dte of [14, 30, 90]) {
  for (const k of [90, 100, 110]) {
    for (const esCall of [true, false]) {
      const T = dte / 365, sg = 0.25, h = 1e-4;
      const g = M.griegasBS(100, k, T, 0.04, 0.013, sg, esCall);
      const P = (s, sig, t) => M.precioBS(s, k, t, 0.04, 0.013, sig, esCall);
      mD = Math.max(mD, Math.abs(g.delta - (P(100 + h, sg, T) - P(100 - h, sg, T)) / (2 * h)));
      mG = Math.max(mG, Math.abs(g.gamma - (P(100 + h, sg, T) - 2 * P(100, sg, T) + P(100 - h, sg, T)) / (h * h)));
      mV = Math.max(mV, Math.abs(g.vegaPorPuntoIv - (P(100, sg + h, T) - P(100, sg - h, T)) / (2 * h) / 100));
      mT = Math.max(mT, Math.abs(g.thetaPorDia - (-(P(100, sg, T + h) - P(100, sg, T - h)) / (2 * h)) / 365));
    }
  }
}
linea(mD < 1e-6, `delta: largest deviation ${mD.toExponential(3)}`);
linea(mG < 1e-4, `gamma: largest deviation ${mG.toExponential(3)}`);
linea(mV < 1e-7, `vega per IV point: largest deviation ${mV.toExponential(3)}`);
linea(mT < 1e-7, `theta per day: largest deviation ${mT.toExponential(3)}`);

// --- 5. Full engine against the exact route of the Python engine ----------
// Checked against comparar_contratos(motor="clasico"), which for European
// options with flat IV uses the SAME closed form as this port. It has to match
// almost exactly: any visible deviation would be a translation error.
console.log("\n5) Full engine against comparar_contratos(motor='clasico')");
const mr = leer("caso_motor_referencia.json");
const e = mr.entrada;
const obtenido = M.compararPosiciones({
  contratos: e.contratos, spot: e.spot, escenarios: e.escenarios,
  presupuesto: e.presupuesto, escenarioObjetivo: e.escenarioObjetivo,
  comision: e.comision, semispreadSalida: e.semispreadSalida, tasa: e.tasa, q: e.q,
});
const esp = mr.esperado;

linea(obtenido.posiciones.length === esp.posiciones.length,
      `eligible positions: ${obtenido.posiciones.length} (expected ${esp.posiciones.length})`);
linea(obtenido.excluidos.length === esp.excluidos.length,
      `excluded: ${obtenido.excluidos.length} (expected ${esp.excluidos.length})`);
linea(JSON.stringify(obtenido.excluidos.slice().sort((a, b) => a.contrato.localeCompare(b.contrato)))
      === JSON.stringify(esp.excluidos),
      "excluded contracts and their reasons are identical");

const porId = {};
obtenido.posiciones.forEach((p) => { porId[p.contrato] = p; });
let maxCant = 0, maxCap = 0, maxPnl = 0, maxSens = 0, maxVal = 0;
const faltan = [];
for (const r of esp.posiciones) {
  const p = porId[r.contrato];
  if (!p) { faltan.push(r.contrato); continue; }
  maxCant = Math.max(maxCant, Math.abs(p.cantidad - r.cantidad));
  for (const [a, b] of [[p.desembolsoEntrada, r.desembolsoEntrada],
                        [p.reservaComisionCierre, r.reservaComisionCierre],
                        [p.capitalReservado, r.capitalReservado],
                        [p.efectivoLibre, r.efectivoLibre]]) {
    maxCap = Math.max(maxCap, Math.abs(a - b));
  }
  for (const nombre of Object.keys(r.escenarios)) {
    maxPnl = Math.max(maxPnl, Math.abs(p.escenarios[nombre].pnlPosicion - r.escenarios[nombre].pnlPosicion));
    maxVal = Math.max(maxVal, Math.abs(p.escenarios[nombre].valorTeorico - r.escenarios[nombre].valorTeorico));
  }
  for (const g of ["delta", "gamma", "vegaPorPuntoIv", "thetaPorDia"]) {
    maxSens = Math.max(maxSens, Math.abs(p.sensibilidadPosicion[g] - r.sensibilidadPosicion[g]));
  }
}
linea(faltan.length === 0, `every expected position is present${faltan.length ? ": missing " + faltan.join(", ") : ""}`);
linea(maxCant === 0, `whole quantities identical (deviation ${maxCant})`);
linea(maxCap < 1e-9, `outlay, reserve, capital and free cash: largest deviation ${maxCap.toExponential(3)} USD`);
linea(maxVal < 1e-10, `repriced theoretical value: largest deviation ${maxVal.toExponential(3)}`);
linea(maxPnl < 1e-8, `PnL per scenario: largest deviation ${maxPnl.toExponential(3)} USD`);
linea(maxSens < 1e-6, `position sensitivities: largest deviation ${maxSens.toExponential(3)}`);

// --- 6. How far the closed form and the PDE solver drift apart ------------
// Informational, not a pass condition for the port: for European options with
// flat IV the closed form is the exact one and the PDE is the approximation.
// Its discretisation error is reported, and we check it changes no decision.
console.log("\n6) Difference between the closed form and the Python PDE solver");
const pde = mr.referencia_pde;
console.log(`     PDE grid: ${pde.malla.nodos} nodes, ${pde.malla.pasos} steps`);
let pdeMaxPnl = 0, pdeMaxRel = 0, pdeMaxSens = 0;
for (const r of pde.posiciones) {
  const p = porId[r.contrato];
  if (!p) continue;
  for (const nombre of Object.keys(r.escenarios)) {
    const d = Math.abs(p.escenarios[nombre].pnlPosicion - r.escenarios[nombre].pnlPosicion);
    pdeMaxPnl = Math.max(pdeMaxPnl, d);
    pdeMaxRel = Math.max(pdeMaxRel, d / p.capitalReservado);
  }
  for (const g of ["delta", "gamma", "vegaPorPuntoIv", "thetaPorDia"]) {
    pdeMaxSens = Math.max(pdeMaxSens, Math.abs(p.sensibilidadPosicion[g] - r.sensibilidadPosicion[g]));
  }
}
console.log(`     PnL: largest drift ${pdeMaxPnl.toFixed(4)} USD, ${(pdeMaxRel * 100).toFixed(3)} % of reserved capital`);
console.log(`     sensitivities: largest drift ${pdeMaxSens.toExponential(3)}`);
// "efectivo" is the sentinel the Python engine returns for the cash option;
// the identifier is kept, only the display is translated.
const mostrar = (v) => (v === "efectivo" ? "cash" : v);
linea(pdeMaxRel < 0.01, `the PDE drift stays under 1 % of reserved capital`);
linea(obtenido.alternativaRobusta === pde.alternativaRobusta,
      `same robust alternative as the PDE engine: ${mostrar(obtenido.alternativaRobusta)}`);
linea(obtenido.comparacionPresupuesto.mejorEnObjetivoIncluyendoCaja === pde.mejorEnObjetivo,
      `same best in the target scenario as the PDE engine: ${pde.mejorEnObjetivo}`);
linea(JSON.stringify(obtenido.rankings.robustez) === JSON.stringify(pde.rankings.robustez),
      "same robustness ranking as the PDE engine");
linea(JSON.stringify(obtenido.rankings.gananciaObjetivo) === JSON.stringify(pde.rankings.ganancia_objetivo),
      "same target-gain ranking as the PDE engine");

// --- 7. Budget invariants -------------------------------------------------
console.log("\n7) Budget invariants");
let okPresupuesto = true, okEnteros = true;
for (const p of obtenido.posiciones) {
  if (p.capitalReservado > e.presupuesto + 1e-9) okPresupuesto = false;
  if (!Number.isInteger(p.cantidad) || p.cantidad < 1) okEnteros = false;
}
linea(okPresupuesto, "no position reserves more than the budget");
linea(okEnteros, "every quantity is a positive integer");

console.log(`\n${fallos === 0 ? "All correct." : fallos + " check(s) failed."}`);
process.exit(fallos === 0 ? 0 : 1);
