// src/ui/terminal.js
// Interfaz de terminal con blessed para el agente

const blessed = require('blessed');

// ============================================
// Estado global
// ============================================

const estado = {
  conectado: false,
  autenticado: false,
  agenteNombre: null,
  workspaceNombre: null,
  registradores: [],
  logs: [],
  menuVisible: false,
  menuIndex: 0,
  iniciado: null,
};

const MAX_LOGS = 50;

// ============================================
// Componentes de blessed
// ============================================

let screen = null;
let headerBox = null;
let registradoresBox = null;
let logBox = null;
let menuBox = null;
let footerBox = null;

// Callbacks para acciones del menú
let onRecargar = null;
let onSalir = null;

// ============================================
// Inicialización
// ============================================

function inicializar(opciones = {}) {
  if (opciones.onRecargar) onRecargar = opciones.onRecargar;
  if (opciones.onSalir) onSalir = opciones.onSalir;

  estado.iniciado = new Date();

  // Crear pantalla
  screen = blessed.screen({
    smartCSR: true,
    title: 'Agente Modbus',
    fullUnicode: true,
    mouse: true,
  });

  // ========== HEADER (3 líneas con borde) ==========
  headerBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    tags: true,
    label: ' AGENTE MODBUS ',
    style: {
      fg: 'white',
      border: { fg: 'green' },
    },
  });

  // ========== REGISTRADORES (altura fija 10 lineas) ==========
  registradoresBox = blessed.box({
    top: 3,
    left: 0,
    width: '100%',
    height: 10,
    border: { type: 'line' },
    tags: true,
    label: ' REGISTRADORES ',
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
    },
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { bg: 'cyan' },
    },
  });

  // Manejar scroll con rueda del mouse en registradoresBox
  registradoresBox.on('wheeldown', () => {
    registradoresBox.scroll(1);
    screen.render();
  });

  registradoresBox.on('wheelup', () => {
    registradoresBox.scroll(-1);
    screen.render();
  });

  // ========== LOG (resto de la pantalla menos footer) ==========
  logBox = blessed.log({
    top: 13,
    left: 0,
    width: '100%',
    height: '100%-14',
    border: { type: 'line' },
    tags: true,
    label: ' LOG ',
    style: {
      fg: 'white',
      border: { fg: 'yellow' },
    },
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { bg: 'yellow' },
    },
    scrollOnInput: false, // Desactivar auto-scroll para permitir scroll manual
  });

  // Manejar scroll con rueda del mouse en logBox
  logBox.on('wheeldown', () => {
    logBox.scroll(3);
    screen.render();
  });

  logBox.on('wheelup', () => {
    logBox.scroll(-3);
    screen.render();
  });

  // ========== FOOTER (1 línea) ==========
  footerBox = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      fg: 'black',
      bg: 'white',
    },
  });

  // ========== MENÚ (oculto inicialmente) ==========
  menuBox = blessed.list({
    top: 'center',
    left: 'center',
    width: 30,
    height: 8,
    border: { type: 'line' },
    tags: true,
    label: ' MENU ',
    style: {
      fg: 'white',
      border: { fg: 'yellow' },
      selected: { fg: 'black', bg: 'cyan' },
    },
    keys: true,
    vi: false,
    items: [
      '  Recargar registradores',
      '  Ver estado',
      '  Ayuda',
      '  Salir',
    ],
    hidden: true,
  });

  // Agregar componentes a la pantalla
  screen.append(headerBox);
  screen.append(registradoresBox);
  screen.append(logBox);
  screen.append(footerBox);
  screen.append(menuBox);

  // ========== EVENTOS DE TECLADO ==========

  // Tecla 'm' para mostrar/ocultar menú
  screen.key(['m', 'M'], () => {
    if (estado.menuVisible) {
      ocultarMenu();
    } else {
      mostrarMenu();
    }
  });

  // Escape para cerrar menú
  screen.key(['escape'], () => {
    if (estado.menuVisible) {
      ocultarMenu();
    }
  });

  // Enter en el menú
  menuBox.on('select', (item, index) => {
    ejecutarOpcionMenu(index);
  });

  // Ctrl+C para salir
  screen.key(['C-c'], () => {
    if (onSalir) onSalir();
    process.exit(0);
  });

  // Tecla q para salir
  screen.key(['q', 'Q'], () => {
    if (!estado.menuVisible) {
      if (onSalir) onSalir();
      process.exit(0);
    }
  });

  // Teclas de flecha para scroll en registradores
  screen.key(['up'], () => {
    if (!estado.menuVisible) {
      registradoresBox.scroll(-1);
      screen.render();
    }
  });

  screen.key(['down'], () => {
    if (!estado.menuVisible) {
      registradoresBox.scroll(1);
      screen.render();
    }
  });

  // Page Up/Down para scroll rápido
  screen.key(['pageup'], () => {
    if (!estado.menuVisible) {
      registradoresBox.scroll(-5);
      screen.render();
    }
  });

  screen.key(['pagedown'], () => {
    if (!estado.menuVisible) {
      registradoresBox.scroll(5);
      screen.render();
    }
  });

  // Redirigir console.log y console.error a blessed
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    const mensaje = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (logBox) {
      logBox.log(`{gray-fg}[console]{/gray-fg} ${mensaje}`);
      if (screen) screen.render();
    }
  };

  console.error = (...args) => {
    const mensaje = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (logBox) {
      logBox.log(`{red-fg}[error]{/red-fg} ${mensaje}`);
      if (screen) screen.render();
    }
  };

  // Renderizar inicial
  actualizarHeader();
  actualizarRegistradores();
  actualizarFooter();
  screen.render();

  return screen;
}

