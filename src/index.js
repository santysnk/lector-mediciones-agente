// src/index.js
// Punto de entrada del Agente de Lecturas Modbus

require('dotenv').config();

const { leerRegistrosModbus, MODO_MODBUS } = require('./modbus/clienteModbus');
const { obtenerRegistradoresPorAgente, guardarLectura } = require('./servicios/registradoresService');
const { cambiarNombre } = require('./servicios/agentesService');
const {
  iniciarConexion,
  cerrarConexion,
  obtenerDatosAgente,
  BACKEND_URL,
} = require('./servicios/websocketService');
// Interfaz: 'web' para navegador, 'terminal' para blessed
const INTERFAZ = process.env.INTERFAZ || 'web';
const terminal = INTERFAZ === 'terminal'
  ? require('./ui/terminal')
  : require('./ui/webServer');

// Configuración
const CLAVE_SECRETA = process.env.CLAVE_SECRETA;

// Estado del agente
let registradoresCache = [];
let cicloActivo = false;
let intervalosLectura = new Map(); // Map de registradorId -> intervalId
let contadoresProxLectura = new Map(); // Map de registradorId -> segundos restantes
let contadorIntervalId = null;

/**
 * Carga los registradores desde Supabase
 */
async function cargarRegistradores() {
  const agente = obtenerDatosAgente();

  if (!agente || !agente.id) {
    terminal.log('No hay agente autenticado para cargar registradores', 'advertencia');
    return [];
  }

  terminal.log('Cargando registradores desde Supabase...', 'info');

  const registradores = await obtenerRegistradoresPorAgente(agente.id);

  if (registradores.length === 0) {
    terminal.log('No hay registradores configurados para este agente', 'advertencia');
  } else {
    const activos = registradores.filter(r => r.activo).length;
    terminal.log(`${registradores.length} registrador(es) cargados (${activos} activos)`, 'exito');
  }

  registradoresCache = registradores;
  terminal.setRegistradores(registradores);

  return registradores;
}

/**
 * Lee un registrador Modbus y guarda la lectura
 */
async function leerRegistrador(registrador) {
  const inicio = Date.now();

  try {
    terminal.actualizarRegistrador(registrador.id, { estado: 'leyendo' });

    const valores = await leerRegistrosModbus({
      ip: registrador.ip,
      puerto: registrador.puerto,
      indiceInicial: registrador.indice_inicial,
      cantRegistros: registrador.cantidad_registros,
      unitId: registrador.unit_id || 1,
    });

    const tiempoMs = Date.now() - inicio;

    // Guardar en Supabase
    const resultado = await guardarLectura(
      registrador.tabla_lecturas,
      registrador.id,
      valores,
      registrador.indice_inicial
    );

    if (resultado.exito) {
      terminal.actualizarRegistrador(registrador.id, { estado: 'activo' });
      terminal.log(
        `${registrador.nombre}: ${valores.length} registros (${tiempoMs}ms)`,
        'exito'
      );
    } else {
      terminal.actualizarRegistrador(registrador.id, { estado: 'error' });
      terminal.log(
        `${registrador.nombre}: Error guardando - ${resultado.error}`,
        'error'
      );
    }

    return { exito: true, valores };

  } catch (error) {
    terminal.actualizarRegistrador(registrador.id, { estado: 'error' });
    terminal.log(
      `${registrador.nombre}: ${error.message}`,
      'error'
    );
    return { exito: false, error: error.message };
  }
}

/**
 * Inicia el ciclo de polling para todos los registradores
 */
function iniciarPolling() {
  if (cicloActivo) {
    terminal.log('El ciclo de polling ya está activo', 'advertencia');
    return;
  }

  if (registradoresCache.length === 0) {
    terminal.log('No hay registradores para monitorear', 'advertencia');
    return;
  }

  cicloActivo = true;

  // Filtrar solo registradores activos para polling
  const registradoresActivos = registradoresCache.filter((r) => r.activo);

  if (registradoresActivos.length === 0) {
    terminal.log('No hay registradores activos para polling', 'advertencia');
    return;
  }

  terminal.log(`Iniciando polling de ${registradoresActivos.length} registrador(es) activo(s)...`, 'ciclo');

  // Crear un intervalo por cada registrador ACTIVO según su configuración
  registradoresActivos.forEach((reg) => {
    const intervaloSegundos = reg.intervalo_segundos || 60;
    const intervaloMs = intervaloSegundos * 1000;

    // Inicializar contador de próxima lectura
    contadoresProxLectura.set(reg.id, intervaloSegundos);
    terminal.actualizarRegistrador(reg.id, { proximaLectura: intervaloSegundos });

    // Primera lectura inmediata
    leerRegistrador(reg);

    // Configurar intervalo para lecturas subsiguientes
    const intervalId = setInterval(() => {
      if (cicloActivo) {
        leerRegistrador(reg);
        contadoresProxLectura.set(reg.id, intervaloSegundos);
        terminal.actualizarRegistrador(reg.id, { proximaLectura: intervaloSegundos });
      }
    }, intervaloMs);

    intervalosLectura.set(reg.id, intervalId);
  });

  // Actualizar contadores cada segundo (solo para IDs en contadoresProxLectura)
  contadorIntervalId = setInterval(() => {
    if (!cicloActivo) return;

    contadoresProxLectura.forEach((segundos, regId) => {
      if (segundos > 0) {
        const nuevoValor = segundos - 1;
        contadoresProxLectura.set(regId, nuevoValor);
        terminal.actualizarRegistrador(regId, { proximaLectura: nuevoValor });
      }
    });
  }, 1000);
}

