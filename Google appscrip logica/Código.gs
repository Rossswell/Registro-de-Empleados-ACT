// ═══════════════════════════════════════════════════════
//  FLASH HIGH — Google Apps Script Backend v7 (FIXED)
//  ✔ Bloque B (H:Q) independiente del Bloque A (A:F)
//  ✔ Corregido error de variable 'row' no definida
// ═══════════════════════════════════════════════════════

const SHEET_ID = '1O35ZWq2yEAW-5FOJsby2Kszo6WP3_0nqVGp4yd0q4Lk';

const SHEET_EMPLOYEES  = '👤 NOMINA';
const SHEET_SCHEDULES  = '⌛HORARIOS';

// ── Columnas empleados ────────────────────────────────
const EMP_COL_NOMBRE  = 0;
const EMP_COL_CEDULA  = 2;
const EMP_COL_CORREO  = 4;
const EMP_COL_AREA    = 5;

// ══════════════════════════════════════════════════════
//  ENTRY POINT - Soporta GET y POST
// ══════════════════════════════════════════════════════
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var action = e.parameter.action;
  var data = e.parameter;

  if (e.postData && e.postData.contents) {
    try {
      var jsonData = JSON.parse(e.postData.contents);
      data = Object.assign({}, e.parameter, jsonData);
    } catch(err) {}
  }

  var result;
  try {
    switch (action) {
      case 'login':        result = login(data); break;
      case 'getCode':      result = getCodeFromSheet(); break;
      case 'validateCode': result = validateCodeAPI(data); break;
      case 'markTime':     result = markTime(data); break;
      case 'writeLog':     result = writeLog(data); break;
      default:             result = { ok: false, error: 'Acción no válida' };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCodeFromSheet() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SCHEDULES);
  const code = sheet.getRange('S2').getValue();
  return { ok: true, code: String(code) };
}

function validateCode(code) {
  if (!code) return false;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SCHEDULES);
  const currentCode = String(sheet.getRange('S2').getValue()).trim();
  return String(code).trim() === currentCode;
}

function validateCodeAPI(e) {
  const inputCode = String(e.code || '').trim();
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SCHEDULES);
  const currentCode = String(sheet.getRange('S2').getValue()).trim();
  return { ok: true, valid: inputCode === currentCode };
}

function login(p) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_EMPLOYEES);
  var data = sheet.getDataRange().getValues();
  var correo = String(p.correo || '').toLowerCase().trim();
  var cedula = String(p.cedula || '').trim();

  for (var i = 2; i < data.length; i++) {
    if (
      String(data[i][EMP_COL_CORREO]).toLowerCase().trim() === correo &&
      String(data[i][EMP_COL_CEDULA]).trim() === cedula
    ) {
      return { ok: true, employee: { name: data[i][EMP_COL_NOMBRE], cedula: cedula } };
    }
  }
  return { ok: false, error: 'Credenciales incorrectas' };
}

function markTime(p) {
  if (!validateCode(p.code)) return { ok: false, error: 'Código inválido' };
  return writeLog(p);
}

// ══════════════════════════════════════════════════════
//  WRITE LOG - Escribe en el bloque B (columna H)
// ══════════════════════════════════════════════════════
function writeLog(p) {
  const { fecha, empleado, cedula, area, tipo, hora, estado, minTarde, mensaje } = p;
  if (!cedula || !tipo) return { ok: false, error: 'Faltan datos' };

  let nombre = empleado || '';
  let empArea = area || '';

  if (!nombre || !empArea) {
    const empSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_EMPLOYEES);
    const empData = empSheet.getDataRange().getValues();
    for (let i = 2; i < empData.length; i++) {
      if (String(empData[i][EMP_COL_CEDULA]).trim() === cedula) {
        if (!nombre) nombre = empData[i][EMP_COL_NOMBRE];
        if (!empArea) empArea = empData[i][EMP_COL_AREA] || '';
        break;
      }
    }
  }

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SCHEDULES);
  
  // ── FIX: Buscar la última fila ocupada SOLO en la columna H (Bloque B) ──
  const colHValues = sheet.getRange("H:H").getValues();
  let lastRowB = 0;
  for (let i = colHValues.length - 1; i >= 0; i--) {
    if (colHValues[i][0] !== "") {
      lastRowB = i + 1;
      break;
    }
  }
  if (lastRowB === 0) lastRowB = 1;

  const rowEstado = (estado || '').toLowerCase();
  const labelEstado = rowEstado === 'tarde'      ? 'SÍ'
                    : rowEstado === 'tolerancia' ? 'TOLERANCIA'
                    : rowEstado === 'anticipada' ? 'ANTICIPADA'
                    : rowEstado === 'salida'     ? 'SALIDA NORMAL'
                    : 'NO';

  const semana = getSemana(new Date());
  const fechaHoy = fecha || Utilities.formatDate(new Date(), "GMT-4", "dd/MM/yyyy");
  const horaHoy = hora || Utilities.formatDate(new Date(), "GMT-4", "HH:mm:ss");

  // ── FIX: Definir el array 'row' correctamente ──
  // H=Fecha | I=Semana | J=Empleado | K=Cedula | L=Area | M=Tipo | N=Hora | O=Tarde | P=Min Tarde | Q=Mensaje
  const row = [
    fechaHoy,
    String(semana),
    nombre,
    String(cedula),
    empArea,
    String(tipo).toUpperCase(),
    horaHoy,
    labelEstado,
    String(minTarde || 0),
    mensaje || ''
  ];

  // ── FIX: Escribir SOLO en el rango H:Q de la fila siguiente ──
  // Esto evita tocar las columnas A:F (Bloque A)
  sheet.getRange(lastRowB + 1, 8, 1, 10).setValues([row]);

  return { ok: true, row: lastRowB + 1 };
}

function getSemana(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
