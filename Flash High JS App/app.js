// ════════════════════════════════════════════════════
//  Flash High Admin — app.js
// ════════════════════════════════════════════════════

const { SUPABASE_URL, SUPABASE_KEY, SPREADSHEET_ID, SHEET_NAME, SHEET_EMP_NAME } = window.FH_CONFIG

// ── Supabase client ────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Window controls ────────────────────────────────
function winAction(action) {
  if (window.electronAPI) {
    if (action === 'minimize') window.electronAPI.minimize()
    if (action === 'maximize') window.electronAPI.maximize()
    if (action === 'close')    window.electronAPI.close()
  }
}

// ── State ──────────────────────────────────────────
const DAYS_LIST    = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
const DEFAULT_ACTIVE = new Set(['Lun','Mar','Mié','Jue','Vie'])
const MONTHS_ES    = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function defaultDaySchedule(day) {
  return { active: DEFAULT_ACTIVE.has(day), eh:8, em:30, sh:17, sm:30 }
}

const state = {
  employees:  [],
  logs:       [],
  schedules:  [],
  calView:    { year: new Date().getFullYear(), month: new Date().getMonth() },
  calViewMode:'day',
  calTimes:   { fh:9, fm:0, th:10, tm:0 },
  calSel:     null,
  reportData: [],
  charts:     {},
  schDays:    Object.fromEntries(DAYS_LIST.map(d => [d, defaultDaySchedule(d)])),
}

// ════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════
async function init() {
  const days   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre']
  const now = new Date()
  const el = document.getElementById('dash-date')
  if (el) el.textContent =
    `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`

  // WiFi detection
  const wifiAlert = document.getElementById('wifi-alert')
  const updateWifi = () => {
    if (wifiAlert) wifiAlert.style.display = navigator.onLine ? 'none' : 'flex'
  }
  window.addEventListener('online',  () => { updateWifi(); toast('Conexión restaurada ✓','success') })
  window.addEventListener('offline', () => { updateWifi(); toast('Sin conexión a internet','error') })
  updateWifi()

  // Connect Supabase
  try {
    const { error } = await sb.from('employees').select('id').limit(1)
    if (error) throw error
    setConnected(true)
    await loadAll()
    // Start bidirectional sync: if deleted from Sheets, delete from Supabase too
    startSheetsToSupabaseSync()
  } catch(e) {
    setConnected(false)
    toast('Error Supabase: ' + e.message, 'error')
  }
}

function setConnected(ok) {
  const dot = document.getElementById('conn-dot')
  const txt = document.getElementById('conn-text')
  if (dot) dot.className = 'conn-dot ' + (ok ? 'connected' : 'error')
  if (txt) txt.textContent = ok ? '● Conectado' : '● Sin conexión'
}

async function loadAll() {
  try {
    const [emps, rawLogs, scheds] = await Promise.all([
      sb.from('employees').select('*').order('nombre'),
      sb.from('logs').select('*').order('timestamp', { ascending: false }),
      sb.from('schedules').select('*, employees(nombre)'),
    ])
    state.employees = emps.data || []
    state.schedules = scheds.data || []

    // Enrich logs with employee data (replaces v_logs_detail view)
    const empMap = {}
    state.employees.forEach(e => {
      empMap[e.id] = e
    })
    state.logs = (rawLogs.data || []).map(l => {
      const emp = empMap[l.employee_id] || {}
      return {
        ...l,
        nombre_empleado: emp.nombre ? `${emp.nombre} ${emp.apellido||''}`.trim() : '—',
        cedula: emp.cedula || l.cedula || '',
        area:   emp.area   || l.area   || '',
        rol:    emp.rol    || l.rol    || '',
        hora:   l.timestamp || '',
      }
    })

    renderDashboard()
    renderEmployees()
    renderSchedules()
    renderLogs()
    populateSelects()
  } catch(e) {
    toast('Error cargando datos: ' + e.message, 'error')
  }
}

// ════════════════════════════════════════════════════
//  SHEETS → SUPABASE SYNC (eliminación desde Sheets)
//  Cada 60s lee los empleados en Sheets y elimina de Supabase
//  los que ya no estén en la hoja
// ════════════════════════════════════════════════════
let _sheetSyncRunning = false
async function startSheetsToSupabaseSync() {
  const syncNow = async () => {
    if (_sheetSyncRunning) return
    _sheetSyncRunning = true
    try {
      const token = await getGoogleToken()
      if (!token) return

      const SHEET_ID = window.FH_CONFIG.SPREADSHEET_ID
      const SNAME    = window.FH_CONFIG.SHEET_EMP_NAME || '👤 NOMINA'

      // Read employee cedulas from Sheets (col B = cédula, starting row 2)
      const rangeEnc = encodeURIComponent(`'${SNAME}'!B:B`)
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${rangeEnc}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      const sheetCedulas = new Set(
        (data.values || []).flat()
          .map(v => String(v||'').trim())
          .filter(v => v && /^\d+$/.test(v))
      )

      if (sheetCedulas.size === 0) return // safety: don't delete all if sheet is empty/unreadable

      // Find employees in Supabase that are NOT in Sheets anymore
      const toDelete = state.employees.filter(e => {
        const ced = String(e.cedula||'').trim()
        return ced && !sheetCedulas.has(ced)
      })

      for (const emp of toDelete) {
        console.log('[SheetSync] Deleting from Supabase (not in Sheets):', emp.nombre, emp.cedula)
        try {
          await sb.from('employees').delete().eq('id', emp.id)
        } catch(e) { console.warn('Delete from Supabase failed:', e.message) }
      }

      if (toDelete.length > 0) {
        await loadAll()
        try { await syncHorariosBlock() } catch(e) {}
        toast(`${toDelete.length} empleado(s) eliminado(s) desde Google Sheets`, 'warning')
      }
    } catch(e) {
      console.warn('[SheetSync]', e.message)
    } finally {
      _sheetSyncRunning = false
    }
  }

  // Run immediately and then every 60 seconds
  await syncNow()
  setInterval(syncNow, 60000)
}

// ════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════
function nav(page, el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  el.classList.add('active')
  const pg = document.getElementById('page-' + page)
  if (!pg) return
  pg.classList.add('active')
  pg.style.animation = 'none'
  pg.offsetHeight
  pg.style.animation = ''
  closeCal()
  // Trigger count animation when entering dashboard
  if (page === 'dashboard') {
    setTimeout(animateDashboardStats, 80)
  }
}

// ════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════
function renderDashboard() {
  const _now = new Date(); const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`
  const logsToday   = state.logs.filter(l => { const d=new Date(l.timestamp); const ld=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return ld===today })
  const entradas    = logsToday.filter(l => l.tipo === 'entrada')
  const puntuales   = entradas.filter(l => ['puntual','tolerancia'].includes(l.estado))
  const tardes      = entradas.filter(l => l.estado === 'tarde')

  animateCount('s-emps',    state.employees.length)
  animateCount('s-today',   entradas.length)
  animateCount('s-puntual', puntuales.length)
  animateCount('s-tardes',  tardes.length)
  animateCount('s-total',   state.logs.length)

  const tbody = document.getElementById('today-tbody')
  if (tbody) tbody.innerHTML = logsToday.slice(0,30).map(l => `
    <tr>
      <td>${l.nombre_empleado||'—'}</td>
      <td><span class="badge badge-${l.tipo}">${(l.tipo||'').toUpperCase()}</span></td>
      <td>${(l.hora||l.timestamp||'').slice(11,16)||'—'}</td>
      <td>${l.estado?`<span class="badge badge-${l.estado}">${l.estado.toUpperCase()}</span>`:'—'}</td>
      <td style="color:var(--text2);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.mensaje||'—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sin fichajes hoy</td></tr>'

  renderCharts()
}

// Animate a stat counter from 0 to target with easeOutExpo
function animateCount(id, target, fromZero = false) {
  const el = document.getElementById(id)
  if (!el) return
  const start = fromZero ? 0 : (parseInt(el.textContent) || 0)
  if (start === target) return
  const diff     = target - start
  const steps    = 35
  const duration = 700 // ms
  const stepMs   = duration / steps
  let i = 0
  if (el._countTimer) clearInterval(el._countTimer)
  el._countTimer = setInterval(() => {
    i++
    // easeOutExpo
    const t = i / steps
    const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
    el.textContent = Math.round(start + diff * ease)
    if (i >= steps) {
      el.textContent = target
      clearInterval(el._countTimer)
      el._countTimer = null
    }
  }, stepMs)
}

