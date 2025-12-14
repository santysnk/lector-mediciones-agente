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
    cursor: {
      artificial: true,
      shape: 'line',
      blink: true,
      color: null,
    },
  });

  // ========== HEADER ==========
  headerBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: {
      fg: 'white',
      bg: 'blue',
    },
  });

  // ========== REGISTRADORES ==========
  registradoresBox = blessed.box({
    top: 3,
    left: 0,
    width: '100%',
    height: '50%-3',
    border: {
      type: 'line',
    },
    tags: true,
    label: ' REGISTRADORES ',
    style: {
      fg: 'white',
      border: {
        fg: 'cyan',
      },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: {
        fg: 'cyan',
      },
    },
  });

  // ========== LOG ==========
  logBox = blessed.box({
    top: '50%',
    left: 0,
    width: '100%',
    height: '50%-1',
    border: {
      type: 'line',
    },
    tags: true,
    label: ' LOG ',
    style: {
      fg: 'white',
      border: {
        fg: 'green',
      },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: {
        fg: 'green',
      },
    },
  });

  // ========== FOOTER ==========
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
    width: 25,
    height: 8,
    border: {
      type: 'line',
    },
    tags: true,
    label: ' MENÚ ',
    style: {
      fg: 'white',
      bg: 'black',
      border: {
        fg: 'yellow',
      },
      selected: {
        fg: 'black',
        bg: 'cyan',
      },
    },
    keys: true,
    vi: false,
    items: [
      '  Recargar registradores',
      '  Estado',
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
  log('═══════════════════════════════════════', 'info');
  log(`  Agente: ${estado.agenteNombre || 'No autenticado'}`, 'info');
  log(`  Workspace: ${estado.workspaceNombre || 'No vinculado'}`, 'info');
  log(`  Conectado: ${estado.conectado ? 'Sí' : 'No'}`, estado.conectado ? 'exito' : 'error');
  log(`  Registradores: ${estado.registradores.length}`, 'info');
  log(`  Tiempo activo: ${formatearTiempoActivo()}`, 'info');
  log('═══════════════════════════════════════', 'info');
}

function mostrarAyuda() {
  log('═══════════════════════════════════════', 'info');
  log('  ATAJOS DE TECLADO:', 'info');
  log('  [m] Abrir/cerrar menú', 'info');
  log('  [q] Salir del agente', 'info');
  log('  [Ctrl+C] Salir del agente', 'info');
  log('  [Esc] Cerrar menú', 'info');
  log('  [↑↓] Navegar menú', 'info');
  log('  [Enter] Seleccionar opción', 'info');
  log('═══════════════════════════════════════', 'info');
}

// ============================================
// Actualización de componentes
// ============================================

function actualizarHeader() {
  if (!headerBox) return;

  const estadoConexion = estado.conectado
    ? '{green-fg}● Conectado{/green-fg}'
    : '{red-fg}● Desconectado{/red-fg}';

  const titulo = '{bold}AGENTE MODBUS{/bold}';
  const menu = '{yellow-fg}[m] Menú{/yellow-fg}';

  // Línea 1: título y estado
  const linea1 = `  ${titulo}                    Backend: ${estadoConexion}        ${menu}  `;

  // Línea 2: agente y workspace
  const agente = estado.agenteNombre
    ? `{cyan-fg}${estado.agenteNombre}{/cyan-fg}`
    : '{gray-fg}Sin autenticar{/gray-fg}';
  const workspace = estado.workspaceNombre
    ? `{cyan-fg}${estado.workspaceNombre}{/cyan-fg}`
    : '{gray-fg}Sin vincular{/gray-fg}';

  const linea2 = `  Agente: ${agente}    Workspace: ${workspace}`;

  headerBox.setContent(`\n${linea1}\n${linea2}`);
}

function actualizarRegistradores() {
  if (!registradoresBox) return;

  if (estado.registradores.length === 0) {
    registradoresBox.setContent('\n  {gray-fg}No hay registradores configurados{/gray-fg}');
    return;
  }

  let contenido = '\n';

  estado.registradores.forEach((reg) => {
    const icono = reg.estado === 'activo'
      ? '{green-fg}●{/green-fg}'
      : reg.estado === 'error'
        ? '{red-fg}●{/red-fg}'
        : '{gray-fg}○{/gray-fg}';

    const nombre = reg.nombre.padEnd(12);
    const ip = `${reg.ip}:${reg.puerto}`.padEnd(20);
    const registros = `[${reg.indiceInicial}-${reg.indiceInicial + reg.cantRegistros - 1}]`.padEnd(12);

    const proxLectura = reg.proximaLectura
      ? `Próx: ${reg.proximaLectura}s`
      : '-----';

    const estadoTexto = reg.estado === 'activo'
      ? '{green-fg}[Activo]{/green-fg}'
      : reg.estado === 'error'
        ? '{red-fg}[Error]{/red-fg}'
        : '{gray-fg}[Espera]{/gray-fg}';

    contenido += `  ${icono} ${nombre} ${ip} ${registros} ${proxLectura.padEnd(12)} ${estadoTexto}\n`;
  });

  registradoresBox.setContent(contenido);
}

function actualizarLogs() {
  if (!logBox) return;

  if (estado.logs.length === 0) {
    logBox.setContent('\n  {gray-fg}Sin actividad{/gray-fg}');
    return;
  }

  // Mostrar los últimos logs (más recientes arriba)
  const logsTexto = estado.logs
    .slice(0, 20)
    .map((log) => `  ${log}`)
    .join('\n');

  logBox.setContent('\n' + logsTexto);
  logBox.setScrollPerc(100);
}

function actualizarFooter() {
  if (!footerBox) return;

  const tiempo = formatearTiempoActivo();
  footerBox.setContent(`  Tiempo activo: ${tiempo}  |  Presiona [m] para menú  |  [q] Salir`);
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
  const timestamp = new Date().toLocaleTimeString();
  let prefijo = '';

  switch (tipo) {
    case 'exito':
      prefijo = '{green-fg}✓{/green-fg}';
      break;
    case 'error':
      prefijo = '{red-fg}✗{/red-fg}';
      break;
    case 'advertencia':
      prefijo = '{yellow-fg}!{/yellow-fg}';
      break;
    case 'ciclo':
      prefijo = '{cyan-fg}↻{/cyan-fg}';
      break;
    default:
      prefijo = '{white-fg}•{/white-fg}';
  }

  const linea = `{gray-fg}${timestamp}{/gray-fg}  ${prefijo} ${mensaje}`;
  estado.logs.unshift(linea);

  // Limitar cantidad de logs
  if (estado.logs.length > MAX_LOGS) {
    estado.logs = estado.logs.slice(0, MAX_LOGS);
  }

  actualizarLogs();
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
    estado: 'espera',
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
