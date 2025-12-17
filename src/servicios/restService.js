// src/servicios/restService.js
// Servicio de comunicación REST con el backend (reemplaza WebSocket y Supabase directo)

// URL del backend (configurable via .env)
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Clave secreta del agente (obligatoria)
const CLAVE_SECRETA = process.env.CLAVE_SECRETA;

// Intervalo de polling para configuración (ms) - cada 10 segundos
const CONFIG_POLL_INTERVAL = parseInt(process.env.CONFIG_POLL_INTERVAL_MS) || 10000;

// Intervalo de polling para tests pendientes (ms) - cada 5 segundos
const TESTS_POLL_INTERVAL = parseInt(process.env.TESTS_POLL_INTERVAL_MS) || 5000;

// Intervalo de heartbeat (ms)
const HEARTBEAT_INTERVAL = 30000;

// Estado del servicio
let token = null;
let agenteData = null;
let workspacesData = [];
let conectado = false;
let heartbeatIntervalId = null;
let configPollIntervalId = null;
let testsPollIntervalId = null;

// Callbacks para eventos
let callbacks = {
  onConectado: null,
  onAutenticado: null,
  onDesconectado: null,
  onError: null,
  onLog: null,
  onVinculado: null,
  onConfiguracionCambiada: null,
  onTestPendiente: null,
};

// Última configuración conocida (para detectar cambios)
let ultimaConfigHash = null;

/**
 * Función auxiliar para logging
 */
function log(mensaje, tipo = 'info') {
  if (callbacks.onLog) {
    callbacks.onLog(mensaje, tipo);
  } else {
    console.log(`[REST] ${mensaje}`);
  }
}

/**
 * Realiza una petición HTTP al backend
 */
async function fetchBackend(endpoint, options = {}) {
  const url = `${BACKEND_URL}/api${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Agregar token si existe y no es la ruta de auth
  if (token && !endpoint.includes('/agente/auth')) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      // Si el token expiró, intentar re-autenticar
      if (response.status === 401 && data.code === 'TOKEN_EXPIRED') {
        log('Token expirado, re-autenticando...', 'advertencia');
        const reauth = await autenticar();
        if (reauth) {
          // Reintentar la petición original con el nuevo token
          headers['Authorization'] = `Bearer ${token}`;
          const retryResponse = await fetch(url, { ...options, headers });
          return await retryResponse.json();
        }
      }
      throw new Error(data.error || `Error HTTP ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      conectado = false;
      if (callbacks.onDesconectado) {
        callbacks.onDesconectado('Sin conexión al backend');
      }
    }
    throw error;
  }
}

/**
 * Autentica el agente con la clave secreta
 */