// Call this when entering the dashboard tab to reset counters to 0 before animating
function animateDashboardStats() {
  ;['s-emps','s-today','s-puntual','s-tardes','s-total'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.textContent = '0'
  })
  const _n2 = new Date(); const today = `${_n2.getFullYear()}-${String(_n2.getMonth()+1).padStart(2,'0')}-${String(_n2.getDate()).padStart(2,'0')}`
  const logsToday  = state.logs.filter(l => { const d=new Date(l.timestamp); const ld=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return ld===today })
  const entradas   = logsToday.filter(l => l.tipo === 'entrada')
  const puntuales  = entradas.filter(l => ['puntual','tolerancia'].includes(l.estado))
  const tardes     = entradas.filter(l => l.estado === 'tarde')
  animateCount('s-emps',    state.employees.length, true)
  animateCount('s-today',   entradas.length,         true)
  animateCount('s-puntual', puntuales.length,         true)
  animateCount('s-tardes',  tardes.length,            true)
  animateCount('s-total',   state.logs.length,        true)
}

function renderCharts() {
  const allEntradas = state.logs.filter(l => l.tipo === 'entrada')

  // Weekly
  const weekCounts = {}
  const today = new Date()
  const weekKeys = []
  for (let w = 11; w >= 0; w--) {
    const d = new Date(today); d.setDate(d.getDate() - w * 7)
    const key = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,'0')}`
    if (!weekKeys.includes(key)) weekKeys.push(key)
    weekCounts[key] = 0
  }
  allEntradas.forEach(l => {
    if (!l.timestamp) return
    const d = new Date(l.timestamp)
    const key = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,'0')}`
    if (key in weekCounts) weekCounts[key]++
  })

  destroyChart('chart-weekly')
  const ctx1 = document.getElementById('chart-weekly')
  if (ctx1) {
    state.charts['chart-weekly'] = new Chart(ctx1.getContext('2d'), {
      type: 'bar',
      data: {
        labels: weekKeys.map(k => String(parseInt(k.split('-W')[1]))),
        datasets: [{ data: weekKeys.map(k => weekCounts[k]),
          backgroundColor:'rgba(124,58,237,0.7)', hoverBackgroundColor:'#7c3aed',
          borderRadius:6, borderSkipped:false }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        animation:{ duration:600, easing:'easeOutQuart' },
        plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#1a1a1e',
          borderColor:'#2a2a35', borderWidth:1, titleColor:'#f1f1f3', bodyColor:'#9898aa' }},
        scales:{
          x:{grid:{color:'rgba(42,42,53,0.8)'},ticks:{color:'#606070',font:{size:10}}},
          y:{grid:{color:'rgba(42,42,53,0.8)'},ticks:{color:'#606070',font:{size:10},stepSize:1},beginAtZero:true}
        }
      }
    })
  }

  // States donut
  const sc = { puntual:0, tolerancia:0, tarde:0 }
  allEntradas.forEach(l => { if (l.estado in sc) sc[l.estado]++ })
  const slabels = Object.keys(sc).filter(k => sc[k]>0)
  const scolors = { puntual:'#22c55e', tolerancia:'#f59e0b', tarde:'#ef4444' }

  destroyChart('chart-states')
  const ctx2 = document.getElementById('chart-states')
  if (ctx2) {
    state.charts['chart-states'] = new Chart(ctx2.getContext('2d'), {
      type:'doughnut',
      data:{ labels: slabels.map(l=>l.toUpperCase()),
        datasets:[{ data:slabels.map(k=>sc[k]),
          backgroundColor:slabels.map(k=>scolors[k]+'cc'),
          hoverBackgroundColor:slabels.map(k=>scolors[k]),
          borderColor:'#1a1a1e', borderWidth:2 }]},
      options:{ responsive:true, maintainAspectRatio:false, cutout:'68%',
        animation:{duration:600, animateRotate:true},
        plugins:{ legend:{ position:'bottom', labels:{color:'#9898aa',font:{size:10},padding:12,boxWidth:10}},
          tooltip:{backgroundColor:'#1a1a1e',borderColor:'#2a2a35',borderWidth:1,titleColor:'#f1f1f3',bodyColor:'#9898aa'} }}
    })
  }

  // Hours bar
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30)
  const recent = state.logs.filter(l=>(l.timestamp||'').slice(0,10)>=cutoff.toISOString().slice(0,10))
  const pairs  = {}
  recent.sort((a,b)=>a.timestamp>b.timestamp?1:-1).forEach(l=>{
    const key=(l.nombre_empleado||'')+'|'+(l.timestamp||'').slice(0,10)
    if(!pairs[key]) pairs[key]={}
    if(l.tipo==='entrada'&&!pairs[key].in)  pairs[key].in=l.timestamp
    if(l.tipo==='salida')  pairs[key].out=l.timestamp
  })
  const hoursMap={}
  Object.entries(pairs).forEach(([key,p])=>{
    if(!p.in||!p.out) return
    const h=(new Date(p.out)-new Date(p.in))/3600000
    if(h>0&&h<16){
      const name=p.in?state.logs.find(l=>l.timestamp===p.in)?.nombre_empleado:''
      if(name) hoursMap[name]=(hoursMap[name]||0)+h
    }
  })
  const hNames=Object.keys(hoursMap)
  const hVals=hNames.map(n=>Math.round(hoursMap[n]*10)/10)

  destroyChart('chart-hours')
  const ctx3 = document.getElementById('chart-hours')
  if (ctx3) {
    state.charts['chart-hours'] = new Chart(ctx3.getContext('2d'), {
      type:'bar',
      data:{ labels:hNames.map(n=>n.split(' ')[0]),
        datasets:[{data:hVals,backgroundColor:'rgba(124,58,237,0.7)',
          hoverBackgroundColor:'#7c3aed',borderRadius:5,borderSkipped:false}]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
        animation:{duration:600,easing:'easeOutQuart'},
        plugins:{legend:{display:false},
          tooltip:{backgroundColor:'#1a1a1e',borderColor:'#2a2a35',borderWidth:1,
            titleColor:'#f1f1f3',bodyColor:'#9898aa',
            callbacks:{label:ctx=>`  ${ctx.parsed.x}h trabajadas`}}},
        scales:{
          x:{grid:{color:'rgba(42,42,53,0.8)'},ticks:{color:'#606070',font:{size:10}},beginAtZero:true},
          y:{grid:{display:false},ticks:{color:'#9898aa',font:{size:11}}}
        }
      }
    })
  }
}

function destroyChart(id) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id] }
}

function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1))
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
}