// ============================================
// Funciones del menú
// ============================================

function mostrarMenu() {
  estado.menuVisible = true;
  menuBox.show();
  menuBox.focus();
  screen.render();
}

function ocultarMenu() {
  estado.menuVisible = false;
  menuBox.hide();
  screen.render();
}

function ejecutarOpcionMenu(index) {
  ocultarMenu();

  switch (index) {
    case 0: // Recargar
      log('Recargando registradores...', 'info');
      if (onRecargar) onRecargar();
      break;
    case 1: // Estado
      mostrarEstado();
      break;
    case 2: // Ayuda
      mostrarAyuda();
      break;
    case 3: // Salir
      if (onSalir) onSalir();
      process.exit(0);
      break;
  }
}

function mostrarEstado() {
  log('--- ESTADO ---', 'info');
  log(`Agente: ${estado.agenteNombre || 'No autenticado'}`, 'info');
  log(`Workspace: ${estado.workspaceNombre || 'No vinculado'}`, 'info');
  log(`Conectado: ${estado.conectado ? 'Si' : 'No'}`, estado.conectado ? 'exito' : 'error');
  log(`Registradores: ${estado.registradores.length}`, 'info');
  log(`Tiempo activo: ${formatearTiempoActivo()}`, 'info');
}

function mostrarAyuda() {
  log('--- ATAJOS ---', 'info');
  log('[m] Abrir/cerrar menu', 'info');
  log('[q] Salir del agente', 'info');
  log('[Ctrl+C] Salir del agente', 'info');
  log('[Esc] Cerrar menu', 'info');
  log('[Up/Down] Scroll registradores', 'info');
}

// ============================================
// Actualización de componentes
// ============================================

function actualizarHeader() {
  if (!headerBox) return;

  const estadoConexion = estado.conectado
    ? '{green-fg}Conectado{/green-fg}'
    : '{red-fg}Desconectado{/red-fg}';

  const agente = estado.agenteNombre
    ? `{cyan-fg}${estado.agenteNombre}{/cyan-fg}`
    : '{gray-fg}---{/gray-fg}';

  const workspace = estado.workspaceNombre
    ? `{cyan-fg}${estado.workspaceNombre}{/cyan-fg}`
    : '{gray-fg}Sin vincular{/gray-fg}';

  const linea = ` Backend: ${estadoConexion}  |  Agente: ${agente}  |  Workspace: ${workspace}  |  {yellow-fg}[m] Menu{/yellow-fg}`;

  headerBox.setContent(linea);
}

function actualizarRegistradores() {
  if (!registradoresBox) return;

  if (estado.registradores.length === 0) {
    registradoresBox.setContent('{gray-fg}No hay registradores configurados{/gray-fg}');
    return;
  }

  let contenido = '';

  estado.registradores.forEach((reg) => {
    let icono, estadoTexto;

    if (reg.estado === 'inactivo') {
      icono = '{gray-fg}o{/gray-fg}';
      estadoTexto = '{gray-fg}[Inactivo]{/gray-fg}';
    } else if (reg.estado === 'activo' || reg.estado === 'leyendo') {
      icono = '{green-fg}*{/green-fg}';
      estadoTexto = '{green-fg}[Activo]{/green-fg}';
    } else if (reg.estado === 'error') {
      icono = '{red-fg}x{/red-fg}';
      estadoTexto = '{red-fg}[Error]{/red-fg}';
    } else {
      icono = '{yellow-fg}o{/yellow-fg}';
      estadoTexto = '{yellow-fg}[Espera]{/yellow-fg}';
    }

    const nombre = (reg.nombre || 'Sin nombre').substring(0, 14).padEnd(14);
    const ip = `${reg.ip}:${reg.puerto}`.padEnd(22);
    const registros = `[${reg.indiceInicial}-${reg.indiceInicial + reg.cantRegistros - 1}]`.padEnd(14);

    let proxLectura;
    if (reg.estado === 'inactivo') {
      proxLectura = '---'.padEnd(6);
    } else if (reg.proximaLectura !== null && reg.proximaLectura !== undefined) {
      proxLectura = `${reg.proximaLectura}s`.padEnd(6);
    } else {
      proxLectura = '---'.padEnd(6);
    }

    contenido += `${icono} ${nombre} ${ip} ${registros} ${proxLectura} ${estadoTexto}\n`;
  });

  registradoresBox.setContent(contenido);
}

