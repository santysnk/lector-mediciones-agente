// src/index.js
// Punto de entrada del Agente de Lecturas Modbus

require('dotenv').config();

const { leerRegistrosModbus } = require('./modbus/clienteModbus');
const { cambiarNombre } = require('./servicios/agentesService');
const {
  iniciarConexion,
  cerrarConexion,
  obtenerDatosAgente,
  obtenerConfiguracion,
  enviarLecturas,
  reportarResultadoTest,
  BACKEND_URL,
} = require('./servicios/restService');
const { testConexionModbus } = require('./modbus/clienteModbus');

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
let testsEnProceso = new Set(); // Para evitar ejecutar el mismo test múltiples veces

/**
 * Carga los registradores desde el backend via REST
 */
async function cargarRegistradores() {
  const agente = obtenerDatosAgente();

  if (!agente || !agente.id) {
    terminal.log('No hay agente autenticado para cargar registradores', 'advertencia');
    return [];
  }

  terminal.log('Cargando registradores desde el backend...', 'info');

  try {
    // Pasar true en la primera carga para establecer el hash base
    const esInicial = registradoresCache.length === 0;
    const config = await obtenerConfiguracion(esInicial);
    const registradores = config.registradores || [];

    if (registradores.length === 0) {
      terminal.log('No hay registradores configurados para este agente', 'advertencia');
    } else {
      const activos = registradores.filter(r => r.activo !== false).length;
      terminal.log(`${registradores.length} registrador(es) cargados (${activos} activos)`, 'exito');
    }

    // Transformar formato de respuesta al formato interno
    registradoresCache = registradores.map(r => ({
      id: r.id,
      nombre: r.nombre,
      tipo: r.tipo,
      ip: r.ip,
      puerto: r.puerto,
      unit_id: r.unitId,
      indice_inicial: r.indiceInicial,
      cantidad_registros: r.cantidadRegistros,
      intervalo_segundos: r.intervaloSegundos,
      timeout_ms: r.timeoutMs,
      activo: r.activo !== false,
      alimentador: r.alimentador,
    }));

    terminal.setRegistradores(registradoresCache);

    return registradoresCache;
  } catch (error) {
    terminal.log(`Error cargando registradores: ${error.message}`, 'error');
    return [];
  }
}

/**
 * Lee un registrador Modbus y envía la lectura al backend
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

    // Enviar lectura al backend via REST
    const resultado = await enviarLecturas([{
      registradorId: registrador.id,
      valores: Array.from(valores),
      tiempoMs,
      exito: true,
      timestamp: new Date().toISOString(),
    }]);

    if (resultado.ok) {
      terminal.actualizarRegistrador(registrador.id, { estado: 'activo' });
      // Log en sección de registradores (si está disponible)
      if (terminal.logRegistrador) {
        terminal.logRegistrador(registrador.id, `${registrador.nombre}: ${valores.length} registros (${tiempoMs}ms)`, true);
      } else {
        terminal.log(`${registrador.nombre}: ${valores.length} registros (${tiempoMs}ms)`, 'exito');
      }
    } else {
      terminal.actualizarRegistrador(registrador.id, { estado: 'error' });
      if (terminal.logRegistrador) {
        terminal.logRegistrador(registrador.id, `${registrador.nombre}: Error enviando lectura`, false);
      } else {
        terminal.log(`${registrador.nombre}: Error enviando lectura`, 'error');
      }
    }

    return { exito: true, valores };

  } catch (error) {
    const tiempoMs = Date.now() - inicio;

    // Reportar error al backend
    try {
      await enviarLecturas([{
        registradorId: registrador.id,
        valores: [],
        tiempoMs,
        exito: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }]);
    } catch (e) {
      // Ignorar errores al reportar el error
    }

    terminal.actualizarRegistrador(registrador.id, { estado: 'error' });
    if (terminal.logRegistrador) {
      terminal.logRegistrador(registrador.id, `${registrador.nombre}: ${error.message}`, false);
    } else {
      terminal.log(`${registrador.nombre}: ${error.message}`, 'error');
    }
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

  // Asegurar que el contador global esté corriendo
  asegurarContadorGlobal();
}

/**
 * Ejecuta un test de conexión Modbus y reporta el resultado
 */
async function ejecutarTestConexion(test) {
  // Evitar ejecutar el mismo test múltiples veces
  if (testsEnProceso.has(test.id)) {
    return;
  }

  testsEnProceso.add(test.id);

  terminal.log(`Ejecutando test: ${test.ip}:${test.puerto} (registros ${test.indice_inicial}-${test.indice_inicial + test.cantidad_registros - 1})`, 'ciclo');

  try {
    const resultado = await testConexionModbus({
      ip: test.ip,
      puerto: test.puerto,
      unitId: test.unit_id || 1,
      indiceInicial: test.indice_inicial,
      cantRegistros: test.cantidad_registros,
    });

    if (resultado.exito) {
      terminal.log(`Test exitoso: ${resultado.tiempoMs}ms - ${resultado.registros.length} registros`, 'exito');

      await reportarResultadoTest(test.id, {
        exito: true,
        tiempoRespuestaMs: resultado.tiempoMs,
        valores: resultado.registros.map(r => r.valor),
      });
    } else {
      terminal.log(`Test fallido: ${resultado.error}`, 'error');

      await reportarResultadoTest(test.id, {
        exito: false,
        tiempoRespuestaMs: resultado.tiempoMs,
        errorMensaje: resultado.error,
      });
    }
  } catch (error) {
    terminal.log(`Error ejecutando test: ${error.message}`, 'error');

    try {
      await reportarResultadoTest(test.id, {
        exito: false,
        errorMensaje: error.message,
      });
    } catch (e) {
      terminal.log(`Error reportando resultado: ${e.message}`, 'error');
    }
  } finally {
    testsEnProceso.delete(test.id);
  }
}