// ════════════════════════════════════════════════════
//  EMPLOYEES
// ════════════════════════════════════════════════════
function renderEmployees() {
  const tbody = document.getElementById('emp-tbody')
  if (!tbody) return
  tbody.innerHTML = state.employees.map(e => `
    <tr>
      <td style="font-weight:500">${e.nombre||''} ${e.apellido||''}</td>
      <td style="font-family:var(--mono);font-size:12px">${e.cedula||''}</td>
      <td style="color:var(--text2)">${e.telefono||'—'}</td>
      <td style="color:var(--text2)">${e.correo||''}</td>
      <td><span class="badge" style="background:rgba(124,58,237,0.1);color:var(--accent2)">${e.area||'Empleado'}</span></td>
      <td style="color:var(--text2);font-size:11px">${e.inicio||'—'}</td>
      <td style="color:var(--text2);font-size:11px">${e.cumpleanos||'—'}</td>
      <td>
        <button class="btn btn-danger" style="padding:5px 12px;font-size:11px"
          onclick="deleteEmployee('${e.id}','${e.nombre} ${e.apellido||''}')">
          Eliminar
        </button>
      </td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-state">Sin empleados</td></tr>'
}

async function addEmployee() {
  const f = v => document.getElementById(v)?.value.trim() || ''
  const nombre   = f('e-nombre')
  const cedula   = f('e-cedula')
  const telefonoRaw = f('e-telefono').replace(/^\+?58/,'')
  const telefono = telefonoRaw ? '+58' + telefonoRaw : ''
  const correo    = f('e-email')
  const area     = f('e-area')
  const inicio   = f('e-inicio')
  const cumple   = f('e-cumple')

  if (!nombre || !correo || !cedula) {
    toast('Nombre completo, correo y cédula son obligatorios','warning'); return
  }

  try {
    // 1. Supabase
    const record = {
      nombre,
      correo,
      cedula,
      area:       area     || 'Empleado',
      telefono:   telefono || null,
      inicio:     inicio   || null,
      cumpleanos: cumple   || null,
    }

    const { error } = await sb.from('employees').insert(record)
    if (error) throw error

    // 2. Google Sheets
    try {
      await appendEmployeeToSheet({ nombre, cedula, telefono, correo, area, inicio, cumple })
    } catch(sheetErr) {
      console.warn('Sheet sync:', sheetErr.message)
      toast('Guardado en Supabase. Error en Sheets: ' + sheetErr.message, 'warning')
    }

    // 3. Cerrar calendarios y limpiar listeners
    ['inicio', 'cumple'].forEach(field => {
      const el = document.getElementById('mini-cal-'+field)
      if(el) el.classList.remove('open')
    })
    if(miniCalState.handler) {
      document.removeEventListener('click', miniCalState.handler)
      miniCalState.handler = null
    }

    // 4. Reset form
    ;['e-nombre','e-cedula','e-telefono','e-email','e-area'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = ''
    })
    setMiniCalValue('inicio', null)
    setMiniCalValue('cumple', null)

    await loadAll()
    toast(`${nombre} añadido ✓`, 'success')
  } catch(e) { toast('Error: ' + e.message, 'error') }
}

async function deleteEmployee(id, name) {
  // Cerrar calendarios abiertos y listeners pendientes
  ['inicio', 'cumple'].forEach(field => {
    const el = document.getElementById('mini-cal-'+field)
    if(el) el.classList.remove('open')
    if(miniCalState.handler) {
      document.removeEventListener('click', miniCalState.handler)
      miniCalState.handler = null
    }
  })

  if (!confirm(`¿Eliminar a ${name}? Se borrarán todos sus registros.`)) return
  try {
    // 1. Supabase
    const { error } = await sb.from('employees').delete().eq('id', id)
    if (error) throw error

    // 2. Google Sheets
    const emp = state.employees.find(e => e.id === id)
    if (emp) {
      try { await deleteEmployeeFromSheet(emp) }
      catch(sheetErr) { console.warn('Sheet delete:', sheetErr.message) }
    }

    await loadAll()
    // Sync sheets after deletion (refresh both blocks)
    try { await syncHorariosBlock() } catch(e2) { console.warn('Sync A after delete:', e2.message) }
    toast(`${name} eliminado ✓`, 'success')
  } catch(e) { toast('Error: ' + e.message, 'error') }
}

// ════════════════════════════════════════════════════
//  GOOGLE SHEETS — empleados
// ════════════════════════════════════════════════════
async function appendEmployeeToSheet(emp) {
  const SHEET_ID = window.FH_CONFIG.SPREADSHEET_ID
  const SNAME    = window.FH_CONFIG.SHEET_EMP_NAME || '👤 NOMINA'

  const fullName = `${emp.nombre} ${emp.apellido||''}`.trim()

  // Formato dd/mm/yyyy para fechas
  const fmtDate = v => {
    if (!v) return ''
    const [y,m,d] = v.split('-')
    return y && m && d ? `${d}/${m}/${y}` : v
  }

  // A=Nombre | B=Cedula | C=Telefono | D=Correo | E=Area | F=Inicio | G=Cumpleaños
  const row = [
    fullName,
    emp.cedula   || '',
    emp.telefono || '',
    emp.correo   || '',
    emp.area     || '',
    fmtDate(emp.inicio),
    fmtDate(emp.cumple),
  ]

  const token = await getGoogleToken()
  if (!token) { console.warn('No Google token'); return }

  const range = encodeURIComponent(`'${SNAME}'!A:G`)
  // RAW para no heredar formato de celdas vecinas
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  })
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`)
}

async function deleteEmployeeFromSheet(emp) {
  const SHEET_ID = window.FH_CONFIG.SPREADSHEET_ID
  const SNAME    = window.FH_CONFIG.SHEET_EMP_NAME || '👤 NOMINA'
  const token    = await getGoogleToken()
  if (!token) throw new Error('No Google token')

  const fullName = `${emp.nombre} ${emp.apellido||''}`.trim()

  // 1. Read rows to find matching row index
  const rangeEnc = encodeURIComponent(`'${SNAME}'!A:G`)
  const readRes  = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${rangeEnc}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!readRes.ok) throw new Error('No se pudo leer Sheets: ' + readRes.status)
  const readData = await readRes.json()
  const rows     = readData.values || []

  const rowIndex = rows.findIndex(r =>
    (r[0]||'').trim() === fullName && (r[1]||'').trim() === (emp.cedula||'').trim()
  )
  if (rowIndex < 0) return // not found, skip silently

  // 2. Get sheet numeric id
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const metaData  = await metaRes.json()
  const sheetObj  = metaData.sheets?.find(s => s.properties.title === SNAME)
  if (!sheetObj) throw new Error('Hoja no encontrada en metadata')
  const sheetId   = sheetObj.properties.sheetId

  // 3. Delete row
  const delRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ deleteDimension: {
        range: { sheetId, dimension:'ROWS', startIndex: rowIndex, endIndex: rowIndex+1 }
      }}]})
    }
  )
  if (!delRes.ok) throw new Error('Error batchUpdate: ' + await delRes.text())
}

// ════════════════════════════════════════════════════
//  GOOGLE TOKEN (JWT service account)
// ════════════════════════════════════════════════════
let _tok = null, _tokExp = 0
async function getGoogleToken() {
  if (_tok && Date.now() < _tokExp - 60000) return _tok
  try {
    const { client_email, private_key } = window.FH_CONFIG.GOOGLE_CREDENTIALS
    const now = Math.floor(Date.now()/1000)
    const payload = { iss:client_email, scope:'https://www.googleapis.com/auth/spreadsheets',
      aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now }
    const jwt = await makeJWT(payload, private_key)
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    })
    const data = await res.json()
    if (data.access_token) {
      _tok = data.access_token
      _tokExp = Date.now() + data.expires_in * 1000
      return _tok
    }
    throw new Error(data.error_description||'Token error')
  } catch(e) { console.warn('Google token:', e.message); return null }
}

async function makeJWT(payload, pemKey) {
  const header  = { alg:'RS256', typ:'JWT' }
  const b64 = o => btoa(JSON.stringify(o)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
  const signing = `${b64(header)}.${b64(payload)}`
  const pem     = pemKey.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')
  const keyData = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signing))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
  return `${signing}.${sig}`
}