function actualizarLogs() {
  // No hacer nada - blessed.log maneja su propio contenido
}

function actualizarFooter() {
  if (!footerBox) return;

  const tiempo = formatearTiempoActivo();
  footerBox.setContent(` Tiempo activo: ${tiempo}  |  [m] Menu  |  [q] Salir`);
}

function formatearTiempoActivo() {
  if (!estado.iniciado) return '--:--:--';

  const diff = Math.floor((Date.now() - estado.iniciado.getTime()) / 1000);
  const horas = Math.floor(diff / 3600).toString().padStart(2, '0');
  const minutos = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
  const segundos = (diff % 60).toString().padStart(2, '0');

  return `${horas}:${minutos}:${segundos}`;
}

// ============================================
// API pública
// ============================================

/**
 * Registra un mensaje en el log
 */
function log(mensaje, tipo = 'info') {
  if (!logBox) return;

  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
  let prefijo = '';

  switch (tipo) {
    case 'exito':
      prefijo = '{green-fg}+{/green-fg}';
      break;
    case 'error':
      prefijo = '{red-fg}!{/red-fg}';
      break;
    case 'advertencia':
      prefijo = '{yellow-fg}!{/yellow-fg}';
      break;
    case 'ciclo':
      prefijo = '{cyan-fg}>{/cyan-fg}';
      break;
    default:
      prefijo = '{white-fg}-{/white-fg}';
  }

  const linea = `{gray-fg}${timestamp}{/gray-fg} ${prefijo} ${mensaje}`;

  // Usar el metodo log() de blessed.log que maneja scroll automaticamente
  logBox.log(linea);

  if (screen) screen.render();
}

/**
 * Actualiza el estado de conexión
 */
function setConectado(conectado) {
  estado.conectado = conectado;
  actualizarHeader();
  if (screen) screen.render();
}

/**
 * Actualiza los datos del agente autenticado
 */
function setAgente(agente) {
  estado.autenticado = !!agente;
  estado.agenteNombre = agente?.nombre || null;
  actualizarHeader();
  if (screen) screen.render();
}

/**
 * Actualiza el workspace vinculado
 */
function setWorkspace(workspace) {
  estado.workspaceNombre = workspace?.nombre || null;
  actualizarHeader();
  if (screen) screen.render();
}

/**
 * Actualiza la lista de registradores
 */
function setRegistradores(registradores) {
  estado.registradores = registradores.map((r) => ({
    id: r.id,
    nombre: r.nombre || r.ubicacion || 'Sin nombre',
    ip: r.ip,
    puerto: r.puerto,
    indiceInicial: r.indice_inicial || r.indiceInicial || 0,
    cantRegistros: r.cantidad_registros || r.cantidadRegistros || 10,
    intervalo: r.intervalo_segundos || r.intervaloSegundos || 60,
    activo: r.activo !== false,
    estado: r.activo ? 'espera' : 'inactivo',
    proximaLectura: null,
    ultimaLectura: null,
  }));

  actualizarRegistradores();
  if (screen) screen.render();
}

/**
 * Actualiza el estado de un registrador específico
 */
function actualizarRegistrador(id, datos) {
  const reg = estado.registradores.find((r) => r.id === id);
  if (reg) {
    Object.assign(reg, datos);
    actualizarRegistradores();
    if (screen) screen.render();
  }
}

/**
 * Renderiza la pantalla completa
 */
function renderizar() {
  actualizarHeader();
  actualizarRegistradores();
  actualizarLogs();
  actualizarFooter();
  if (screen) screen.render();
}

/**
 * Destruye la pantalla (para limpieza al salir)
 */
function destruir() {
  if (screen) {
    screen.destroy();
    screen = null;
  }
}

/**
 * Inicia un intervalo para actualizar el tiempo activo
 */
function iniciarReloj() {
  setInterval(() => {
    actualizarFooter();
    if (screen) screen.render();
  }, 1000);
}

module.exports = {
  inicializar,
  log,
  setConectado,
  setAgente,
  setWorkspace,
  setRegistradores,
  actualizarRegistrador,
  renderizar,
  destruir,
  iniciarReloj,
  estado,
};
