/* QuantileFlow — budget comparator engine, ported to JavaScript.
 *
 * This is a translation of the Python engine in hectorcs23/QuantileFlow:
 *   quantileflow/escenarios.py   comparar_contratos  (quantities, costs, PnL)
 *   quantileflow/comparador.py   comparar_con_pdf    (rankings and capital)
 *   quantileflow/posiciones.py   comparar_posiciones (per-position view)
 *   quantileflow/opciones.py     precio_bs, griegas_bs
 *
 * Identifiers are deliberately kept in Spanish, mirroring the Python modules
 * they come from, so the port can be read line against line with its source.
 * Comments and anything a user sees are in English.
 *
 * Deliberate difference: the Python engine reprices with a 1601-node PDE
 * solver; here the closed form of Black-Scholes is used instead. For European
 * options with flat IV -- the scope the engine itself declares -- the two are
 * equivalent, and the repository already measured it:
 * experiments/valoracion_consistente_20261010 compares both routes over 90
 * cases with a price error of the order of 3e-5. verificar.cjs checks it again
 * against those same cases.
 *
 * Synthetic data. No broker connection, no probabilities are estimated, and
 * nothing here is a recommendation to buy.
 */
(function (raiz) {
  "use strict";

  // --- Cumulative normal: Hart (1968), error < 1e-15 in double precision ---
  function ncdf(x) {
    if (!isFinite(x)) return x > 0 ? 1 : 0;
    const z = Math.abs(x);
    if (z > 37) return x > 0 ? 1 : 0;
    const e = Math.exp(-z * z / 2);
    let p;
    if (z < 7.07106781186547) {
      let b = 3.52624965998911e-2 * z + 0.700383064443688;
      b = b * z + 6.37396220353165;
      b = b * z + 33.912866078383;
      b = b * z + 112.079291497871;
      b = b * z + 221.213596169931;
      b = b * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      p = e * b / d;
    } else {
      let f = z + 0.65;
      f = z + 4 / f;
      f = z + 3 / f;
      f = z + 2 / f;
      f = z + 1 / f;
      p = e / (f * 2.506628274631);
    }
    return x > 0 ? 1 - p : p;
  }

  const RAIZ_2PI = Math.sqrt(2 * Math.PI);
  function npdf(x) { return Math.exp(-x * x / 2) / RAIZ_2PI; }

  function pago(s, k, esCall) {
    return Math.max(esCall ? s - k : k - s, 0);
  }

  /* Black-Scholes with a continuous dividend yield q.
     Same parametrisation as quantileflow/opciones.py: the forward
     F = S e^{(r-q)T} is discounted with D = e^{-rT}. */
  function precioBS(S, K, T, r, q, sigma, esCall) {
    if (!(T > 0) || !(sigma > 0)) return pago(S, K, esCall);
    const F = S * Math.exp((r - q) * T);
    const D = Math.exp(-r * T);
    const sv = sigma * Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * sv * sv) / sv;
    const d2 = d1 - sv;
    return esCall ? D * (F * ncdf(d1) - K * ncdf(d2))
                  : D * (K * ncdf(-d2) - F * ncdf(-d1));
  }

  /* Delta, gamma, vega per IV point and theta per day.
     vega_por_punto_iv = vega/100 and theta_por_dia = -(dV/dT)/365, the same
     conventions comparador.py uses when reading the greeks off the PDE. */
  function griegasBS(S, K, T, r, q, sigma, esCall) {
    if (!(T > 0) || !(sigma > 0)) {
      const dentro = esCall ? S > K : S < K;
      return { delta: dentro ? (esCall ? 1 : -1) : 0, gamma: 0,
               vegaPorPuntoIv: 0, thetaPorDia: 0 };
    }
    const F = S * Math.exp((r - q) * T);
    const rt = Math.sqrt(T);
    const sv = sigma * rt;
    const d1 = (Math.log(F / K) + 0.5 * sv * sv) / sv;
    const d2 = d1 - sv;
    const eq = Math.exp(-q * T);
    const er = Math.exp(-r * T);
    const n1 = npdf(d1);
    const delta = esCall ? eq * ncdf(d1) : eq * (ncdf(d1) - 1);
    const gamma = eq * n1 / (S * sigma * rt);
    const vega = S * eq * n1 * rt;              // per unit of volatility
    const difusion = S * eq * n1 * sigma / (2 * rt);
    const dVdT = esCall
      ? difusion - q * S * eq * ncdf(d1) + r * K * er * ncdf(d2)
      : difusion + q * S * eq * ncdf(-d1) - r * K * er * ncdf(-d2);
    return { delta: delta, gamma: gamma,
             vegaPorPuntoIv: vega / 100, thetaPorDia: -dVdT / 365 };
  }

  // --- Validation, equivalent to ContratoEscenario and Escenario -----------
  function validarContrato(c) {
    if (typeof c.id !== "string" || !c.id.trim()) throw new Error("a non-empty identifier is required");
    if (typeof c.esCall !== "boolean") throw new Error("esCall must be a boolean");
    for (const v of [c.strike, c.dte, c.iv, c.bid, c.ask]) {
      if (!isFinite(v)) throw new Error("contract parameters are not finite");
    }
    if (Math.min(c.strike, c.dte, c.iv) <= 0) throw new Error("strike, dte and iv must be positive");
    if (c.bid < 0 || c.ask <= 0 || c.bid > c.ask) throw new Error("invalid quote: " + c.id);
    const m = c.multiplicador === undefined ? 100 : c.multiplicador;
    if (!Number.isInteger(m) || m <= 0) throw new Error("multiplier must be a positive integer");
  }

  function validarEscenario(e) {
    if (typeof e.nombre !== "string" || !e.nombre.trim()) throw new Error("a scenario name is required");
    for (const v of [e.dias, e.retornoSpot, e.cambioIv === undefined ? 0 : e.cambioIv]) {
      if (!isFinite(v)) throw new Error("scenario is not finite");
    }
    if (e.dias < 0 || e.retornoSpot <= -1) throw new Error("negative horizon or non-positive spot");
  }

  /* Compares the total net PnL of every candidate on the SAME budget.
   *
   * Policy, as in Python: buy the largest whole quantity of a single series
   * that fits the budget while ALSO reserving the closing commission. Series
   * are never mixed, no optimal size is sought, and no probability is attached
   * to any scenario. */
  function compararPosiciones(cfg) {
    const spot = cfg.spot;
    const presupuesto = cfg.presupuesto;
    const comision = cfg.comision === undefined ? 0.65 : cfg.comision;
    const semispread = cfg.semispreadSalida === undefined ? 0.04 : cfg.semispreadSalida;
    const tasa = cfg.tasa === undefined ? 0.04 : cfg.tasa;
    const q = cfg.q === undefined ? 0 : cfg.q;
    const limites = cfg.limitesCantidad || {};
    const contratos = cfg.contratos.slice();
    const escenarios = cfg.escenarios.slice();
    const objetivo = cfg.escenarioObjetivo;

    if (!isFinite(presupuesto) || presupuesto <= 0) throw new Error("budget must be positive and finite");
    if (!isFinite(comision) || !isFinite(semispread) || Math.min(comision, semispread) < 0) {
      throw new Error("invalid costs");
    }
    if (!isFinite(spot) || spot <= 0) throw new Error("invalid reference");
    if (!escenarios.length) throw new Error("at least one scenario is required");
    const nombres = new Set(escenarios.map(function (e) { return e.nombre; }));
    if (nombres.size !== escenarios.length) throw new Error("scenarios must be unique");
    if (!nombres.has(objetivo)) throw new Error("the target scenario must be on the list");
    const ids = new Set(contratos.map(function (c) { return c.id; }));
    if (ids.size !== contratos.length) throw new Error("identifiers must be unique");
    contratos.forEach(validarContrato);
    escenarios.forEach(validarEscenario);

    const filas = [];
    const excluidos = [];

    for (const c of contratos) {
      const m = c.multiplicador === undefined ? 100 : c.multiplicador;
      const unitario = c.ask * m + comision;
      let n = Math.floor(presupuesto / (unitario + comision));   // reserves the close
      if (Object.prototype.hasOwnProperty.call(limites, c.id)) n = Math.min(n, limites[c.id]);
      const vencePronto = escenarios.some(function (e) { return e.dias > c.dte; });
      if (n === 0 || vencePronto) {
        excluidos.push({
          contrato: c.id,
          motivo: n === 0
            ? (limites[c.id] === 0 ? "cantidad permitida cero" : "no cabe en presupuesto")
            : "vence antes de un escenario",
        });
        continue;
      }
      const desembolso = n * unitario;
      const capital = desembolso + n * comision;
      const casos = {};
      for (const e of escenarios) {
        const alVencer = e.dias === c.dte;
        const restante = (c.dte - e.dias) / 365;
        const sigma = c.iv + (e.cambioIv === undefined ? 0 : e.cambioIv);
        if (!(sigma > 0) || !isFinite(sigma)) throw new Error("scenario volatility is not positive");
        const s = spot * (1 + e.retornoSpot);
        const teorico = alVencer ? pago(s, c.strike, c.esCall)
                                 : precioBS(s, c.strike, restante, tasa, q, sigma, c.esCall);
        // At expiry the payoff rules and no exit semispread is taken out.
        const salida = alVencer ? teorico : Math.max(0, teorico - semispread);
        const pnl = n * (salida * m - comision) - desembolso;
        casos[e.nombre] = {
          valorTeorico: teorico,
          precioSalidaAsumido: salida,
          pnlPosicion: pnl,
          pnlPorContrato: pnl / n,
          capitalFinalIncluyendoCaja: presupuesto + pnl,
          retornoPresupuesto: pnl / presupuesto,
          retornoDesembolso: pnl / desembolso,
          retornoCapitalReservado: pnl / capital,
        };
      }
      const pnls = escenarios.map(function (e) { return casos[e.nombre].pnlPosicion; });
      const entrada = griegasBS(spot, c.strike, c.dte / 365, tasa, q, c.iv, c.esCall);
      filas.push({
        contrato: c.id, strike: c.strike, dte: c.dte, esCall: c.esCall,
        iv: c.iv, bid: c.bid, ask: c.ask, multiplicador: m, cantidad: n,
        primaPorContrato: c.ask * m,
        primaTotal: n * m * c.ask,
        desembolsoEntrada: desembolso,
        reservaComisionCierre: n * comision,
        capitalReservado: capital,
        capitalReservadoPorContrato: capital / n,
        efectivoSobrante: presupuesto - desembolso,
        efectivoLibre: presupuesto - capital,
        usoPresupuesto: capital / presupuesto,
        perdidaMaximaCostosAsumidos: capital,
        pnlMinimoEscenarios: Math.min.apply(null, pnls),
        pnlObjetivo: casos[objetivo].pnlPosicion,
        retornoObjetivo: casos[objetivo].pnlPosicion / capital,
        sensibilidadEntrada: entrada,
        sensibilidadPosicion: {
          delta: n * m * entrada.delta,
          gamma: n * m * entrada.gamma,
          vegaPorPuntoIv: n * m * entrada.vegaPorPuntoIv,
          thetaPorDia: n * m * entrada.thetaPorDia,
        },
        escenarios: casos,
      });
    }

    function porCampo(campo) {
      return filas.slice().sort(function (a, b) {
        return (b[campo] - a[campo]) || a.contrato.localeCompare(b.contrato);
      });
    }
    const posiciones = porCampo("pnlObjetivo");
    const robustos = porCampo("pnlMinimoEscenarios");
    const ganador = robustos.length ? robustos[0] : null;
    const mejor = posiciones.length ? posiciones[0] : null;
    const pnlMejor = mejor ? mejor.escenarios[objetivo].pnlPosicion : 0;

    return {
      posiciones: posiciones,
      excluidos: excluidos,
      presupuesto: presupuesto,
      escenarioObjetivo: objetivo,
      costos: { comisionPorContratoYLado: comision, semispreadSalidaPorUnidad: semispread },
      rankings: {
        gananciaObjetivo: porCampo("pnlObjetivo").map(function (f) { return f.contrato; }),
        retornoObjetivo: porCampo("retornoObjetivo").map(function (f) { return f.contrato; }),
        robustez: robustos.map(function (f) { return f.contrato; }),
      },
      criterioRobusto: "maximise the minimum PnL on the list; cash has zero PnL",
      alternativaRobusta: ganador && ganador.pnlMinimoEscenarios > 0 ? ganador.contrato : "efectivo",
      pnlRobustoConEfectivo: Math.max(0, ganador ? ganador.pnlMinimoEscenarios : 0),
      comparacionPresupuesto: {
        criterioPrincipal: "total net PnL in the target scenario; same budget",
        mejorEnObjetivoIncluyendoCaja: pnlMejor > 0 ? mejor.contrato : "efectivo",
        pnlMejorEnObjetivoIncluyendoCaja: Math.max(0, pnlMejor),
        efectivo: { capitalInicial: presupuesto, capitalFinal: presupuesto, pnl: 0 },
        politicaCantidad: "largest whole quantity per series within budget and quantity limits",
        mezclaSeries: false,
        probabilidadesEscenarios: "not estimated",
      },
      alcance: "European, flat IV per contract; conditional comparison, not a forecast",
      datos: "synthetic",
    };
  }

  /* PnL map of ONE position over a grid of move x IV change, at a fixed number
   * of days elapsed. Every cell is fully repriced, not approximated locally
   * with the greeks. */
  function mapaPnl(cfg) {
    const c = cfg.contrato;
    const m = c.multiplicador === undefined ? 100 : c.multiplicador;
    const comision = cfg.comision === undefined ? 0.65 : cfg.comision;
    const semispread = cfg.semispreadSalida === undefined ? 0.04 : cfg.semispreadSalida;
    const tasa = cfg.tasa === undefined ? 0.04 : cfg.tasa;
    const q = cfg.q === undefined ? 0 : cfg.q;
    const n = cfg.cantidad;
    const desembolso = n * (c.ask * m + comision);
    const celdas = [];
    for (const dIv of cfg.cambiosIv) {
      const fila = [];
      for (const ret of cfg.retornos) {
        const alVencer = cfg.dias === c.dte;
        const sigma = c.iv + dIv;
        const s = cfg.spot * (1 + ret);
        let pnl = NaN;
        if (sigma > 0 && cfg.dias <= c.dte) {
          const teorico = alVencer ? pago(s, c.strike, c.esCall)
            : precioBS(s, c.strike, (c.dte - cfg.dias) / 365, tasa, q, sigma, c.esCall);
          const salida = alVencer ? teorico : Math.max(0, teorico - semispread);
          pnl = n * (salida * m - comision) - desembolso;
        }
        fila.push(pnl);
      }
      celdas.push(fila);
    }
    return { celdas: celdas, retornos: cfg.retornos, cambiosIv: cfg.cambiosIv,
             dias: cfg.dias, cantidad: n, desembolso: desembolso };
  }

  /* Synthetic chain: a downward-skewed smile with quotes around the
   * theoretical price at a controlled width. This is not a market chain. */
  function cadenaSintetica(cfg) {
    const spot = cfg.spot, tasa = cfg.tasa, q = cfg.q;
    const contratos = [];
    for (const dte of cfg.plazos) {
      const T = dte / 365;
      const F = spot * Math.exp((tasa - q) * T);
      for (const strike of cfg.strikes) {
        for (const esCall of [true, false]) {
          const k = Math.log(strike / F);
          const iv = Math.min(cfg.ivMax, Math.max(cfg.ivMin,
            cfg.ivBase - cfg.sesgo * k + cfg.curvatura * k * k));
          const mid = precioBS(spot, strike, T, tasa, q, iv, esCall);
          if (!(mid > cfg.primaMinima)) continue;
          const medio = Math.max(cfg.anchoMinimo / 2, mid * cfg.anchoRelativo / 2);
          const bid = Math.max(0.05, mid - medio);
          const ask = mid + medio;
          const etiqueta = (esCall ? "C" : "P") + strike + "-" + dte + "d";
          contratos.push({ id: etiqueta, strike: strike, dte: dte, esCall: esCall,
                           ejercicio: "europeo", iv: iv,
                           bid: Math.round(bid * 100) / 100,
                           ask: Math.round(ask * 100) / 100, multiplicador: 100 });
        }
      }
    }
    return contratos;
  }

  const api = { ncdf: ncdf, npdf: npdf, pago: pago, precioBS: precioBS,
                griegasBS: griegasBS, compararPosiciones: compararPosiciones,
                mapaPnl: mapaPnl, cadenaSintetica: cadenaSintetica };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.QFMotor = api;
})(typeof self !== "undefined" ? self : this);