// ════════════════════════════════════════════════════
//  SCHEDULES
// ════════════════════════════════════════════════════
function renderSchedules() {
  const tbody = document.getElementById('sch-tbody')
  if (tbody) tbody.innerHTML = state.schedules.map(s => {
    const emp = s.employees || {}
    let diasList = s.dias || []
    let displayDias = formatDaysList(s.dias)
    return `<tr>
      <td style="font-weight:500">${emp.nombre||''} ${emp.apellido||''}</td>
      <td style="color:var(--text2);font-size:10px">${displayDias}</td>
      <td style="font-family:var(--mono)">${(s.hora_entrada||'').slice(0,5)}</td>
      <td style="font-family:var(--mono)">${(s.hora_salida||'').slice(0,5)}</td>
      <td>${s.tolerancia_min} min</td>
      <td style="color:var(--muted)">${(s.updated_at||'').slice(0,10)}</td>
      <td>
        <button class="btn btn-ghost" onclick="editSchedule('${s.employee_id}')" style="padding:4px 8px;font-size:11px;color:var(--text)">✏️ Editar</button>
      </td>
    </tr>`
  }).join('') || '<tr><td colspan="7" class="empty-state">Sin horarios asignados</td></tr>'

  const fl = state.logs.filter(l => l.tipo === 'libre')
  const ftbody = document.getElementById('fl-tbody')
  if (ftbody) ftbody.innerHTML = fl.map(l => {
    const msg = l.mensaje || ''
    let desde = (l.timestamp||'').slice(11,16) || '—'
    let hasta = '—'
    let tipoBadge = '<span class="badge" style="background:rgba(245,158,11,0.1);color:var(--warning)">⏱ Horas libres</span>'

    if (msg.includes('DÍA LIBRE')) {
      tipoBadge = '<span class="badge" style="background:rgba(56,189,248,0.1);color:var(--info)">📅 Día libre</span>'
      desde = '—'
    } else if (msg.includes('HORA LIBRE')) {
      try {
        const inner = msg.split('HORA LIBRE')[1]?.trim() || ''
        const timeRange = inner.split(':')[0]?.trim() + ':' + inner.split(':')[1]?.trim().split(' ')[0]
        const parts = timeRange.split('-')
        desde = parts[0]?.trim() || desde
        hasta = parts[1]?.trim().slice(0,5) || '—'
      } catch{}
    }
    const motivo = msg.includes(': ') ? msg.split(': ').slice(1).join(': ') : msg
    return `<tr>
      <td>${l.nombre_empleado||'—'}</td>
      <td>${tipoBadge}</td>
      <td>${(l.timestamp||'').slice(0,10)}</td>
      <td style="font-family:var(--mono)">${desde}</td>
      <td style="font-family:var(--mono)">${hasta}</td>
      <td style="color:var(--text2)">${motivo}</td>
    </tr>`
  }).join('') || '<tr><td colspan="6" class="empty-state">Sin permisos registrados</td></tr>'
}

window.editSchedule = function(empId) {
  const sel = document.getElementById('sch-emp')
  if (sel) sel.value = empId
  
  const emp = state.employees.find(e => e.id === empId)
  if (!emp) return
  
  // Update Modal Title
  const t = document.getElementById('sch-pick-title')
  const sSub = document.getElementById('sch-pick-subtitle')
  if (t) t.textContent = `Horario: ${emp.nombre} ${emp.apellido||''}`
  if (sSub) sSub.textContent = 'Configura los turnos específicos para este empleado'

  const s = state.schedules.find(s => s.employee_id === empId)
  if (s) {
    document.getElementById('sch-tol').value = s.tolerancia_min
    DAYS_LIST.forEach(d => {
      let dayCfg = (s.dias||[]).find(item => (typeof item === 'object' ? item.day === d : item === d))
      if (dayCfg) {
        state.schDays[d].active = true
        if (typeof dayCfg === 'object') {
          state.schDays[d].eh = dayCfg.eh; state.schDays[d].em = dayCfg.em;
          state.schDays[d].sh = dayCfg.sh; state.schDays[d].sm = dayCfg.sm;
        } else {
          state.schDays[d].eh = parseInt(s.hora_entrada.slice(0,2))
          state.schDays[d].em = parseInt(s.hora_entrada.slice(3,5))
          state.schDays[d].sh = parseInt(s.hora_salida.slice(0,2))
          state.schDays[d].sm = parseInt(s.hora_salida.slice(3,5))
        }
      } else {
        state.schDays[d].active = false
      }
    })
  } else {
    document.getElementById('sch-tol').value = '10'
    state.schDays = Object.fromEntries(DAYS_LIST.map(d=>[d,defaultDaySchedule(d)]))
  }
  
  openSchPicker()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function openSchPicker() {
  renderSchRows(); updateSchPreview()
  const ov = document.getElementById('sch-overlay')
  const bd = document.getElementById('sch-backdrop')
  if (!ov||!bd) return
  bd.style.display = 'block'
  ov.style.display = 'flex'
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ov.style.opacity = '1'
    ov.style.transform = 'translate(-50%,-50%) scale(1)'
  }))
}

function closeSchPicker() {
  const ov = document.getElementById('sch-overlay')
  const bd = document.getElementById('sch-backdrop')
  if (!ov||!bd) return
  ov.style.opacity = '0'
  ov.style.transform = 'translate(-50%,-50%) scale(0.95)'
  bd.style.display = 'none'
  setTimeout(() => { 
    ov.style.display = 'none' 
    // Reset title
    const t = document.getElementById('sch-pick-title')
    const sSub = document.getElementById('sch-pick-subtitle')
    if (t) t.textContent = 'Configurar horario por día'
    if (sSub) sSub.textContent = 'Activa los días y define entrada y salida para cada uno'
  }, 200)
}

function renderSchRows() {
  const container = document.getElementById('sch-days-rows')
  if (!container) return
  container.innerHTML = DAYS_LIST.map(day => {
    const d = state.schDays[day]
    return `
    <div class="sch-day-row ${d.active?'':'inactive'}" id="row-${day}">
      <label class="day-toggle">
        <input type="checkbox" ${d.active?'checked':''} onchange="toggleSchDay('${day}',this.checked)"/>
        <span style="font-weight:${d.active?'600':'400'}">${day}</span>
      </label>
      <div class="time-input-pair" style="opacity:${d.active?'1':'0.3'};pointer-events:${d.active?'auto':'none'}">
        <div class="time-mini">
          <button onclick="schSpin('${day}','eh',1)">▲</button>
          <div class="tv" id="sch-${day}-eh" style="color:var(--success)">${pad2(d.eh)}</div>
          <button onclick="schSpin('${day}','eh',-1)">▼</button>
        </div>
        <div class="time-sep-mini">:</div>
        <div class="time-mini">
          <button onclick="schSpin('${day}','em',5)">▲</button>
          <div class="tv" id="sch-${day}-em" style="color:var(--success)">${pad2(d.em)}</div>
          <button onclick="schSpin('${day}','em',-5)">▼</button>
        </div>
      </div>
      <div class="time-input-pair" style="opacity:${d.active?'1':'0.3'};pointer-events:${d.active?'auto':'none'}">
        <div class="time-mini">
          <button onclick="schSpin('${day}','sh',1)">▲</button>
          <div class="tv" id="sch-${day}-sh" style="color:var(--danger)">${pad2(d.sh)}</div>
          <button onclick="schSpin('${day}','sh',-1)">▼</button>
        </div>
        <div class="time-sep-mini">:</div>
        <div class="time-mini">
          <button onclick="schSpin('${day}','sm',5)">▲</button>
          <div class="tv" id="sch-${day}-sm" style="color:var(--danger)">${pad2(d.sm)}</div>
          <button onclick="schSpin('${day}','sm',-5)">▼</button>
        </div>
      </div>
    </div>`
  }).join('')
}

function toggleSchDay(day, checked) {
  state.schDays[day].active = checked
  renderSchRows(); updateSchPreview()
}

function schSpin(day, key, delta) {
  const d = state.schDays[day]
  const limits = { eh:[0,23], em:[0,55], sh:[0,23], sm:[0,55] }
  const [lo, hi] = limits[key]
  const step = Math.abs(delta)
  d[key] = (Math.round((d[key]-lo)/step) * step + delta - lo + (hi-lo+step)) % (hi-lo+step) + lo
  const el = document.getElementById(`sch-${day}-${key}`)
  if (el) el.textContent = pad2(d[key])
  updateSchPreview()
}

function updateSchPreview() {
  const active = DAYS_LIST.filter(d => state.schDays[d].active)
  const prev = document.getElementById('sch-picker-preview')
  if (!active.length) { if(prev) prev.textContent='Ningún día activo'; return }
  const first = state.schDays[active[0]]
  if (prev) prev.textContent = `${active.join(', ')} · ${pad2(first.eh)}:${pad2(first.em)} → ${pad2(first.sh)}:${pad2(first.sm)}`
}

function confirmSchPicker() {
  const active = DAYS_LIST.filter(d => state.schDays[d].active)
  if (!active.length) { toast('Activa al menos un día','warning'); return }
  const first = state.schDays[active[0]]
  const label = `${active.join(', ')} · ${pad2(first.eh)}:${pad2(first.em)} → ${pad2(first.sh)}:${pad2(first.sm)}`
  const btn = document.getElementById('sch-picker-btn')
  const sub = document.getElementById('sch-picker-sub')
  if (btn) { btn.querySelector('span').textContent='Configurado ✓'; btn.style.borderColor='var(--success)'; btn.style.color='var(--success)' }
  if (sub) { sub.textContent='📅 '+label; sub.style.color='var(--info)'; sub.style.display='block' }
  closeSchPicker()
}