async function autenticar() {
  if (!CLAVE_SECRETA) {
    log('ERROR: Falta la variable CLAVE_SECRETA en .env', 'error');
    return false;
  }

  try {
    log('Autenticando agente...', 'info');

    const data = await fetchBackend('/agente/auth', {
      method: 'POST',
      body: JSON.stringify({ claveSecreta: CLAVE_SECRETA }),
    });

    if (data.exito) {
      token = data.token;
      agenteData = data.agente;
      workspacesData = data.workspaces || [];
      conectado = true;

      log(`Autenticado como: ${agenteData.nombre}`, 'exito');

      if (data.advertencia) {
        log(`ADVERTENCIA: ${data.advertencia}`, 'advertencia');
      }

      return true;
    } else {
      log(`Error de autenticación: ${data.error}`, 'error');
      return false;
    }
  } catch (error) {
    log(`Error conectando al backend: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Envía heartbeat al backend
 */
async function enviarHeartbeat() {
  if (!token) return;

  try {
    const version = process.env.npm_package_version || '1.0.0';
    await fetchBackend('/agente/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ version }),
    });
  } catch (error) {
    // Los errores de heartbeat no son críticos, solo logear
    log(`Error en heartbeat: ${error.message}`, 'advertencia');
  }
}

/**
 * Obtiene la configuración (registradores) del agente
 * @param {boolean} esInicial - Si es la carga inicial, establece el hash base
 */
async function obtenerConfiguracion(esInicial = false) {
  if (!token) {
    throw new Error('No autenticado');
  }

  const data = await fetchBackend('/agente/config', {
    method: 'GET',
  });

  // Si es la carga inicial, establecer el hash base para evitar falsos positivos
  if (esInicial && data.registradores) {
    ultimaConfigHash = hashConfiguracion(data.registradores);
    ultimosRegistradoresIds = new Set(data.registradores.map(r => r.id));
    ultimosRegistradoresActivos = new Map(data.registradores.map(r => [r.id, r.activo]));
    log('Hash de configuración inicial establecido', 'info');
  }

  return data;
}

/**
 * Envía lecturas al backend
 */
async function enviarLecturas(lecturas) {
  if (!token) {
    throw new Error('No autenticado');
  }

  if (!lecturas || lecturas.length === 0) {
    return { ok: true, insertadas: 0 };
  }

  const data = await fetchBackend('/agente/lecturas', {
    method: 'POST',
    body: JSON.stringify({ lecturas }),
  });

  return data;
}

/**
 * Envía un log al backend
 */
async function enviarLog(nivel, mensaje, metadata = {}) {
  if (!token) return;

  try {
    await fetchBackend('/agente/log', {
      method: 'POST',
      body: JSON.stringify({ nivel, mensaje, metadata }),
    });
  } catch (error) {
    // Los errores de log no son críticos
    console.error('[REST] Error enviando log:', error.message);
  }
}

/**
 * Obtiene tests de conexión pendientes para este agente
 */
async function obtenerTestsPendientes() {
  if (!token) {
    throw new Error('No autenticado');
  }

  const data = await fetchBackend('/agente/tests-pendientes', {
    method: 'GET',
  });

  return data || [];
}

/**
 * Reporta el resultado de un test de conexión
 */
async function reportarResultadoTest(testId, resultado) {
  if (!token) {
    throw new Error('No autenticado');
  }

  const data = await fetchBackend(`/agente/tests/${testId}/resultado`, {
    method: 'POST',
    body: JSON.stringify(resultado),
  });

  return data;
}

/**
 * Vincula el agente a un workspace usando código
 */
async function vincularWorkspace(codigo) {
  if (!token) {
    throw new Error('No autenticado');
  }

  const data = await fetchBackend('/agente/vincular', {
    method: 'POST',
    body: JSON.stringify({ codigo }),
  });

  if (data.exito && data.workspace) {
    workspacesData.push(data.workspace);
    if (callbacks.onVinculado) {
      callbacks.onVinculado(data.workspace);
    }
  }

  return data;
}

/**
 * Genera un hash simple de la configuración para detectar cambios
 */
function hashConfiguracion(registradores) {
  // Ordenar por ID para asegurar consistencia
  const ordenados = [...registradores].sort((a, b) => {
    const idA = a.id || '';
    const idB = b.id || '';
    return idA.localeCompare(idB);
  });

  return JSON.stringify(ordenados.map(r => ({
    id: r.id,
    activo: r.activo,
    intervaloSegundos: r.intervaloSegundos,
    ip: r.ip,
    puerto: r.puerto,
    indiceInicial: r.indiceInicial,
    cantidadRegistros: r.cantidadRegistros,
  })));
}

/**
 * Polling de configuración para detectar cambios
 * IMPORTANTE: NO reinicia las lecturas en curso.
 * Solo detecta cambios estructurales (nuevos registradores, eliminados, o cambios de activo)
 */
async function pollConfiguracion() {
  if (!token) return;

  try {
    const config = await obtenerConfiguracion();
    const registradores = config.registradores || [];
    const nuevoHash = hashConfiguracion(registradores);

    // Solo procesar si ya teníamos un hash previo Y es diferente
    if (ultimaConfigHash !== null && ultimaConfigHash !== nuevoHash) {
      // Detectar qué tipo de cambio ocurrió
      const cambio = detectarTipoCambio(ultimaConfigHash, nuevoHash, registradores);

      if (cambio.requiereReinicio) {
        // Solo reiniciar si hay nuevos registradores, eliminados, o cambios de activo
        log(`Cambio estructural detectado: ${cambio.razon}`, 'info');
        if (callbacks.onConfiguracionCambiada) {
          callbacks.onConfiguracionCambiada(registradores);
        }
      } else {
        // Cambios menores (intervalo, nombre, etc.) - actualizar en caliente sin reiniciar
        log(`Cambio menor detectado: ${cambio.razon} (no reinicia lecturas)`, 'info');
        if (callbacks.onConfiguracionActualizada) {
          callbacks.onConfiguracionActualizada(registradores);
        }
      }
    }

    ultimaConfigHash = nuevoHash;
  } catch (error) {
    log(`Error obteniendo configuración: ${error.message}`, 'advertencia');
  }
}

// Cache del último set de IDs y estados activos para detectar cambios estructurales
let ultimosRegistradoresIds = new Set();
let ultimosRegistradoresActivos = new Map();

/**
 * Detecta si el cambio requiere reiniciar el polling o no
 */
function detectarTipoCambio(hashAnterior, hashNuevo, registradoresNuevos) {
  const idsNuevos = new Set(registradoresNuevos.map(r => r.id));
  const activosNuevos = new Map(registradoresNuevos.map(r => [r.id, r.activo]));

  // Verificar si hay nuevos registradores
  for (const id of idsNuevos) {
    if (!ultimosRegistradoresIds.has(id)) {
      ultimosRegistradoresIds = idsNuevos;
      ultimosRegistradoresActivos = activosNuevos;
      return { requiereReinicio: true, razon: 'nuevo registrador agregado' };
    }
  }

  // Verificar si se eliminaron registradores
  for (const id of ultimosRegistradoresIds) {
    if (!idsNuevos.has(id)) {
      ultimosRegistradoresIds = idsNuevos;
      ultimosRegistradoresActivos = activosNuevos;
      return { requiereReinicio: true, razon: 'registrador eliminado' };
    }
  }

  // Verificar si cambió el estado activo de algún registrador
  for (const [id, activoNuevo] of activosNuevos) {
    const activoAnterior = ultimosRegistradoresActivos.get(id);
    if (activoAnterior !== undefined && activoAnterior !== activoNuevo) {
      ultimosRegistradoresIds = idsNuevos;
      ultimosRegistradoresActivos = activosNuevos;
      return { requiereReinicio: true, razon: `registrador ${activoNuevo ? 'activado' : 'desactivado'}` };
    }
  }

  // Si llegamos aquí, son cambios menores (intervalo, nombre, IP, etc.)
  ultimosRegistradoresIds = idsNuevos;
  ultimosRegistradoresActivos = activosNuevos;
  return { requiereReinicio: false, razon: 'cambio de configuración menor' };
}

/**
 * Inicia el heartbeat periódico
 */
function iniciarHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
  }

  // Enviar heartbeat inmediatamente
  enviarHeartbeat();

  // Configurar intervalo
  heartbeatIntervalId = setInterval(enviarHeartbeat, HEARTBEAT_INTERVAL);
  log('Heartbeat iniciado (cada 30s)', 'info');
}

/**
 * Inicia el polling de configuración
 */
function iniciarConfigPolling() {
  if (configPollIntervalId) {
    clearInterval(configPollIntervalId);
  }

  // Configurar intervalo
  configPollIntervalId = setInterval(pollConfiguracion, CONFIG_POLL_INTERVAL);
  log(`Polling de configuración iniciado (cada ${CONFIG_POLL_INTERVAL / 1000}s)`, 'ciclo');
}

/**
 * Polling de tests pendientes
 */
async function pollTestsPendientes() {
  if (!token) return;

  try {
    const tests = await obtenerTestsPendientes();

    if (tests && tests.length > 0) {
      for (const test of tests) {
        log(`Test de conexión pendiente recibido: ${test.ip}:${test.puerto}`, 'info');

        // Notificar al callback para que index.js ejecute el test
        if (callbacks.onTestPendiente) {
          callbacks.onTestPendiente(test);
        }
      }
    }
  } catch (error) {
    // Los errores de polling no son críticos
    if (!error.message.includes('No autenticado')) {
      log(`Error obteniendo tests pendientes: ${error.message}`, 'advertencia');
    }
  }
}

/**
 * Inicia el polling de tests pendientes
 */
function iniciarTestsPolling() {
  if (testsPollIntervalId) {
    clearInterval(testsPollIntervalId);
  }

  // Configurar intervalo
  testsPollIntervalId = setInterval(pollTestsPendientes, TESTS_POLL_INTERVAL);
  log(`Polling de tests iniciado (cada ${TESTS_POLL_INTERVAL / 1000}s)`, 'ciclo');
}

/**
 * Detiene todos los intervalos
 */
function detenerIntervalos() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  if (configPollIntervalId) {
    clearInterval(configPollIntervalId);
    configPollIntervalId = null;
  }
  if (testsPollIntervalId) {
    clearInterval(testsPollIntervalId);
    testsPollIntervalId = null;
  }
}

/**
 * Inicia la conexión REST al backend
 */
async function iniciarConexion(opciones = {}) {
  // Configurar callbacks
  if (opciones.onConectado) callbacks.onConectado = opciones.onConectado;
  if (opciones.onAutenticado) callbacks.onAutenticado = opciones.onAutenticado;
  if (opciones.onDesconectado) callbacks.onDesconectado = opciones.onDesconectado;
  if (opciones.onError) callbacks.onError = opciones.onError;
  if (opciones.onLog) callbacks.onLog = opciones.onLog;
  if (opciones.onVinculado) callbacks.onVinculado = opciones.onVinculado;
  if (opciones.onRegistradoresActualizar) callbacks.onConfiguracionCambiada = opciones.onRegistradoresActualizar;
  if (opciones.onTestPendiente) callbacks.onTestPendiente = opciones.onTestPendiente;

  log(`Conectando a backend: ${BACKEND_URL}`, 'info');

  // Autenticar
  const exito = await autenticar();

  if (exito) {
    if (callbacks.onConectado) callbacks.onConectado();
    if (callbacks.onAutenticado) callbacks.onAutenticado(agenteData);

    // Notificar workspaces vinculados
    if (workspacesData.length > 0 && callbacks.onVinculado) {
      callbacks.onVinculado(workspacesData[0]);
    }

    // Iniciar heartbeat y polling
    iniciarHeartbeat();
    iniciarConfigPolling();
    iniciarTestsPolling();
  } else {
    if (callbacks.onError) {
      callbacks.onError(new Error('No se pudo autenticar'));
    }
  }

  return exito;
}

/**
 * Cierra la conexión REST
 */
function cerrarConexion() {
  detenerIntervalos();
  token = null;
  agenteData = null;
  conectado = false;
  ultimaConfigHash = null;
  log('Conexión REST cerrada', 'info');
}

/**
 * Verifica si está conectado
 */
function estaConectado() {
  return conectado && token !== null;
}

/**
 * Verifica si está autenticado
 */
function estaAutenticado() {
  return token !== null && agenteData !== null;
}

/**
 * Obtiene los datos del agente autenticado
 */
function obtenerDatosAgente() {
  return agenteData;
}

/**
 * Obtiene los workspaces vinculados
 */
function obtenerWorkspaces() {
  return workspacesData;
}

module.exports = {
  iniciarConexion,
  cerrarConexion,
  estaConectado,
  estaAutenticado,
  obtenerDatosAgente,
  obtenerWorkspaces,
  obtenerConfiguracion,
  enviarLecturas,
  enviarLog,
  vincularWorkspace,
  reportarResultadoTest,
  BACKEND_URL,
};
