// ===== Excel parsing with format auto-detection =====
// Supports 3 formats from load_optimizer:
//   1. RH Guerrero (PRAM)    -> columns: PRAM, Última Modificación, Forma
//   2. RH CHU (Práctica)      -> columns: Práctica, Carga, Grado, Dictamen
//   3. LAV Guerrero           -> no OD, calculated from density + Espesor, Ancho, Peso, Diámetro Interno

const STEEL_DENSITY = 7850; // kg/m³

const COLUMN_ALIASES = {
  material: ['Material', 'material', 'MATERIAL', 'Mat'],
  ancho: ['Ancho', 'ancho', 'ANCHO', 'Width'],
  espesor: ['Espesor', 'espesor', 'ESPESOR', 'Thickness'],
  peso: ['Peso', 'peso', 'PESO', 'Weight'],
  largo: ['Largo', 'largo', 'LARGO', 'Length'],
  calibre: ['Calibre', 'calibre', 'CALIBRE'],
  forma: ['Forma', 'forma', 'FORMA'],
  ubicacion: ['Ubicación', 'Ubicacion', 'ubicación', 'UBICACION', 'Location'],
  practica: ['Práctica', 'Practica', 'practica', 'PRACTICA'],
  pram: ['PRAM', 'pram', 'Pram'],
  carga: ['Carga', 'carga', 'CARGA'],
  grado: ['Grado', 'grado', 'GRADO'],
  dictamen: ['Dictamen', 'dictamen', 'DICTAMEN'],
  cliente: ['Cliente', 'cliente', 'CLIENTE', 'Customer'],
  origen: ['Origen', 'origen', 'ORIGEN'],
  antig: ['Antigüedad', 'Antiguedad', 'antigüedad', 'antiguedad', 'ANTIGUEDAD', 'Días', 'Dias'],
  od: ['Diámetro Externo', 'Diametro Externo', 'OD', 'D Externo'],
  id: ['Diámetro Interno', 'Diametro Interno', 'ID', 'D Interno'],
  rutaReal: ['Ruta Real', 'ruta real', 'RUTA REAL'],
  rutaTeorica: ['Ruta Teoríca', 'Ruta Teorica', 'ruta teorica'],
  entrada: ['Entrada', 'entrada', 'ENTRADA'],
  ultimaMod: ['Última Modificación', 'Ultima Modificacion', 'última modificación']
};

function findColumn(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectFormat(headers) {
  const has = name => COLUMN_ALIASES[name].some(a => headers.includes(a));
  if (has('pram')) return 'PRAM';
  if (has('carga') && has('grado') && has('dictamen')) return 'CHU';
  if (!has('od') && has('id') && has('ancho') && has('espesor') && has('peso')) return 'LAV';
  // Generic Ternium format (has Práctica + OD)
  if (has('practica') && has('od')) return 'GENERIC';
  return 'UNKNOWN';
}

function calcODFromDensity(ancho_mm, espesor_mm, peso_kg, id_mm) {
  // Volume = π/4 * (OD² - ID²) * Width
  // OD = √(ID² + (4 * Volume) / (π * Width))
  // Volume = Peso / Density (m³)
  if (!ancho_mm || !espesor_mm || !peso_kg || !id_mm) return 0;
  const volume_m3 = peso_kg / STEEL_DENSITY;
  const volume_mm3 = volume_m3 * 1e9;
  const ancho_m = ancho_mm;
  const od_sq = id_mm * id_mm + (4 * volume_mm3) / (Math.PI * ancho_m);
  return Math.round(Math.sqrt(od_sq));
}

function parseUbicacion(ub) {
  if (!ub) return null;
  const s = String(ub).trim();
  // Format 1: REC##X-x (cuadro 46-54)
  let m = s.match(/^REC(\d+)([A-F])([acs])$/);
  if (m) {
    const fila = parseInt(m[1]);
    if (fila >= 1 && fila <= 200) return { fila, col: m[2], nivel: m[3], auto: false };
  }
  // Format 2: just a number 1-40 (línea)
  m = s.match(/^(\d+)$/);
  if (m) {
    const fila = parseInt(m[1]);
    if (fila >= 1 && fila <= 40) return { fila, col: '_', nivel: null, auto: true };
  }
  // Format 3: just a letter A-G (línea)
  m = s.match(/^[A-G]$/);
  if (m) return { fila: s, col: '_', nivel: null, auto: true };
  // Format 4: REC sin posición, FSH, etc → no se posiciona
  return null;
}

function autoAssignLevels(rolls) {
  // For rolls with auto=true and nivel=null, assign nivel by antiquity (oldest first → A → C → S)
  const groups = {};
  rolls.forEach(r => {
    if (!r.auto || r.nivel) return;
    const k = `${r.fila}${r.col}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  Object.values(groups).forEach(grp => {
    grp.sort((a, b) => b.antig - a.antig);
    grp.forEach((r, i) => {
      r.nivel = ['a', 'c', 's'][i] || 'a';
      if (i >= 3) r.auto_overflow = true;
    });
  });
}

function parseExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (data.length < 2) throw new Error('Excel vacío o sin datos');
  const headers = data[0].map(h => h == null ? '' : String(h));
  const format = detectFormat(headers);

  const colIdx = {};
  Object.keys(COLUMN_ALIASES).forEach(k => { colIdx[k] = findColumn(headers, COLUMN_ALIASES[k]); });

  const rolls = [];
  let unplaced = 0;
  let invalidPractica = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every(c => c == null)) continue;

    const get = (key) => colIdx[key] >= 0 ? row[colIdx[key]] : null;
    const getNum = (key) => { const v = get(key); return v == null || v === '' ? null : Number(v); };
    const getStr = (key) => { const v = get(key); return v == null ? '' : String(v).trim(); };

    const mat = getStr('material');
    if (!mat) continue;

    const ub = parseUbicacion(get('ubicacion'));
    if (!ub) { unplaced++; continue; }

    let practica = getNum('practica');
    if (practica == null || isNaN(practica)) { invalidPractica++; continue; }

    let od = getNum('od');
    const ancho = getNum('ancho') || 0;
    const espesor = getNum('espesor') || 0;
    const peso = getNum('peso') || 0;
    const id_ = getNum('id') || 508;
    if (!od && format === 'LAV') od = calcODFromDensity(ancho, espesor, peso, id_);

    const rutaReal = getStr('rutaReal');
    const lav = rutaReal.toUpperCase().includes('LAV');

    rolls.push({
      mat,
      fila: ub.fila,
      col: ub.col,
      nivel: ub.nivel,
      auto: ub.auto,
      ancho: Math.round(ancho),
      peso: Math.round(peso),
      espesor: espesor,
      largo: Math.round(getNum('largo') || 0),
      calibre: getNum('calibre'),
      od: Math.round(od || 0),
      id_: Math.round(id_),
      practica: Math.round(practica),
      antig: Math.round(getNum('antig') || 0),
      cliente: getStr('cliente').slice(0, 40),
      origen: getStr('origen').slice(0, 20),
      forma: getStr('forma').slice(0, 20),
      rutaReal: rutaReal,
      lav,
      excluded: false
    });
  }

  autoAssignLevels(rolls);

  return {
    rolls,
    format,
    headers,
    stats: {
      total: rolls.length,
      unplaced,
      invalidPractica,
      cuadro: rolls.filter(r => typeof r.fila === 'number' && r.fila >= 46 && r.fila <= 54).length,
      linea: rolls.filter(r => r.col === '_').length
    }
  };
}

window.parseExcel = parseExcel;
