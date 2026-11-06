/* Demo interface. All the computation happens in motor.js, in the browser:
   this page sends nothing to a server and stores no state. */
(function () {
  "use strict";
  const M = window.QFMotor;
  const $ = (id) => document.getElementById(id);

  const CAMPOS = ["presupuesto", "spot", "comision", "semispread", "tasa", "q",
                  "strikes", "plazos", "iv-base", "sesgo", "ancho", "prima-min",
                  "dias", "mov-objetivo", "mov-contrario", "caida-iv"];

  const OBJETIVO = "target";
  const ESCENARIOS = [OBJETIVO, "no move", "adverse", "IV drops"];

  const usd = (x) => (x < 0 ? "−" : "") + "$" + Math.abs(x).toFixed(2);
  const pct = (x) => (x * 100).toFixed(1) + " %";

  function listaNumeros(texto) {
    return texto.split(",").map((s) => parseFloat(s.trim())).filter((v) => isFinite(v));
  }

  function leer() {
    const spot = parseFloat($("spot").value);
    const porcentajes = listaNumeros($("strikes").value);
    return {
      spot: spot,
      presupuesto: parseFloat($("presupuesto").value),
      comision: parseFloat($("comision").value),
      semispread: parseFloat($("semispread").value),
      tasa: parseFloat($("tasa").value),
      q: parseFloat($("q").value),
      strikes: porcentajes.map((p) => Math.round(spot * (1 + p / 100) * 100) / 100),
      plazos: listaNumeros($("plazos").value),
      ivBase: parseFloat($("iv-base").value),
      sesgo: parseFloat($("sesgo").value),
      ancho: parseFloat($("ancho").value),
      primaMinima: parseFloat($("prima-min").value),
      dias: parseFloat($("dias").value),
      movObjetivo: parseFloat($("mov-objetivo").value) / 100,
      movContrario: parseFloat($("mov-contrario").value) / 100,
      caidaIv: parseFloat($("caida-iv").value),
    };
  }

  let ultimo = null;

  function calcular() {
    const c = leer();
    $("aviso-escenarios").hidden = true;

    if (!c.strikes.length || !c.plazos.length) {
      return fallar("At least one strike and one maturity are needed.");
    }
    if (c.dias > Math.min.apply(null, c.plazos)) {
      return fallar("The days until the exit (" + c.dias + ") exceed the shortest maturity (" +
        Math.min.apply(null, c.plazos) + "). That contract would expire before the scenario.");
    }
    if (c.ivBase - c.caidaIv <= 0) {
      return fallar("An IV drop of " + c.caidaIv + " leaves volatility at zero or below.");
    }

    const contratos = M.cadenaSintetica({
      spot: c.spot, tasa: c.tasa, q: c.q, plazos: c.plazos, strikes: c.strikes,
      ivBase: c.ivBase, sesgo: c.sesgo, curvatura: 2.0,
      ivMin: 0.02, ivMax: 3.0, primaMinima: c.primaMinima,
      anchoMinimo: 0.10, anchoRelativo: c.ancho,
    });
    if (!contratos.length) {
      return fallar("No contract clears the minimum premium. Lower the minimum premium or raise the base IV.");
    }

    const escenarios = [
      { nombre: OBJETIVO, dias: c.dias, retornoSpot: c.movObjetivo, cambioIv: 0 },
      { nombre: "no move", dias: c.dias, retornoSpot: 0, cambioIv: 0 },
      { nombre: "adverse", dias: c.dias, retornoSpot: c.movContrario, cambioIv: 0 },
      { nombre: "IV drops", dias: c.dias, retornoSpot: 0, cambioIv: -c.caidaIv },
    ];

    let res;
    try {
      res = M.compararPosiciones({
        contratos: contratos, spot: c.spot, escenarios: escenarios,
        presupuesto: c.presupuesto, escenarioObjetivo: OBJETIVO,
        comision: c.comision, semispreadSalida: c.semispread, tasa: c.tasa, q: c.q,
      });
    } catch (err) {
      return fallar("The engine rejected this configuration: " + err.message);
    }
    ultimo = { cfg: c, res: res, escenarios: escenarios };
    pintarResumen(res, c);
    pintarTabla(res, escenarios);
    pintarExcluidos(res, contratos.length);
    poblarSelector(res);
    pintarMapa();
  }

  function fallar(mensaje) {
    const aviso = $("aviso-escenarios");
    aviso.textContent = mensaje;
    aviso.hidden = false;
    $("cuerpo").innerHTML = "";
    $("encabezado").innerHTML = "";
    $("resumen-decision").textContent = "";
    $("mapa").innerHTML = "";
    $("mapa-pie").textContent = "";
    ultimo = null;
  }

  function pintarResumen(res, c) {
    const cp = res.comparacionPresupuesto;
    const partes = [];
    partes.push("With " + usd(c.presupuesto) + ", " + res.posiciones.length + " of " +
      (res.posiciones.length + res.excluidos.length) + " contracts in the chain fit.");
    if (cp.mejorEnObjetivoIncluyendoCaja === "efectivo") {
      partes.push("In the target scenario <strong>none of them makes money</strong>: the best move is to stay in cash.");
    } else {
      partes.push("The best in the target scenario is <strong>" + cp.mejorEnObjetivoIncluyendoCaja +
        "</strong>, at " + usd(cp.pnlMejorEnObjetivoIncluyendoCaja) + " of net PnL.");
    }
    if (res.alternativaRobusta === "efectivo") {
      partes.push("On robustness <strong>cash</strong> wins: no candidate has a positive worst case.");
    } else {
      partes.push("On robustness <strong>" + res.alternativaRobusta +
        "</strong> wins, at " + usd(res.pnlRobustoConEfectivo) + " in its worst scenario on the list.");
    }
    $("resumen-decision").innerHTML = partes.join(" ");
  }

  function pintarTabla(res, escenarios) {
    const cols = ["Contract", "Qty", "Premium each", "Outlay", "Reserved capital",
                  "Free cash", "Budget used"]
      .concat(escenarios.map((e) => "PnL " + e.nombre))
      .concat(["Worst on list", "Position delta", "Theta/day"]);
    $("encabezado").innerHTML = cols.map((t) => "<th scope=\"col\">" + t + "</th>").join("");

    if (!res.posiciones.length) {
      $("cuerpo").innerHTML = "<tr><td colspan=\"" + cols.length + "\" class=\"vacio\">" +
        "No contract in the chain fits this budget once the closing commission is reserved too. " +
        "Raise the budget, lower the base IV so premiums get cheaper, or add further-out strikes. " +
        "With the budget untouched, staying in cash is the only possible outcome.</td></tr>";
      return;
    }

    const mejor = res.comparacionPresupuesto.mejorEnObjetivoIncluyendoCaja;
    $("cuerpo").innerHTML = res.posiciones.map(function (p) {
      const signo = (v) => "<td class=\"num " + (v < 0 ? "neg" : v > 0 ? "pos" : "") + "\">" + usd(v) + "</td>";
      return "<tr" + (p.contrato === mejor ? " class=\"mejor\"" : "") + ">" +
        "<th scope=\"row\">" + p.contrato + "</th>" +
        "<td class=\"num\">" + p.cantidad + "</td>" +
        "<td class=\"num\">" + usd(p.primaPorContrato) + "</td>" +
        "<td class=\"num\">" + usd(p.desembolsoEntrada) + "</td>" +
        "<td class=\"num\">" + usd(p.capitalReservado) + "</td>" +
        "<td class=\"num\">" + usd(p.efectivoLibre) + "</td>" +
        "<td class=\"num\">" + pct(p.usoPresupuesto) + "</td>" +
        escenarios.map((e) => signo(p.escenarios[e.nombre].pnlPosicion)).join("") +
        signo(p.pnlMinimoEscenarios) +
        "<td class=\"num\">" + p.sensibilidadPosicion.delta.toFixed(1) + "</td>" +
        "<td class=\"num\">" + usd(p.sensibilidadPosicion.thetaPorDia) + "</td>" +
        "</tr>";
    }).join("");
  }

  function pintarExcluidos(res, total) {
    const MOTIVOS = {
      "no cabe en presupuesto": "does not fit in the budget",
      "cantidad permitida cero": "allowed quantity is zero",
      "vence antes de un escenario": "expires before one of the scenarios",
    };
    $("n-excluidos").textContent = res.excluidos.length;
    $("excluidos").innerHTML = res.excluidos.length
      ? res.excluidos.map((x) => "<li>" + x.contrato + " — " +
          (MOTIVOS[x.motivo] || x.motivo) + "</li>").join("")
      : "<li>None: all " + total + " contracts in the chain fit the budget.</li>";
  }

  function poblarSelector(res) {
    const sel = $("sel-posicion");
    const previo = sel.value;
    if (!res.posiciones.length) {
      sel.innerHTML = "<option value=\"\">(no position to map)</option>";
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = res.posiciones.map(function (p) {
      return "<option value=\"" + p.contrato + "\">" + p.contrato +
        " — " + p.cantidad + " contract(s), " + usd(p.capitalReservado) + " reserved</option>";
    }).join("");
    if (res.posiciones.some((p) => p.contrato === previo)) sel.value = previo;
  }

  function pintarMapa() {
    if (!ultimo) return;
    const { cfg, res } = ultimo;
    const p = res.posiciones.find((x) => x.contrato === $("sel-posicion").value) || res.posiciones[0];
    if (!p) {
      $("mapa").innerHTML = "<p class=\"nota\">With no position fitting the budget there is nothing " +
        "to map: the PnL of staying in cash is zero in every scenario.</p>";
      $("mapa-pie").textContent = "";
      return;
    }
    const contrato = { id: p.contrato, strike: p.strike, dte: p.dte, esCall: p.esCall,
                       iv: p.iv, bid: p.bid, ask: p.ask, multiplicador: p.multiplicador };
    const retornos = [-0.10, -0.06, -0.03, -0.015, 0, 0.015, 0.03, 0.06, 0.10];
    const maxCaida = Math.min(cfg.ivBase - 0.01, 0.10);
    const cambiosIv = [0.10, 0.05, 0, -0.05, -maxCaida]
      .filter((d, i, a) => a.indexOf(d) === i && p.iv + d > 0).sort((a, b) => b - a);

    const mapa = M.mapaPnl({
      contrato: contrato, cantidad: p.cantidad, spot: cfg.spot, dias: cfg.dias,
      retornos: retornos, cambiosIv: cambiosIv,
      comision: cfg.comision, semispreadSalida: cfg.semispread, tasa: cfg.tasa, q: cfg.q,
    });

    let maxAbs = 0;
    mapa.celdas.forEach((f) => f.forEach((v) => { if (isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v)); }));
    const color = function (v) {
      if (!isFinite(v) || maxAbs === 0) return "transparent";
      const t = Math.min(1, Math.abs(v) / maxAbs);
      const a = (0.10 + 0.55 * t).toFixed(3);
      return v < 0 ? "rgba(180, 50, 31, " + a + ")" : "rgba(29, 107, 69, " + a + ")";
    };

    const encabezado = "<tr><th scope=\"col\">Δ IV \\ move</th>" +
      retornos.map((r) => "<th scope=\"col\">" + (r > 0 ? "+" : "") + (r * 100).toFixed(1) + " %</th>").join("") +
      "</tr>";
    const filas = mapa.cambiosIv.map(function (dIv, i) {
      return "<tr><th scope=\"row\">" + (dIv > 0 ? "+" : "") + (dIv * 100).toFixed(0) + " pts</th>" +
        mapa.celdas[i].map(function (v) {
          return "<td style=\"background:" + color(v) + "\">" + (isFinite(v) ? usd(v) : "—") + "</td>";
        }).join("") + "</tr>";
    }).join("");

    $("mapa").innerHTML = "<table><caption class=\"sr\">Net PnL of position " + p.contrato +
      " by move in the underlying and shift in IV</caption><thead>" +
      encabezado + "</thead><tbody>" + filas + "</tbody></table>";
    $("mapa-pie").textContent = p.cantidad + " contract(s) of " + p.contrato +
      ", " + usd(p.desembolsoEntrada) + " outlay and " + usd(p.capitalReservado) +
      " reserved, " + cfg.dias + " day(s) after entry. Expiry at " + p.dte +
      " days, entry IV " + (p.iv * 100).toFixed(1) + " %.";
  }

  // --- Cross-check against the Python engine, in the browser --------------
  async function validar() {
    const caja = $("validacion");
    caja.innerHTML = "<div class=\"info\">Loading the reference cases…</div>";
    let ref, mr;
    try {
      [ref, mr] = await Promise.all([
        fetch("casos_referencia.json").then((r) => r.json()),
        fetch("caso_motor_referencia.json").then((r) => r.json()),
      ]);
    } catch (err) {
      caja.innerHTML = "<div class=\"falla\">The reference cases could not be loaded: " +
        err.message + ". If you opened this file straight from disk, the browser blocks that " +
        "read; the page has to be served.</div>";
      return;
    }

    const salida = [];
    const anadir = (ok, txt) => salida.push("<div class=\"" + (ok ? "ok" : "falla") + "\">" + txt + "</div>");
    const info = (txt) => salida.push("<div class=\"info\">" + txt + "</div>");
    const titulo = (txt) => salida.push("<h3>" + txt + "</h3>");

    titulo("Price against the 90 cases of the PDE benchmark");
    const pr = ref.parametros;
    let mBs = 0, mPde = 0;
    for (const c of ref.casos) {
      const mio = M.precioBS(pr.spot, c.strike, c.dias / 365, pr.tasa, pr.q, c.sigma, c.tipo === "C");
      mBs = Math.max(mBs, Math.abs(mio - c.precio_bs));
      mPde = Math.max(mPde, Math.abs(mio - c.precio_pde));
    }
    anadir(mBs < 1e-10, "against Python's closed form: largest deviation " + mBs.toExponential(3));
    anadir(mPde < 1e-3, "against Python's PDE solver: largest deviation " + mPde.toExponential(3));

    titulo("Put-call parity");
    let mPar = 0;
    for (const dte of [7, 30, 90, 180]) for (const k of [80, 95, 100, 110, 130]) for (const s of [0.1, 0.25, 0.6]) {
      const T = dte / 365;
      const d = M.precioBS(100, k, T, 0.04, 0.013, s, true) - M.precioBS(100, k, T, 0.04, 0.013, s, false)
        - (100 * Math.exp(-0.013 * T) - k * Math.exp(-0.04 * T));
      mPar = Math.max(mPar, Math.abs(d));
    }
    anadir(mPar < 1e-10, "C − P = S e^{−qT} − K e^{−rT} across 60 combinations: largest deviation " + mPar.toExponential(3));

    titulo("Greeks against finite differences of the price itself");
    let gD = 0, gG = 0, gV = 0, gT = 0;
    for (const dte of [14, 30, 90]) for (const k of [90, 100, 110]) for (const esCall of [true, false]) {
      const T = dte / 365, sg = 0.25, h = 1e-4;
      const g = M.griegasBS(100, k, T, 0.04, 0.013, sg, esCall);
      const P = (s, sig, t) => M.precioBS(s, k, t, 0.04, 0.013, sig, esCall);
      gD = Math.max(gD, Math.abs(g.delta - (P(100 + h, sg, T) - P(100 - h, sg, T)) / (2 * h)));
      gG = Math.max(gG, Math.abs(g.gamma - (P(100 + h, sg, T) - 2 * P(100, sg, T) + P(100 - h, sg, T)) / (h * h)));
      gV = Math.max(gV, Math.abs(g.vegaPorPuntoIv - (P(100, sg + h, T) - P(100, sg - h, T)) / (2 * h) / 100));
      gT = Math.max(gT, Math.abs(g.thetaPorDia + (P(100, sg, T + h) - P(100, sg, T - h)) / (2 * h) / 365));
    }
    anadir(gD < 1e-6, "delta: " + gD.toExponential(3));
    anadir(gG < 1e-4, "gamma: " + gG.toExponential(3));
    anadir(gV < 1e-7, "vega per IV point: " + gV.toExponential(3));
    anadir(gT < 1e-7, "theta per day: " + gT.toExponential(3));

    titulo("Full engine against comparar_contratos(motor='clasico')");
    const e = mr.entrada;
    const obt = M.compararPosiciones({
      contratos: e.contratos, spot: e.spot, escenarios: e.escenarios,
      presupuesto: e.presupuesto, escenarioObjetivo: e.escenarioObjetivo,
      comision: e.comision, semispreadSalida: e.semispreadSalida, tasa: e.tasa, q: e.q,
    });
    const porId = {};
    obt.posiciones.forEach((p) => { porId[p.contrato] = p; });
    anadir(obt.posiciones.length === mr.esperado.posiciones.length,
      "eligible positions: " + obt.posiciones.length + " (expected " + mr.esperado.posiciones.length + ")");
    anadir(obt.excluidos.length === mr.esperado.excluidos.length,
      "excluded: " + obt.excluidos.length + " (expected " + mr.esperado.excluidos.length + ")");
    let dCant = 0, dCap = 0, dPnl = 0, dSens = 0;
    for (const r of mr.esperado.posiciones) {
      const p = porId[r.contrato];
      if (!p) continue;
      dCant = Math.max(dCant, Math.abs(p.cantidad - r.cantidad));
      dCap = Math.max(dCap, Math.abs(p.capitalReservado - r.capitalReservado),
                            Math.abs(p.efectivoLibre - r.efectivoLibre));
      for (const n of Object.keys(r.escenarios)) {
        dPnl = Math.max(dPnl, Math.abs(p.escenarios[n].pnlPosicion - r.escenarios[n].pnlPosicion));
      }
      for (const g of ["delta", "gamma", "vegaPorPuntoIv", "thetaPorDia"]) {
        dSens = Math.max(dSens, Math.abs(p.sensibilidadPosicion[g] - r.sensibilidadPosicion[g]));
      }
    }
    anadir(dCant === 0, "whole quantities identical");
    anadir(dCap < 1e-9, "reserved capital and free cash: largest deviation " + dCap.toExponential(3) + " USD");
    anadir(dPnl < 1e-8, "PnL per scenario: largest deviation " + dPnl.toExponential(3) + " USD");
    anadir(dSens < 1e-6, "position sensitivities: largest deviation " + dSens.toExponential(3));

    titulo("How far the PDE solver drifts");
    const pde = mr.referencia_pde;
    let sPnl = 0, sRel = 0;
    for (const r of pde.posiciones) {
      const p = porId[r.contrato];
      if (!p) continue;
      for (const n of Object.keys(r.escenarios)) {
        const d = Math.abs(p.escenarios[n].pnlPosicion - r.escenarios[n].pnlPosicion);
        sPnl = Math.max(sPnl, d);
        sRel = Math.max(sRel, d / p.capitalReservado);
      }
    }
    info("PDE grid: " + pde.malla.nodos + " nodes, " + pde.malla.pasos + " steps.");
    info("For European options with flat IV the closed form is the exact one; this is the PDE's discretisation error.");
    anadir(sRel < 0.01, "largest drift " + sPnl.toFixed(4) + " USD, " +
      (sRel * 100).toFixed(3) + " % of reserved capital");
    anadir(JSON.stringify(obt.rankings.robustez) === JSON.stringify(pde.rankings.robustez),
      "it does not change the robustness ranking");
    anadir(obt.comparacionPresupuesto.mejorEnObjetivoIncluyendoCaja === pde.mejorEnObjetivo,
      "it does not change the best in the target scenario (" + pde.mejorEnObjetivo + ")");

    const fallas = salida.filter((s) => s.indexOf("class=\"falla\"") >= 0).length;
    salida.push("<h3>" + (fallas === 0 ? "All correct." : fallas + " check(s) failed.") + "</h3>");
    caja.innerHTML = salida.join("");
  }

  CAMPOS.forEach(function (id) {
    const el = $(id);
    if (el) el.addEventListener("input", calcular);
  });
  $("sel-posicion").addEventListener("change", pintarMapa);
  $("btn-validar").addEventListener("click", validar);
  calcular();
})();
