// ===== Excel exporter =====
// Mirrors the load_optimizer_app.py output: hojas Resumen / Detalle / Parámetros

function exportConfirmedToExcel(confirmed, params, filename) {
  if (confirmed.length === 0) { alert('No hay cargas confirmadas para exportar.'); return; }
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen
  const resumenRows = [
    ['Carga', 'Práctica', 'LAV', '# Rollos', 'Peso (kg)', 'Peso (t)', 'Altura (mm)',
     '% Altura', '% Peso', 'Bloqueos', 'Traslados', 'Costo grúa',
     'Estibas', 'Score', 'Estrategia', 'λ']
  ];
  confirmed.forEach((c, i) => {
    resumenRows.push([
      `C${i + 1}`,
      c.practica,
      c.lav ? 'LAV' : 'NO-LAV',
      c.f.n,
      c.f.w,
      +(c.f.w / 1000).toFixed(2),
      c.f.h,
      +(c.hEff * 100).toFixed(1),
      +(c.wEff * 100).toFixed(1),
      c.cc.blocking,
      c.cc.traversals,
      c.cc.total,
      c.f.stacks.map(s => s.replace('_', '')).join('; '),
      +(c.phys - c.lambda * c.cc.total / 10).toFixed(4),
      c.strategy,
      c.lambda
    ]);
  });
  const totalRollos = confirmed.reduce((s, c) => s + c.f.n, 0);
  const totalPeso = confirmed.reduce((s, c) => s + c.f.w, 0);
  const totalCrane = confirmed.reduce((s, c) => s + c.cc.total, 0);
  resumenRows.push([]);
  resumenRows.push(['TOTAL', '', '', totalRollos, totalPeso, +(totalPeso / 1000).toFixed(2), '', '', '', '', '', totalCrane, '', '', '', '']);

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  wsResumen['!cols'] = [{wch:7},{wch:9},{wch:8},{wch:9},{wch:11},{wch:9},{wch:11},{wch:9},{wch:9},{wch:9},{wch:9},{wch:10},{wch:18},{wch:9},{wch:13},{wch:6}];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // Hoja 2: Detalle
  const detalleRows = [
    ['Carga', 'Pos', 'Material', 'Origen', 'Estiba', 'Nivel', 'Ancho (mm)',
     'Peso (kg)', 'Espesor (mm)', 'Largo (mm)', 'OD (mm)', 'ID (mm)',
     'Calibre', 'Práctica', 'Antigüedad (d)', 'Cliente', 'Ruta', 'LAV', 'Forma', 'Costo grúa rollo']
  ];
  confirmed.forEach((c, i) => {
    const ordered = [...c.rolls].sort((a, b) => b.ancho - a.ancho);
    ordered.forEach((r, k) => {
      const pn = ordered.length - k;
      const craneRoll = { s: 0, c: 1, a: 2 }[r.nivel];
      const estiba = r.col === '_' ? `${r.fila}` : `${r.fila}${r.col}`;
      detalleRows.push([
        `C${i + 1}`,
        `P${pn}`,
        r.mat,
        r.origen || '',
        estiba,
        r.nivel.toUpperCase() + (r.auto ? '*' : ''),
        r.ancho, r.peso, r.espesor, r.largo, r.od, r.id_,
        r.calibre || '', r.practica, r.antig, r.cliente, r.rutaReal || '',
        r.lav ? 'SI' : 'NO', r.forma, craneRoll
      ]);
    });
  });
  const wsDetalle = XLSX.utils.aoa_to_sheet(detalleRows);
  wsDetalle['!cols'] = [{wch:7},{wch:5},{wch:16},{wch:14},{wch:8},{wch:7},{wch:10},{wch:10},{wch:11},{wch:10},{wch:8},{wch:8},{wch:8},{wch:9},{wch:13},{wch:30},{wch:14},{wch:5},{wch:14},{wch:13}];
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle');

  // Hoja 3: Parámetros
  const paramsRows = [
    ['Parámetro', 'Valor'],
    ['Fecha generación', new Date().toLocaleString()],
    ['Archivo origen', params.sourceFile || ''],
    ['Formato detectado', params.format || ''],
    ['Estrategia última', params.strategy || ''],
    ['Modo última', params.mode || ''],
    ['λ (peso grúa)', params.lambda],
    ['', ''],
    ['Restricciones aplicadas', ''],
    ['Altura máxima (mm)', optimizer.CONSTRAINTS.H_MAX],
    ['Peso máximo (kg)', optimizer.CONSTRAINTS.W_MAX],
    ['Rollos máx por carga', optimizer.CONSTRAINTS.N_MAX],
    ['Rollos mín por carga', optimizer.CONSTRAINTS.N_MIN],
    ['Spacer entre rollos (mm)', optimizer.CONSTRAINTS.SPACER],
    ['Calibre máx en P1', optimizer.CONSTRAINTS.CAL_P1_MAX],
    ['Misma práctica', 'SÍ'],
    ['Misma ruta (LAV/no-LAV)', params.enforceLAV ? 'SÍ' : 'NO'],
    ['Calibre P1 enforced', params.enforceCalibreP1 ? 'SÍ' : 'NO'],
    ['', ''],
    ['Resumen de salida', ''],
    ['Total de cargas', confirmed.length],
    ['Total rollos cargados', totalRollos],
    ['Peso total (t)', +(totalPeso / 1000).toFixed(2)],
    ['Costo total grúa', totalCrane],
    ['', ''],
    ['Modelo de costo de grúa', ''],
    ['Costo por nivel S (Superior)', 0],
    ['Costo por nivel C (Centro)', 1],
    ['Costo por nivel A (Abajo)', 2],
    ['Costo por traslado entre estibas', 1],
    ['', ''],
    ['Estrategias disponibles', ''],
    ['best', '0.45·h + 0.45·w + 0.10·(n/5) − λ·grúa/10'],
    ['altura', 'h − λ·grúa/10'],
    ['peso', 'w − λ·grúa/10'],
    ['balanceada', '(h+w)/2 − λ·grúa/10'],
    ['antiguedad', '0.25·(h+w) + 0.5·antig/30 − λ·grúa/10']
  ];
  const wsParams = XLSX.utils.aoa_to_sheet(paramsRows);
  wsParams['!cols'] = [{wch:30},{wch:45}];
  XLSX.utils.book_append_sheet(wb, wsParams, 'Parámetros');

  // Hoja 4: Cargas no asignadas (rollos no cargados)
  // We don't have direct access to remaining pool here; that's left to the caller via params.remaining
  if (params.remaining && params.remaining.length > 0) {
    const remRows = [
      ['Material', 'Estiba', 'Nivel', 'Ancho (mm)', 'Peso (kg)', 'Espesor (mm)',
       'OD (mm)', 'Práctica', 'Antigüedad (d)', 'LAV', 'Cliente', 'Excluido']
    ];
    params.remaining.forEach(r => {
      const estiba = r.col === '_' ? `${r.fila}` : `${r.fila}${r.col}`;
      remRows.push([r.mat, estiba, r.nivel ? r.nivel.toUpperCase() : '', r.ancho, r.peso, r.espesor,
        r.od, r.practica, r.antig, r.lav ? 'SI' : 'NO', r.cliente, r.excluded ? 'SI' : 'NO']);
    });
    const wsRem = XLSX.utils.aoa_to_sheet(remRows);
    wsRem['!cols'] = [{wch:16},{wch:8},{wch:6},{wch:10},{wch:10},{wch:11},{wch:8},{wch:9},{wch:13},{wch:5},{wch:30},{wch:9}];
    XLSX.utils.book_append_sheet(wb, wsRem, 'No asignados');
  }

  const fname = filename || `cargas_optimizadas_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

window.exportConfirmedToExcel = exportConfirmedToExcel;