/**
 * Asegura que el contador global de segundos esté corriendo
 */
function asegurarContadorGlobal() {
  if (contadorIntervalId) return; // Ya está corriendo

  contadorIntervalId = setInterval(() => {
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
 * Inicia el polling de UN registrador específico
 */
function iniciarPollingRegistrador(reg) {
  if (!reg.activo) return;

  // Asegurar que cicloActivo esté en true y el contador global esté corriendo
  if (!cicloActivo) {
    cicloActivo = true;
    terminal.log('Ciclo de polling activado', 'ciclo');
  }
  asegurarContadorGlobal();

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
      // Obtener el intervalo actual del cache (puede haber cambiado)
      const regActual = registradoresCache.find(r => r.id === reg.id);
      if (regActual && regActual.activo) {
        leerRegistrador(regActual);
        const nuevoIntervalo = regActual.intervalo_segundos || 60;
        contadoresProxLectura.set(reg.id, nuevoIntervalo);
        terminal.actualizarRegistrador(reg.id, { proximaLectura: nuevoIntervalo });
      }
    }
  }, intervaloMs);

  intervalosLectura.set(reg.id, intervalId);
  terminal.log(`Polling iniciado para ${reg.nombre} (cada ${intervaloSegundos}s)`, 'ciclo');
}

/**
 * Detiene el polling de UN registrador específico
 */
function detenerPollingRegistrador(regId) {
  const intervalId = intervalosLectura.get(regId);
  if (intervalId) {
    clearInterval(intervalId);
    intervalosLectura.delete(regId);
    contadoresProxLectura.delete(regId);
    terminal.log(`Polling detenido para registrador ${regId}`, 'advertencia');
  }
}

/**
 * Actualiza los registradores de forma granular (sin reiniciar todo)
 */
async function actualizarRegistradoresGranular(registradoresNuevos) {
  if (!registradoresNuevos) return;

  // Transformar formato
  const nuevosTransformados = registradoresNuevos.map(r => ({
    id: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    ip: r.ip,
    puerto: r.puerto,
    unit_id: r.unitId,
    indice_inicial: r.indiceInicial,
    cantidad_registros: r.cantidadRegistros,
    intervalo_segundos: r.intervaloSegundos,
    timeout_ms: r.timeoutMs,
    activo: r.activo !== false,
    alimentador: r.alimentador,
  }));

  const idsNuevos = new Set(nuevosTransformados.map(r => r.id));
  const idsActuales = new Set(registradoresCache.map(r => r.id));

  // 1. Detectar registradores ELIMINADOS -> detener su polling
  for (const regActual of registradoresCache) {
    if (!idsNuevos.has(regActual.id)) {
      terminal.log(`Registrador eliminado: ${regActual.nombre}`, 'advertencia');
      detenerPollingRegistrador(regActual.id);
    }
  }

  // 2. Detectar registradores NUEVOS -> iniciar su polling si está activo
  for (const regNuevo of nuevosTransformados) {
    if (!idsActuales.has(regNuevo.id)) {
      terminal.log(`Nuevo registrador detectado: ${regNuevo.nombre}`, 'info');
      if (regNuevo.activo) {
        iniciarPollingRegistrador(regNuevo);
      }
    }
  }

  // 3. Detectar cambios de estado ACTIVO/INACTIVO
  for (const regNuevo of nuevosTransformados) {
    const regActual = registradoresCache.find(r => r.id === regNuevo.id);
    if (regActual) {
      // Cambió de activo a inactivo -> detener polling
      if (regActual.activo && !regNuevo.activo) {
        terminal.log(`Registrador desactivado: ${regNuevo.nombre}`, 'advertencia');
        detenerPollingRegistrador(regNuevo.id);
        terminal.actualizarRegistrador(regNuevo.id, { estado: 'inactivo' });
      }
      // Cambió de inactivo a activo -> iniciar polling
      else if (!regActual.activo && regNuevo.activo) {
        terminal.log(`Registrador activado: ${regNuevo.nombre}`, 'exito');
        iniciarPollingRegistrador(regNuevo);
      }
      // Cambió el intervalo -> se aplicará en el próximo ciclo automáticamente
      else if (regActual.intervalo_segundos !== regNuevo.intervalo_segundos) {
        terminal.log(`Intervalo cambiado para ${regNuevo.nombre}: ${regActual.intervalo_segundos}s -> ${regNuevo.intervalo_segundos}s (se aplicará en próximo ciclo)`, 'info');
      }
    }
  }

  // 4. Actualizar el cache con los nuevos datos
  registradoresCache = nuevosTransformados;
  terminal.setRegistradores(registradoresCache);
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
  terminal.log(`Conectando al backend: ${BACKEND_URL}`, 'info');

  // Iniciar conexión REST al backend
  iniciarConexion({
    onConectado: () => {
      terminal.setConectado(true);
      terminal.log('Conectado al backend via REST', 'exito');
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
      terminal.log(`[REST] ${mensaje}`, tipo);
    },
    onRegistradoresActualizar: async (registradoresNuevos) => {
      // Actualización granular: solo afecta a los registradores que cambiaron
      await actualizarRegistradoresGranular(registradoresNuevos);
    },
    onTestPendiente: (test) => {
      // Ejecutar test de conexión cuando se recibe uno pendiente
      ejecutarTestConexion(test);
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
