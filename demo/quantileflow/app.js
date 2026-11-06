/* Interfaz de la demo. Todo el cálculo lo hace motor.js en el navegador: esta
   página no envía nada a ningún servidor ni guarda estado. */
(function () {
  "use strict";
  const M = window.QFMotor;
  const $ = (id) => document.getElementById(id);

  const CAMPOS = ["presupuesto", "spot", "comision", "semispread", "tasa", "q",
                  "strikes", "plazos", "iv-base", "sesgo", "ancho", "prima-min",
                  "dias", "mov-objetivo", "mov-contrario", "caida-iv"];

  const usd = (x) => (x < 0 ? "−" : "") + "$" + Math.abs(x).toFixed(2);
  const pct = (x) => (x * 100).toFixed(1) + " %";

  function listaNumeros(texto) {
    return texto.split(",").map((s) => parseFloat(s.trim()))
      .filter((v) => isFinite(v));
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
    const aviso = $("aviso-escenarios");
    aviso.hidden = true;

    if (!c.strikes.length || !c.plazos.length) {
      return fallar("Hacen falta al menos un strike y un plazo.");
    }
    if (c.dias > Math.min.apply(null, c.plazos)) {
      return fallar("Los días hasta la salida (" + c.dias + ") superan el plazo más corto (" +
        Math.min.apply(null, c.plazos) + "). Ese contrato vencería antes del escenario.");
    }
    if (c.ivBase - c.caidaIv <= 0) {
      return fallar("La caída de IV (" + c.caidaIv + ") deja la volatilidad en cero o negativa.");
    }

    const contratos = M.cadenaSintetica({
      spot: c.spot, tasa: c.tasa, q: c.q, plazos: c.plazos, strikes: c.strikes,
      ivBase: c.ivBase, sesgo: c.sesgo, curvatura: 2.0,
      ivMin: 0.02, ivMax: 3.0, primaMinima: c.primaMinima,
      anchoMinimo: 0.10, anchoRelativo: c.ancho,
    });
    if (!contratos.length) {
      return fallar("Ningún contrato supera la prima mínima. Baja la prima mínima o sube la IV base.");
    }

    const escenarios = [
      { nombre: "objetivo", dias: c.dias, retornoSpot: c.movObjetivo, cambioIv: 0 },
      { nombre: "sin movimiento", dias: c.dias, retornoSpot: 0, cambioIv: 0 },
      { nombre: "contrario", dias: c.dias, retornoSpot: c.movContrario, cambioIv: 0 },
      { nombre: "cae la IV", dias: c.dias, retornoSpot: 0, cambioIv: -c.caidaIv },
    ];

    let res;
    try {
      res = M.compararPosiciones({
        contratos: contratos, spot: c.spot, escenarios: escenarios,
        presupuesto: c.presupuesto, escenarioObjetivo: "objetivo",
        comision: c.comision, semispreadSalida: c.semispread, tasa: c.tasa, q: c.q,
      });
    } catch (err) {
      return fallar("El motor rechazó la configuración: " + err.message);
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
    partes.push("Con " + usd(c.presupuesto) + " entran " + res.posiciones.length +
      " de " + (res.posiciones.length + res.excluidos.length) + " contratos de la cadena.");
    if (cp.mejorEnObjetivoIncluyendoCaja === "efectivo") {
      partes.push("En el escenario objetivo <strong>ninguno gana dinero</strong>: lo mejor es quedarse en efectivo.");
    } else {
      partes.push("El mejor en el objetivo es <strong>" + cp.mejorEnObjetivoIncluyendoCaja +
        "</strong>, con " + usd(cp.pnlMejorEnObjetivoIncluyendoCaja) + " de PnL neto.");
    }
    if (res.alternativaRobusta === "efectivo") {
      partes.push("Por robustez gana el <strong>efectivo</strong>: ningún candidato tiene peor caso positivo.");
    } else {
      partes.push("Por robustez gana <strong>" + res.alternativaRobusta +
        "</strong>, con " + usd(res.pnlRobustoConEfectivo) + " en su peor escenario de la lista.");
    }
    $("resumen-decision").innerHTML = partes.join(" ");
  }

  function pintarTabla(res, escenarios) {
    const cols = ["Contrato", "Cant.", "Prima/contrato", "Desembolso", "Capital reservado",
                  "Efectivo libre", "Uso presup."]
      .concat(escenarios.map((e) => "PnL " + e.nombre))
      .concat(["Peor de la lista", "Delta pos.", "Theta/día"]);
    $("encabezado").innerHTML = cols.map((t) => "<th scope=\"col\">" + t + "</th>").join("");

    if (!res.posiciones.length) {
      $("cuerpo").innerHTML = "<tr><td colspan=\"" + cols.length + "\" class=\"vacio\">" +
        "Ningún contrato de la cadena cabe en este presupuesto reservando también la comisión " +
        "de cierre. Sube el presupuesto, baja la IV base para que las primas sean más baratas, " +
        "o añade strikes más lejanos. Con el presupuesto intacto, quedarse en efectivo es el " +
        "único resultado posible.</td></tr>";
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
    $("n-excluidos").textContent = res.excluidos.length;
    $("excluidos").innerHTML = res.excluidos.length
      ? res.excluidos.map((x) => "<li>" + x.contrato + " — " + x.motivo + "</li>").join("")
      : "<li>Ninguno: los " + total + " contratos de la cadena caben en el presupuesto.</li>";
  }

  function poblarSelector(res) {
    const sel = $("sel-posicion");
    const previo = sel.value;
    if (!res.posiciones.length) {
      sel.innerHTML = "<option value=\"\">(no hay ninguna posición que mapear)</option>";
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = res.posiciones.map(function (p) {
      return "<option value=\"" + p.contrato + "\">" + p.contrato +
        " — " + p.cantidad + " contrato(s), " + usd(p.capitalReservado) + " reservados</option>";
    }).join("");
    if (res.posiciones.some((p) => p.contrato === previo)) sel.value = previo;
  }

  function pintarMapa() {
    if (!ultimo) return;
    const { cfg, res } = ultimo;
    const p = res.posiciones.find((x) => x.contrato === $("sel-posicion").value) || res.posiciones[0];
    if (!p) {
      $("mapa").innerHTML = "<p class=\"nota\">Sin posiciones que quepan en el presupuesto no hay " +
        "nada que mapear: el PnL de quedarse en efectivo es cero en cualquier escenario.</p>";
      $("mapa-pie").textContent = "";
      return;
    }
    const contrato = { id: p.contrato, strike: p.strike, dte: p.dte, esCall: p.esCall,
                       iv: p.iv, bid: p.bid, ask: p.ask, multiplicador: p.multiplicador };
    const retornos = [-0.10, -0.06, -0.03, -0.015, 0, 0.015, 0.03, 0.06, 0.10];
    const maxCaida = Math.min(cfg.ivBase - 0.01, 0.10);
    const cambiosIv = [0.10, 0.05, 0, -0.05, -maxCaida].filter(
      (d, i, a) => a.indexOf(d) === i && p.iv + d > 0).sort((a, b) => b - a);

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

    const encabezado = "<tr><th scope=\"col\">Δ IV \\ mov.</th>" +
      retornos.map((r) => "<th scope=\"col\">" + (r > 0 ? "+" : "") + (r * 100).toFixed(1) + " %</th>").join("") +
      "</tr>";
    const filas = mapa.cambiosIv.map(function (dIv, i) {
      return "<tr><th scope=\"row\">" + (dIv > 0 ? "+" : "") + (dIv * 100).toFixed(0) + " pts</th>" +
        mapa.celdas[i].map(function (v) {
          return "<td style=\"background:" + color(v) + "\">" +
            (isFinite(v) ? usd(v) : "—") + "</td>";
        }).join("") + "</tr>";
    }).join("");

    $("mapa").innerHTML = "<table><caption class=\"sr\">PnL neto de la posición " + p.contrato +
      " por movimiento del subyacente y desplazamiento de IV</caption><thead>" +
      encabezado + "</thead><tbody>" + filas + "</tbody></table>";
    $("mapa-pie").textContent = p.cantidad + " contrato(s) de " + p.contrato +
      ", " + usd(p.desembolsoEntrada) + " de desembolso y " + usd(p.capitalReservado) +
      " reservados, a " + cfg.dias + " día(s) de la entrada. Vencimiento a " + p.dte +
      " días, IV de entrada " + (p.iv * 100).toFixed(1) + " %.";
  }

  // --- Contraste contra el motor Python, en el navegador -------------------
  async function validar() {
    const caja = $("validacion");
    caja.innerHTML = "<div class=\"info\">Cargando los casos de referencia…</div>";
    let ref, mr;
    try {
      [ref, mr] = await Promise.all([
        fetch("casos_referencia.json").then((r) => r.json()),
        fetch("caso_motor_referencia.json").then((r) => r.json()),
      ]);
    } catch (err) {
      caja.innerHTML = "<div class=\"falla\">No se pudieron cargar los casos de referencia: " +
        err.message + ". Si abriste el archivo directamente desde el disco, el navegador bloquea " +
        "esa lectura; hace falta servir la página.</div>";
      return;
    }

    const salida = [];
    const añadir = (ok, txt) => salida.push("<div class=\"" + (ok ? "ok" : "falla") + "\">" + txt + "</div>");
    const info = (txt) => salida.push("<div class=\"info\">" + txt + "</div>");
    const titulo = (txt) => salida.push("<h3>" + txt + "</h3>");

    titulo("Precio contra los 90 casos del benchmark PDE");
    const pr = ref.parametros;
    let mBs = 0, mPde = 0;
    for (const c of ref.casos) {
      const mio = M.precioBS(pr.spot, c.strike, c.dias / 365, pr.tasa, pr.q, c.sigma, c.tipo === "C");
      mBs = Math.max(mBs, Math.abs(mio - c.precio_bs));
      mPde = Math.max(mPde, Math.abs(mio - c.precio_pde));
    }
    añadir(mBs < 1e-10, "vs la forma cerrada de Python: desviación máxima " + mBs.toExponential(3));
    añadir(mPde < 1e-3, "vs el solver PDE de Python: desviación máxima " + mPde.toExponential(3));

    titulo("Paridad put-call");
    let mPar = 0;
    for (const dte of [7, 30, 90, 180]) for (const k of [80, 95, 100, 110, 130]) for (const s of [0.1, 0.25, 0.6]) {
      const T = dte / 365;
      const d = M.precioBS(100, k, T, 0.04, 0.013, s, true) - M.precioBS(100, k, T, 0.04, 0.013, s, false)
        - (100 * Math.exp(-0.013 * T) - k * Math.exp(-0.04 * T));
      mPar = Math.max(mPar, Math.abs(d));
    }
    añadir(mPar < 1e-10, "C − P = S e^{−qT} − K e^{−rT} en 60 combinaciones: desviación máxima " + mPar.toExponential(3));

    titulo("Griegas contra diferencias finitas del propio precio");
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
    añadir(gD < 1e-6, "delta: " + gD.toExponential(3));
    añadir(gG < 1e-4, "gamma: " + gG.toExponential(3));
    añadir(gV < 1e-7, "vega por punto de IV: " + gV.toExponential(3));
    añadir(gT < 1e-7, "theta por día: " + gT.toExponential(3));

    titulo("Motor completo contra comparar_contratos(motor='clasico')");
    const e = mr.entrada;
    const obt = M.compararPosiciones({
      contratos: e.contratos, spot: e.spot, escenarios: e.escenarios,
      presupuesto: e.presupuesto, escenarioObjetivo: e.escenarioObjetivo,
      comision: e.comision, semispreadSalida: e.semispreadSalida, tasa: e.tasa, q: e.q,
    });
    const porId = {};
    obt.posiciones.forEach((p) => { porId[p.contrato] = p; });
    añadir(obt.posiciones.length === mr.esperado.posiciones.length,
      "posiciones aptas: " + obt.posiciones.length + " (esperado " + mr.esperado.posiciones.length + ")");
    añadir(obt.excluidos.length === mr.esperado.excluidos.length,
      "excluidos: " + obt.excluidos.length + " (esperado " + mr.esperado.excluidos.length + ")");
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
    añadir(dCant === 0, "cantidades enteras idénticas");
    añadir(dCap < 1e-9, "capital reservado y efectivo libre: desviación máxima " + dCap.toExponential(3) + " USD");
    añadir(dPnl < 1e-8, "PnL por escenario: desviación máxima " + dPnl.toExponential(3) + " USD");
    añadir(dSens < 1e-6, "sensibilidades de posición: desviación máxima " + dSens.toExponential(3));

    titulo("Cuánto se separa el solver PDE");
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
    info("Malla del PDE: " + pde.malla.nodos + " nodos, " + pde.malla.pasos + " pasos.");
    info("Para europeas con IV plana la forma cerrada es la exacta; esto es el error de discretización del PDE.");
    añadir(sRel < 0.01, "separación máxima " + sPnl.toFixed(4) + " USD, " +
      (sRel * 100).toFixed(3) + " % del capital reservado");
    añadir(JSON.stringify(obt.rankings.robustez) === JSON.stringify(pde.rankings.robustez),
      "no cambia el ranking de robustez");
    añadir(obt.comparacionPresupuesto.mejorEnObjetivoIncluyendoCaja === pde.mejorEnObjetivo,
      "no cambia el mejor en el objetivo (" + pde.mejorEnObjetivo + ")");

    const fallas = salida.filter((s) => s.indexOf("class=\"falla\"") >= 0).length;
    salida.push("<h3>" + (fallas === 0 ? "Todo correcto." : fallas + " comprobación(es) fallaron.") + "</h3>");
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