async function saveSchedule() {
  const empId = document.getElementById('sch-emp')?.value
  if (!empId) { toast('Selecciona un empleado','warning'); return }
  const active = DAYS_LIST.filter(d => state.schDays[d].active)
  if (!active.length) { toast('Configura el horario con el botón de días','warning'); return }
  const first   = state.schDays[active[0]]
  const entrada = `${pad2(first.eh)}:${pad2(first.em)}`
  const salida  = `${pad2(first.sh)}:${pad2(first.sm)}`
  const tol     = parseInt(document.getElementById('sch-tol')?.value || '10')

  const activeDays = active.map(d => ({
    day: d,
    eh: state.schDays[d].eh, em: state.schDays[d].em,
    sh: state.schDays[d].sh, sm: state.schDays[d].sm
  }))

  try {
    // 1. Guardar en Supabase
    const { error } = await sb.from('schedules').upsert({
      employee_id:empId, dias:activeDays,
      hora_entrada:entrada+':00', hora_salida:salida+':00',
      tolerancia_min:tol, updated_at:new Date().toISOString()
    }, { onConflict:'employee_id' })
    if (error) throw error

    // 2. Reset UI
    const btn=document.getElementById('sch-picker-btn')
    const sub=document.getElementById('sch-picker-sub')
    if(btn){btn.querySelector('span').textContent='Configurar';btn.style.borderColor='';btn.style.color=''}
    if(sub){sub.style.display='none'}
    state.schDays = Object.fromEntries(DAYS_LIST.map(d=>[d,defaultDaySchedule(d)]))

    // 3. Recargar datos
    await loadAll()

    // 4. Sincronizar SOLO el bloque A (horarios) — no tocar el bloque B de registros
    try {
      await syncHorariosBlock()
      toast('Horario guardado y sincronizado en Sheets ✓','success')
    } catch(sheetErr) {
      console.warn('Sync sheets:', sheetErr.message)
      toast('Horario guardado en Supabase. Error sync Sheets: '+sheetErr.message,'warning')
    }

  } catch(e) { toast('Error: '+e.message,'error') }
}

// Sincroniza SOLO el bloque A (horarios) de la hoja ⌛HORARIOS
async function syncHorariosBlock() {
  const token = await getGoogleToken()
  if (!token) throw new Error('No se pudo obtener token de Google')

  const SHEET_ID = window.FH_CONFIG.SPREADSHEET_ID
  const SNAME    = window.FH_CONFIG.SHEET_NAME || '⌛HORARIOS'

  // Construir bloque A con los datos actualizados
  // Headers: Empleado | Cedula | Dias Laborales | Entrada | Salida | Tolerancia(min)
  const schedMap = {}
  state.schedules.forEach(s => schedMap[s.employee_id] = s)

  const aRows = state.employees.map(e => {
    const s = schedMap[e.id]
    let diasStr = formatDaysList(s ? s.dias : null, '\n')
    return [
      `${e.nombre} ${e.apellido||''}`.trim(),
      e.cedula || '',
      diasStr,
      s ? (s.hora_entrada||'').slice(0,5) : '—',
      s ? (s.hora_salida||'').slice(0,5)  : '—',
      s ? String(s.tolerancia_min)         : '—',
    ]
  })

  const aHeaders = [['Empleado','Cedula','Dias Laborales','Entrada','Salida','Tolerancia (min)']]

  // Limpiar solo el bloque A (cols A:F)
  const clearA = encodeURIComponent(`${SNAME}!A1:F1000`)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${clearA}:clear`,
    { method:'POST', headers:{ Authorization:`Bearer ${token}` } }
  )

  // Escribir bloque A empezando en A1
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [{ range:`'${SNAME}'!A1`, values:[...aHeaders, ...aRows] }]
      })
    }
  )
  if (!writeRes.ok) throw new Error(`Sheets write error: ${writeRes.status}`)
}

// Agrega UN log individual al bloque B de ⌛HORARIOS (no borra los existentes)
async function appendLogToSheet(log) {
  const token = await getGoogleToken()
  if (!token) throw new Error('No Google token')

  const SHEET_ID = window.FH_CONFIG.SPREADSHEET_ID
  const SNAME    = window.FH_CONFIG.SHEET_NAME || '⌛HORARIOS'

  const ts  = log.timestamp || ''
  let fecha = '', semana = '', hora = ''
  try {
    const dt = new Date(ts)
    // Convert UTC → local time (browser's timezone, e.g. Venezuela UTC-4)
    // Use local date parts, not UTC parts
    const localY = dt.getFullYear()
    const localM = String(dt.getMonth()+1).padStart(2,'0')
    const localD = String(dt.getDate()).padStart(2,'0')
    fecha  = `${localD}/${localM}/${localY}`
    semana = String(getISOWeek(dt))
    hora   = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`
  } catch(e) {}
  // Allow override from log.hora (already local from web app)
  if (log.hora && log.hora.length >= 5) hora = log.hora
  const estadoLow = (log.estado||'').toLowerCase()
  const tardeVal  = estadoLow==='tarde'       ? 'SÍ'
                  : estadoLow==='tolerancia'  ? 'TOLERANCIA'
                  : estadoLow==='anticipada'  ? 'Salida anticipada'
                  : estadoLow==='salida'      ? 'NO'
                  : 'NO'

  const row = [
    fecha,
    semana,
    log.nombre_empleado || '',
    log.cedula          || '',
    log.area || log.rol || '',
    (log.tipo||'').toUpperCase(),
    hora,
    tardeVal,
    String(log.late_min || 0),
    log.mensaje || ''
  ]

  // Append — la API encuentra la primera fila vacía en el bloque H:Q
  // Read col H to find the first empty row (avoid INSERT_ROWS shifting the schedule block)
  const readEnc = encodeURIComponent(`${SNAME}!H:H`)
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${readEnc}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  let nextRow = 2
  if (readRes.ok) {
    const rd = await readRes.json()
    const vals = rd.values || []
    let lastFilled = 1
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] && vals[i][0] && String(vals[i][0]).trim() !== '') lastFilled = i + 1
    }
    nextRow = lastFilled + 1
  }

  const rowRange = encodeURIComponent(`${SNAME}!H${nextRow}:Q${nextRow}`)
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${rowRange}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  )
  if (!res.ok) throw new Error(`Sheets write error: ${res.status}`)
}

// Sync COMPLETO del bloque B — solo usado por el botón "Sync Google Sheets"
// Limpia y reescribe todos los logs
async function syncLogsBlock() {
  const token = await getGoogleToken()
  if (!token) throw new Error('No se pudo obtener token de Google')

  const SHEET_ID = window.FH_CONFIG.SPREADSHEET_ID
  const SNAME    = window.FH_CONFIG.SHEET_NAME || '⌛HORARIOS'

  const bHeaders = [['Fecha','Semana','Empleado','Cedula','Area','Tipo','Hora','Tarde','Min Tarde','Mensaje / Nota']]
  const bRows = state.logs.map(l => {
    const ts  = l.timestamp || ''
    let fecha = '', semana = '', hora = ''
    try {
      const dt = new Date(ts)
      fecha  = `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
      semana = String(getISOWeek(dt))
      hora   = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`
    } catch{}
    const estadoLow = (l.estado||'').toLowerCase()
    const tardeVal  = estadoLow==='tarde' ? 'SÍ' : estadoLow==='tolerancia' ? 'TOLERANCIA' : estadoLow==='anticipada' ? 'Salida anticipada' : 'NO'
    return [fecha,semana,l.nombre_empleado||'',l.cedula||'',l.area||l.rol||'',(l.tipo||'').toUpperCase(),hora,tardeVal,String(l.late_min||''),l.mensaje||'']
  })

  // Limpiar bloque B (cols H:Q) y reescribir
  const clearB = encodeURIComponent(`${SNAME}!H1:Q2000`)
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${clearB}:clear`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`}
  })
  const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({ valueInputOption:'RAW', data:[{ range:`${SNAME}!H1`, values:[...bHeaders,...bRows] }]})
  })
  if (!writeRes.ok) throw new Error(`Sheets write error: ${writeRes.status}`)
}

