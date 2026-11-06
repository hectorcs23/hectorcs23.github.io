/* Contrasta el motor en JavaScript de esta demo contra el motor Python de
 * hectorcs23/QuantileFlow. Sin red y sin datos privados: solo los dos archivos
 * de referencia que viven junto a este script.
 *
 *   node verificar.cjs
 *
 * Sale con codigo 1 si alguna desviacion supera su tolerancia.
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
  console.log(`  ${ok ? "OK  " : "FALLA"} ${txt}`);
};

// --- 1. Precio: 90 casos del benchmark PDE vs forma cerrada ----------------
console.log("\n1) Precio contra experiments/valoracion_consistente_20261010 (90 casos)");
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
console.log(`     casos: ${ref.casos.length}`);
linea(maxVsBs < 1e-10, `vs forma cerrada de Python: desviacion maxima ${maxVsBs.toExponential(3)} (tolerancia 1e-10)`);
linea(maxVsPde < 1e-3, `vs solver PDE de Python:    desviacion maxima ${maxVsPde.toExponential(3)} (tolerancia 1e-3)`);
console.log(`     desviacion relativa maxima frente al PDE: ${maxRelPde.toExponential(3)}`);

// --- 2. Normal acumulada en puntos conocidos -------------------------------
console.log("\n2) Normal acumulada (Hart) en valores conocidos");
const conocidos = [
  [0, 0.5], [1, 0.841344746068543], [-1, 0.158655253931457],
  [1.959963984540054, 0.975], [-2.5758293035489, 0.005], [6, 0.999999999013412],
];
let maxN = 0;
for (const [x, esperado] of conocidos) maxN = Math.max(maxN, Math.abs(M.ncdf(x) - esperado));
linea(maxN < 1e-12, `desviacion maxima ${maxN.toExponential(3)} (tolerancia 1e-12)`);

// --- 3. Paridad put-call ---------------------------------------------------
console.log("\n3) Paridad put-call: C - P = S e^{-qT} - K e^{-rT}");
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
linea(maxPar < 1e-10, `desviacion maxima ${maxPar.toExponential(3)} en 60 combinaciones (tolerancia 1e-10)`);

// --- 4. Griegas contra diferencias finitas del propio precio ---------------
console.log("\n4) Griegas analiticas contra diferencias finitas");
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
linea(mD < 1e-6, `delta: desviacion maxima ${mD.toExponential(3)}`);
linea(mG < 1e-4, `gamma: desviacion maxima ${mG.toExponential(3)}`);
linea(mV < 1e-7, `vega por punto de IV: desviacion maxima ${mV.toExponential(3)}`);
linea(mT < 1e-7, `theta por dia: desviacion maxima ${mT.toExponential(3)}`);

// --- 5. Motor completo contra la via exacta del motor Python ---------------
// Se contrasta contra comparar_contratos(motor="clasico"), que para europeas
// con IV plana usa la MISMA forma cerrada que este port. Debe coincidir casi
// exactamente: cualquier desviacion apreciable seria un error de traduccion.
console.log("\n5) Motor completo contra comparar_contratos(motor='clasico')");
const mr = leer("caso_motor_referencia.json");
const e = mr.entrada;
const obtenido = M.compararPosiciones({
  contratos: e.contratos, spot: e.spot, escenarios: e.escenarios,
  presupuesto: e.presupuesto, escenarioObjetivo: e.escenarioObjetivo,
  comision: e.comision, semispreadSalida: e.semispreadSalida, tasa: e.tasa, q: e.q,
});
const esp = mr.esperado;

linea(obtenido.posiciones.length === esp.posiciones.length,
      `numero de posiciones aptas: ${obtenido.posiciones.length} (esperado ${esp.posiciones.length})`);
linea(obtenido.excluidos.length === esp.excluidos.length,
      `numero de excluidos: ${obtenido.excluidos.length} (esperado ${esp.excluidos.length})`);
linea(JSON.stringify(obtenido.excluidos.slice().sort((a, b) => a.contrato.localeCompare(b.contrato)))
      === JSON.stringify(esp.excluidos),
      "contratos excluidos y sus motivos identicos");

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
linea(faltan.length === 0, `todas las posiciones esperadas estan presentes${faltan.length ? ": faltan " + faltan.join(", ") : ""}`);
linea(maxCant === 0, `cantidades enteras identicas (desviacion ${maxCant})`);
linea(maxCap < 1e-9, `desembolso, reserva, capital y efectivo libre: desviacion maxima ${maxCap.toExponential(3)} USD`);
linea(maxVal < 1e-10, `valor teorico revalorado: desviacion maxima ${maxVal.toExponential(3)}`);
linea(maxPnl < 1e-8, `PnL por escenario: desviacion maxima ${maxPnl.toExponential(3)} USD`);
linea(maxSens < 1e-6, `sensibilidades de posicion: desviacion maxima ${maxSens.toExponential(3)}`);

// --- 6. Cuanto se separan la forma cerrada y el solver PDE -----------------
// Informativo, no una condicion de fallo del port: para europeas con IV plana
// la forma cerrada es la exacta y el PDE es la aproximacion. Se reporta su
// error de discretizacion y se comprueba que no cambia ninguna decision.
console.log("\n6) Diferencia entre la forma cerrada y el solver PDE del motor Python");
const pde = mr.referencia_pde;
console.log(`     malla del PDE: ${pde.malla.nodos} nodos, ${pde.malla.pasos} pasos`);
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
console.log(`     PnL: separacion maxima ${pdeMaxPnl.toFixed(4)} USD, ${(pdeMaxRel * 100).toFixed(3)} % del capital reservado`);
console.log(`     sensibilidades: separacion maxima ${pdeMaxSens.toExponential(3)}`);
linea(pdeMaxRel < 0.01, `la separacion del PDE queda bajo el 1 % del capital reservado`);
linea(obtenido.alternativaRobusta === pde.alternativaRobusta,
      `misma alternativa robusta que el motor con PDE: ${obtenido.alternativaRobusta}`);
linea(obtenido.comparacionPresupuesto.mejorEnObjetivoIncluyendoCaja === pde.mejorEnObjetivo,
      `mismo mejor en el objetivo que el motor con PDE: ${pde.mejorEnObjetivo}`);
linea(JSON.stringify(obtenido.rankings.robustez) === JSON.stringify(pde.rankings.robustez),
      "mismo ranking de robustez que el motor con PDE");
linea(JSON.stringify(obtenido.rankings.gananciaObjetivo) === JSON.stringify(pde.rankings.ganancia_objetivo),
      "mismo ranking de ganancia en el objetivo que el motor con PDE");

// --- 7. Invariantes del presupuesto ---------------------------------------
console.log("\n7) Invariantes del presupuesto");
let okPresupuesto = true, okEnteros = true;
for (const p of obtenido.posiciones) {
  if (p.capitalReservado > e.presupuesto + 1e-9) okPresupuesto = false;
  if (!Number.isInteger(p.cantidad) || p.cantidad < 1) okEnteros = false;
}
linea(okPresupuesto, "ninguna posicion reserva mas que el presupuesto");
linea(okEnteros, "todas las cantidades son enteros positivos");

console.log(`\n${fallos === 0 ? "Todo correcto." : fallos + " comprobacion(es) fallaron."}`);
process.exit(fallos === 0 ? 0 : 1);