/**
 * Detiene el ciclo de polling
 */
function detenerPolling() {
  cicloActivo = false;

  intervalosLectura.forEach((intervalId) => {
    clearInterval(intervalId);
  });
  intervalosLectura.clear();
  contadoresProxLectura.clear();

  if (contadorIntervalId) {
    clearInterval(contadorIntervalId);
    contadorIntervalId = null;
  }

  terminal.log('Polling detenido', 'advertencia');
}

/**
 * Función principal
 */
async function main() {
  // Validar configuración
  if (!CLAVE_SECRETA) {
    console.error('\n[ERROR FATAL] Falta la variable CLAVE_SECRETA en el archivo .env\n');
    console.error('Debes configurar la clave secreta del agente.\n');
    process.exit(1);
  }

  // Inicializar interfaz de terminal
  terminal.inicializar({
    onRecargar: async () => {
      terminal.log('Recargando registradores...', 'ciclo');
      detenerPolling();
      await cargarRegistradores();
      iniciarPolling();
    },
    onSalir: () => {
      terminal.log('Cerrando agente...', 'advertencia');
      detenerPolling();
      cerrarConexion();
    },
    onCambiarNombre: async (agenteId, nuevoNombre) => {
      return await cambiarNombre(agenteId, nuevoNombre);
    },
  });

  // Iniciar reloj de tiempo activo
  terminal.iniciarReloj();

  // Log inicial
  terminal.log(`Modo Modbus: ${MODO_MODBUS}`, 'info');
  terminal.log(`Conectando al backend: ${BACKEND_URL}`, 'info');

  // Iniciar conexión WebSocket al backend
  iniciarConexion({
    onConectado: () => {
      terminal.setConectado(true);
      terminal.log('Conectado al backend via WebSocket', 'exito');
    },
    onAutenticado: async (agente) => {
      terminal.setAgente(agente);
      terminal.log(`Autenticado como: ${agente.nombre}`, 'exito');

      // Cargar registradores e iniciar polling
      await cargarRegistradores();

      if (registradoresCache.length > 0) {
        iniciarPolling();
      }
    },
    onVinculado: (workspace) => {
      terminal.setWorkspace(workspace);
      terminal.log(`Workspace vinculado: ${workspace.nombre}`, 'exito');
    },
    onDesconectado: (reason) => {
      terminal.setConectado(false);
      terminal.log(`Desconectado del backend: ${reason}`, 'advertencia');
    },
    onError: (error) => {
      terminal.log(`Error: ${error.message}`, 'error');
    },
    onLog: (mensaje, tipo) => {
      terminal.log(`[WS] ${mensaje}`, tipo);
    },
    onRegistradoresActualizar: async () => {
      // Recargar registradores cuando cambian desde el frontend
      terminal.log('Recargando registradores (cambio desde frontend)...', 'ciclo');
      detenerPolling();
      await cargarRegistradores();
      iniciarPolling();
    },
  });
}

// Manejar señales de terminación
process.on('SIGINT', () => {
  terminal.log('Recibida señal SIGINT...', 'advertencia');
  detenerPolling();
  cerrarConexion();
  terminal.destruir();
  setTimeout(() => process.exit(0), 500);
});

process.on('SIGTERM', () => {
  terminal.log('Recibida señal SIGTERM...', 'advertencia');
  detenerPolling();
  cerrarConexion();
  terminal.destruir();
  setTimeout(() => process.exit(0), 500);
});

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  console.error(`[ERROR FATAL] Error no capturado: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  terminal.log(`Promesa rechazada: ${reason}`, 'error');
});

// Ejecutar
main().catch((error) => {
  console.error(`[ERROR FATAL] ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