// ════════════════════════════════════════════════════
//  FREE TIME TYPE TOGGLE
// ════════════════════════════════════════════════════
let _flTipo = 'hora'  // 'hora' | 'dia'

function setFlTipo(tipo) {
  _flTipo = tipo
  const btnH = document.getElementById('fl-tipo-hora')
  const btnD = document.getElementById('fl-tipo-dia')
  const rowH = document.getElementById('fl-row-hora')
  const rowD = document.getElementById('fl-row-dia')

  if (tipo === 'hora') {
    btnH.style.borderColor = 'var(--accent2)'
    btnH.style.background  = 'rgba(124,58,237,0.15)'
    btnH.style.color       = 'var(--accent2)'
    btnD.style.borderColor = 'var(--border2)'
    btnD.style.background  = 'transparent'
    btnD.style.color       = 'var(--text2)'
    rowH.style.display = 'grid'
    rowD.style.display = 'none'
  } else {
    btnD.style.borderColor = 'var(--warning)'
    btnD.style.background  = 'rgba(245,158,11,0.12)'
    btnD.style.color       = 'var(--warning)'
    btnH.style.borderColor = 'var(--border2)'
    btnH.style.background  = 'transparent'
    btnH.style.color       = 'var(--text2)'
    rowH.style.display = 'none'
    rowD.style.display = 'grid'
  }
}

// ════════════════════════════════════════════════════
//  SAVE DAY OFF
// ════════════════════════════════════════════════════
async function saveDayOff() {
  const empId  = document.getElementById('fl-emp-dia')?.value
  const fecha  = document.getElementById('e-fl-dia')?.value
  const motivo = document.getElementById('fl-motivo-dia')?.value.trim() || 'Día libre'

  if (!empId) { toast('Selecciona un empleado','warning'); return }
  if (!fecha)  { toast('Selecciona una fecha','warning'); return }

  try {
    const { error } = await sb.from('logs').insert({
      employee_id: empId,
      tipo: 'libre',
      estado: 'libre',
      late_min: 0,
      mensaje: `DÍA LIBRE: ${motivo}`,
      timestamp: `${fecha}T00:00:00`
    })
    if (error) throw error

    // Sync to Sheets
    try {
      const emp = state.employees.find(e => e.id === empId)
      const [y,m,d] = fecha.split('-')
      await appendLogToSheet({
        timestamp: `${fecha}T00:00:00`,
        hora: '00:00',
        nombre_empleado: emp ? `${emp.nombre} ${emp.apellido||''}`.trim() : '',
        cedula: emp?.cedula || '',
        area:   emp?.area   || '',
        tipo:   'libre',
        estado: 'libre',
        late_min: 0,
        mensaje: `DÍA LIBRE: ${motivo}`
      })
    } catch(se) { console.warn('Sheet sync day off:', se.message) }

    // Reset form
    const mEl = document.getElementById('fl-motivo-dia')
    if (mEl) mEl.value = ''
    setMiniCalValue('fl-dia', null)

    await loadAll()
    toast(`Día libre registrado para ${fecha} ✓`, 'success')
  } catch(e) { toast('Error: ' + e.message, 'error') }
}

async function saveFreeTime() {
  const empId  = document.getElementById('fl-emp')?.value
  const fecha  = document.getElementById('e-inicio-fl')?.value || ''
  const desde  = `${pad2(state.calTimes.fh)}:${pad2(state.calTimes.fm)}`
  const hasta  = `${pad2(state.calTimes.th)}:${pad2(state.calTimes.tm)}`
  const motivo = document.getElementById('fl-motivo')?.value.trim() || 'Hora libre concedida por admin'
  const calFecha = state.calSel ? state.calSel.toISOString().slice(0,10) : ''
  if (!empId) { toast('Selecciona un empleado','warning'); return }
  if (!calFecha) { toast('Selecciona fecha con el calendario','warning'); return }
  try {
    const { error } = await sb.from('logs').insert({
      employee_id:empId, tipo:'libre', estado:'libre', late_min:0,
      mensaje:`HORA LIBRE ${desde}-${hasta}: ${motivo}`,
      timestamp:`${calFecha}T${desde}:00`
    })
    if (error) throw error
    const motiEl = document.getElementById('fl-motivo')
    if(motiEl) motiEl.value=''
    const trigBtn=document.getElementById('cal-trigger-btn')
    const trigSub=document.getElementById('cal-trigger-sub')
    if(trigBtn){trigBtn.querySelector('span').textContent='Seleccionar';trigBtn.style.borderColor='';trigBtn.style.color=''}
    if(trigSub){trigSub.style.display='none'}
    state.calSel=null
    await loadAll()
    // 2. Append this log directly to Sheets block B
    try {
      const calFechaFmt = calFecha ? (() => {
        const [y,m,d] = calFecha.split('-')
        return `${d}/${m}/${y}`
      })() : ''
      await appendLogToSheet({
        timestamp: `${calFecha}T${desde}:00`,
        hora: desde,
        nombre_empleado: (() => { const e=state.employees.find(x=>x.id===empId); return e?`${e.nombre} ${e.apellido||''}`.trim():'' })(),
        cedula: (() => { const e=state.employees.find(x=>x.id===empId); return e?.cedula||'' })(),
        area: (() => { const e=state.employees.find(x=>x.id===empId); return e?.area||'' })(),
        tipo: 'libre',
        estado: 'libre',
        late_min: 0,
        mensaje: `HORA LIBRE ${desde}-${hasta}: ${motivo}`
      })
      toast('Hora libre registrada y sincronizada en Sheets ✓','success')
    } catch(sheetErr) {
      console.warn('Sync logs sheets:', sheetErr.message)
      toast('Hora libre registrada. Error sync Sheets: '+sheetErr.message,'warning')
    }
  } catch(e) { toast('Error: '+e.message,'error') }
}

// ════════════════════════════════════════════════════
//  LOGS
// ════════════════════════════════════════════════════
function renderLogs(filter={}) {
  let data = [...state.logs]
  if (filter.fecha) data = data.filter(l=>(l.timestamp||'').slice(0,10)===filter.fecha)
  if (filter.empId) data = data.filter(l=>l.employee_id===filter.empId)
  const tbody = document.getElementById('logs-tbody')
  if (!tbody) return
  tbody.innerHTML = data.slice(0,300).map(l=>`
    <tr>
      <td style="font-weight:500">${l.nombre_empleado||'—'}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text2)">${l.cedula||'—'}</td>
      <td><span class="badge badge-${l.tipo}">${(l.tipo||'').toUpperCase()}</span></td>
      <td style="color:var(--text2)">${(l.timestamp||'').slice(0,10)}</td>
      <td style="font-family:var(--mono)">${(l.hora||l.timestamp||'').slice(11,16)||'—'}</td>
      <td>${l.estado?`<span class="badge badge-${l.estado}">${l.estado.toUpperCase()}</span>`:'—'}</td>
      <td style="color:${(l.late_min||0)>0?'var(--warning)':'var(--muted)'};font-family:var(--mono)">${l.late_min||'—'}</td>
      <td style="color:var(--text2);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.mensaje||'—'}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-state">Sin registros</td></tr>'
}

function loadLogs() {
  const fecha  = document.getElementById('log-date')?.value.trim()
  const empSel = document.getElementById('log-emp')?.value
  renderLogs({ fecha:fecha||undefined, empId:empSel||undefined })
}
function clearLogsFilter() {
  const ld=document.getElementById('log-date'); if(ld) ld.value=''
  const le=document.getElementById('log-emp'); if(le) le.value=''
  renderLogs()
}

// ════════════════════════════════════════════════════
//  REPORTS
// ════════════════════════════════════════════════════
function genReport() {
  const emps = state.employees
  const logs = state.logs
  const stats = {}
  logs.forEach(l=>{
    const eid=l.employee_id
    if(!stats[eid]) stats[eid]={p:0,t:0,tard:0,lib:0,dias:new Set(),min:0}
    if(l.tipo==='entrada'){
      stats[eid].dias.add((l.timestamp||'').slice(0,10))
      if(l.estado==='puntual') stats[eid].p++
      else if(l.estado==='tolerancia') stats[eid].t++
      else if(l.estado==='tarde'){stats[eid].tard++;stats[eid].min+=(l.late_min||0)}
    } else if(l.tipo==='libre') stats[eid].lib++
  })
  const now = new Date().toLocaleString('es-ES')
  const lines = [
    `  Reporte: ${now}\n`,
    `  ${'EMPLEADO'.padEnd(26)} ${'DIAS'.padStart(5)} ${'PUNTUAL'.padStart(9)} ${'TOLER'.padStart(7)} ${'TARDE'.padStart(7)} ${'MIN'.padStart(8)} ${'LIBRES'.padStart(7)} ${'%OK'.padStart(6)}`,
    '  '+'─'.repeat(74),
    ...emps.map(emp=>{
      const s=stats[emp.id]||{p:0,t:0,tard:0,lib:0,dias:new Set(),min:0}
      const total=s.p+s.t+s.tard
      const pct=total?Math.round((s.p+s.t)/total*100):0
      const name=`${emp.nombre} ${emp.apellido||''}`.padEnd(26)
      return `  ${name} ${String(s.dias.size).padStart(5)} ${String(s.p).padStart(9)} ${String(s.t).padStart(7)} ${String(s.tard).padStart(7)} ${String(s.min).padStart(8)} ${String(s.lib).padStart(7)} ${String(pct+'%').padStart(6)}`
    })
  ]
  state.reportData = lines
  const box = document.getElementById('report-output')
  if (box) box.textContent = lines.join('\n')
}

function exportCSV() {
  if (!state.reportData.length) genReport()
  const csv  = state.reportData.join('\n')
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'})
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href=url; a.download='reporte_flash_high.csv'; a.click()
  URL.revokeObjectURL(url)
  toast('CSV exportado ✓','success')
}

// ════════════════════════════════════════════════════
//  SELECTS
// ════════════════════════════════════════════════════
function populateSelects() {
  const opts = state.employees.map(e=>`<option value="${e.id}">${e.nombre} ${e.apellido||''}</option>`).join('')
  ;['sch-emp','fl-emp','fl-emp-dia'].forEach(id=>{
    const el=document.getElementById(id)
    if(el) el.innerHTML='<option value="">Selecciona...</option>'+opts
  })
  const logEmp=document.getElementById('log-emp')
  if(logEmp) logEmp.innerHTML='<option value="">Todos</option>'+opts
}

// ════════════════════════════════════════════════════
//  INLINE CALENDAR (hora libre)
// ════════════════════════════════════════════════════
function openCal() {
  const now = new Date()
  state.calView = { year:now.getFullYear(), month:now.getMonth() }
  state.calViewMode = 'day'
  renderCalGrid(); updateCalSummary()
  const ov=document.getElementById('cal-overlay')
  const bd=document.getElementById('cal-backdrop')
  if(!ov||!bd) return
  bd.classList.add('open')
  ov.style.display='flex'
  requestAnimationFrame(()=>requestAnimationFrame(()=>ov.classList.add('open')))
}

function closeCal() {
  const ov=document.getElementById('cal-overlay')
  const bd=document.getElementById('cal-backdrop')
  if(!ov||!bd) return
  ov.classList.remove('open')
  bd.classList.remove('open')
  setTimeout(()=>{ov.style.display='none'},200)
}

function calPrev() {
  if(state.calViewMode==='day'){
    if(state.calView.month===0){state.calView.month=11;state.calView.year--}
    else state.calView.month--
  } else if(state.calViewMode==='month') state.calView.year--
  else state.calView.year-=12
  renderCalGrid()
}
function calNext() {
  if(state.calViewMode==='day'){
    if(state.calView.month===11){state.calView.month=0;state.calView.year++}
    else state.calView.month++
  } else if(state.calViewMode==='month') state.calView.year++
  else state.calView.year+=12
  renderCalGrid()
}
function calToggleMode() {
  if(state.calViewMode==='day') state.calViewMode='month'
  else if(state.calViewMode==='month') state.calViewMode='year'
  else state.calViewMode='day'
  renderCalGrid()
}
function calSelectMonth(m) { state.calView.month=m; state.calViewMode='day'; renderCalGrid() }
function calSelectYear(y)   { state.calView.year=y;  state.calViewMode='month'; renderCalGrid() }

function renderCalGrid() {
  const {year,month} = state.calView
  const mode = state.calViewMode||'day'
  const label = document.getElementById('cal-month-lbl')
  const daysHdr = document.querySelector('.cal-days-header')
  const grid  = document.getElementById('cal-grid')
  const today = new Date()
  if(!label||!grid) return

  if(mode==='day') {
    label.textContent=`${MONTHS_ES[month]} ${year}`
    if(daysHdr) daysHdr.style.display='grid'
    const first=new Date(year,month,1); const last=new Date(year,month+1,0)
    let startDay=first.getDay()-1; if(startDay<0) startDay=6
    let html=''
    for(let i=0;i<startDay;i++) html+='<div class="cal-day empty"></div>'
    for(let d=1;d<=last.getDate();d++){
      const dt=new Date(year,month,d)
      const iso=dt.toISOString().slice(0,10)
      const isToday=dt.toDateString()===today.toDateString()
      const isSel=state.calSel&&dt.toDateString()===state.calSel.toDateString()
      let cls='cal-day'+(isToday?' today':'')+(isSel?' selected':'')+(dt<today&&!isToday?' past':'')
      html+=`<div class="${cls}" onclick="selectCalDay('${iso}')">${d}</div>`
    }
    grid.className='cal-grid'; grid.innerHTML=html
  } else if(mode==='month') {
    label.textContent=`${year}`
    if(daysHdr) daysHdr.style.display='none'
    grid.className='cal-grid cal-month-grid'
    grid.innerHTML=MONTHS_ES.map((name,idx)=>
      `<div class="cal-month-cell${idx===month?' selected':''}" onclick="calSelectMonth(${idx})">${name}</div>`
    ).join('')
  } else {
    const startY=year-6
    label.textContent=`${startY} – ${startY+11}`
    if(daysHdr) daysHdr.style.display='none'
    grid.className='cal-grid cal-month-grid'
    let html=''
    for(let y=startY;y<startY+12;y++)
      html+=`<div class="cal-month-cell${y===year?' selected':''}" onclick="calSelectYear(${y})">${y}</div>`
    grid.innerHTML=html
  }
}

function selectCalDay(isoStr) {
  state.calSel = new Date(isoStr+'T12:00:00')
  renderCalGrid(); updateCalSummary()
}

function spinTime(key, delta) {
  const limits={fh:[0,23],fm:[0,59],th:[0,23],tm:[0,59]}
  const [lo,hi]=limits[key]
  state.calTimes[key]=(state.calTimes[key]+delta-lo+(hi-lo+1))%(hi-lo+1)+lo
  const el=document.getElementById(key+'-lbl'); if(el) el.textContent=pad2(state.calTimes[key])
  updateCalSummary()
}

function updateCalSummary() {
  const {fh,fm,th,tm}=state.calTimes
  const tf=`${pad2(fh)}:${pad2(fm)}`, tt=`${pad2(th)}:${pad2(tm)}`
  const d=state.calSel?state.calSel.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}):'—'
  const sum=document.getElementById('cal-summary'); if(sum) sum.textContent=`${d}\n${tf}  →  ${tt}`
  const fp=document.getElementById('cal-footer-preview')
  if(fp) fp.innerHTML=state.calSel?`Evento: <span>${d},  ${tf} — ${tt}</span>`:'Selecciona un día'
}

function confirmCal() {
  if(!state.calSel){ toast('Elige un día del calendario','warning'); return }
  const {fh,fm,th,tm}=state.calTimes
  const tf=`${pad2(fh)}:${pad2(fm)}`, tt=`${pad2(th)}:${pad2(tm)}`
  const d=state.calSel.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'})
  const label=`${d}  ${tf} → ${tt}`
  const btn=document.getElementById('cal-trigger-btn')
  const sub=document.getElementById('cal-trigger-sub')
  if(btn){btn.querySelector('span').textContent='Seleccionado ✓';btn.style.borderColor='var(--success)';btn.style.color='var(--success)'}
  if(sub){sub.textContent='📅 '+label;sub.style.color='var(--warning)';sub.style.display='block'}
  closeCal()
}

// ════════════════════════════════════════════════════
//  MINI CALENDAR (campos de fecha en empleados)
// ════════════════════════════════════════════════════
const miniCalState = {
  inicio:{ view:{y:new Date().getFullYear(),m:new Date().getMonth()}, sel:null, mode:'day' },
  cumple:{ view:{y:new Date().getFullYear(),m:new Date().getMonth()}, sel:null, mode:'day' },
  handler: null
}

function openMiniCal(field) {
  // Cerrar el otro
  const other = field==='inicio'?'cumple':'inicio'
  const otherEl = document.getElementById('mini-cal-'+other)
  if(otherEl) otherEl.classList.remove('open')

  const el  = document.getElementById('mini-cal-'+field)
  const btn = document.getElementById(field+'-btn')
  if(!el||!btn) return

  if(el.classList.contains('open')){ el.classList.remove('open'); return }

  // Posicionar DENTRO de la ventana
  const rect    = btn.getBoundingClientRect()
  const CAL_W   = 260, CAL_H = 280
  const winW    = window.innerWidth, winH = window.innerHeight

  let top  = rect.bottom + 6
  let left = rect.left

  // No salirse por la derecha
  if (left + CAL_W > winW - 10) left = winW - CAL_W - 10
  // No salirse por abajo
  if (top + CAL_H > winH - 10)  top  = rect.top - CAL_H - 6
  // No salirse por la izquierda
  if (left < 10) left = 10

  el.style.position = 'fixed'
  el.style.top      = top  + 'px'
  el.style.left     = left + 'px'
  el.style.width    = CAL_W + 'px'

  miniCalState[field].mode = 'day'
  renderMiniCal(field)
  el.classList.add('open')

  // Remover listener anterior si existe
  if(miniCalState.handler) {
    document.removeEventListener('click', miniCalState.handler)
  }

  // Crear nuevo listener
  const handler = (e) => {
    if(!el.contains(e.target) && e.target!==btn && !btn.contains(e.target)) {
      el.classList.remove('open')
      document.removeEventListener('click', handler)
      miniCalState.handler = null
    }
  }
  miniCalState.handler = handler
  
  setTimeout(() => {
    document.addEventListener('click', handler)
  }, 10)
}

function renderMiniCal(field) {
  const s    = miniCalState[field]
  const {y,m}= s.view
  const mode = s.mode||'day'
  const sel  = s.sel
  const today= new Date()
  const el   = document.getElementById('mini-cal-'+field)
  if(!el) return

  const headerText = mode==='day' ? `${MONTHS_ES[m]} ${y}`
    : mode==='month' ? `${y}` : `${y-6} – ${y+5}`

  let html = `
    <div class="mini-cal-nav">
      <button onclick="event.stopPropagation();miniCalNav('${field}',-1)">‹</button>
      <div class="mini-cal-month" onclick="event.stopPropagation();miniCalToggleMode('${field}')"
        style="cursor:pointer">${headerText}</div>
      <button onclick="event.stopPropagation();miniCalNav('${field}',1)">›</button>
    </div>`

  if(mode==='day') {
    html+=`<div class="mini-cal-hdrs"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="mini-cal-grid">`
    const firstDay=new Date(y,m,1); const lastDay=new Date(y,m+1,0)
    let startDow=firstDay.getDay()-1; if(startDow<0) startDow=6
    for(let i=0;i<startDow;i++) html+='<div class="mini-day empty"></div>'
    for(let d=1;d<=lastDay.getDate();d++){
      const dt=new Date(y,m,d)
      const isToday=dt.toDateString()===today.toDateString()
      const isSel=sel&&dt.toDateString()===new Date(sel+'T12:00:00').toDateString()
      const iso=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      let cls='mini-day'+(isToday?' today':'')+(isSel?' selected':'')
      html+=`<div class="${cls}" onclick="event.stopPropagation();pickMiniDate('${field}','${iso}')">${d}</div>`
    }
    html+='</div>'
  } else if(mode==='month') {
    html+='<div class="mini-cal-grid mini-cal-month-grid">'
    MONTHS_ES.forEach((name,idx)=>{
      html+=`<div class="mini-month-cell${idx===m?' selected':''}"
        onclick="event.stopPropagation();miniCalSetMonth('${field}',${idx})">${name}</div>`
    })
    html+='</div>'
  } else {
    const startY=y-6
    html+='<div class="mini-cal-grid mini-cal-month-grid">'
    for(let yr=startY;yr<startY+12;yr++)
      html+=`<div class="mini-month-cell${yr===y?' selected':''}"
        onclick="event.stopPropagation();miniCalSetYear('${field}',${yr})">${yr}</div>`
    html+='</div>'
  }
  el.innerHTML=html
}

function miniCalToggleMode(field){
  const s=miniCalState[field]
  if(s.mode==='day') s.mode='month'
  else if(s.mode==='month') s.mode='year'
  else s.mode='day'
  renderMiniCal(field)
}
function miniCalSetMonth(field,m){ miniCalState[field].view.m=m; miniCalState[field].mode='day'; renderMiniCal(field) }
function miniCalSetYear(field,y) { miniCalState[field].view.y=y; miniCalState[field].mode='month'; renderMiniCal(field) }
function miniCalNav(field,delta) {
  const s=miniCalState[field]
  if(s.mode==='day'){
    s.view.m+=delta; if(s.view.m>11){s.view.m=0;s.view.y++} if(s.view.m<0){s.view.m=11;s.view.y--}
  } else if(s.mode==='month') s.view.y+=delta
  else s.view.y+=delta*12
  renderMiniCal(field)
}

function pickMiniDate(field,isoStr){
  miniCalState[field].sel=isoStr
  setMiniCalValue(field,isoStr)
  document.getElementById('mini-cal-'+field)?.classList.remove('open')
}

function setMiniCalValue(field,isoStr){
  const hidden  = document.getElementById('e-'+field)
  const display = document.getElementById(field+'-display')
  const btn     = document.getElementById(field+'-btn')
  if(!isoStr){
    if(hidden)  hidden.value=''
    if(display) display.textContent='Seleccionar'
    if(btn){btn.style.borderColor='';btn.style.color=''}
    miniCalState[field].sel=null
    return
  }
  const [y,mo,d]=isoStr.split('-')
  if(hidden)  hidden.value=isoStr
  if(display) display.textContent=`${d}/${mo}/${y}`
  if(btn){btn.style.borderColor='var(--success)';btn.style.color='var(--success)'}
}

// syncSheets removido - ahora las operaciones son automáticas

// ════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════
function toast(msg, type='success') {
  const icons={success:'✓',error:'✕',warning:'⚠'}
  const c=document.getElementById('toast-container'); if(!c) return
  const el=document.createElement('div')
  el.className=`toast ${type}`
  el.innerHTML=`<span class="toast-icon">${icons[type]||'•'}</span><span class="toast-msg">${msg}</span>`
  c.appendChild(el)
  setTimeout(()=>{ el.style.transition='opacity 0.3s,transform 0.3s'; el.style.opacity='0'; el.style.transform='translateX(20px)'; setTimeout(()=>el.remove(),300) },3200)
}

// ════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════
function formatDaysList(dias, separator = ', ') {
  if (!dias || !dias.length) return 'No asignado'
  return dias.map(d => {
    let obj = d
    if (typeof d === 'string') {
      try { obj = JSON.parse(d) } catch(e) {}
    }
    if (typeof obj === 'object' && obj.day) {
      return `${obj.day} - (${pad2(obj.eh)}:${pad2(obj.em)}) (${pad2(obj.sh)}:${pad2(obj.sm)})`
    }
    return String(d)
  }).join(separator)
}

function pad2(n) { return String(n).padStart(2,'0') }

// ── Start ─────────────────────────────────────────
init()