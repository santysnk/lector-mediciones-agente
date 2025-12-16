// src/servicios/restService.js
// Servicio de comunicación REST con el backend (reemplaza WebSocket y Supabase directo)

// URL del backend (configurable via .env)
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Clave secreta del agente (obligatoria)
const CLAVE_SECRETA = process.env.CLAVE_SECRETA;

// Intervalo de polling para configuración (ms)
const CONFIG_POLL_INTERVAL = parseInt(process.env.CONFIG_POLL_INTERVAL_MS) || 30000;

// Intervalo de heartbeat (ms)
const HEARTBEAT_INTERVAL = 30000;

// Estado del servicio
let token = null;
let agenteData = null;
let workspacesData = [];
let conectado = false;
let heartbeatIntervalId = null;
let configPollIntervalId = null;

// Callbacks para eventos
let callbacks = {
  onConectado: null,
  onAutenticado: null,
  onDesconectado: null,
  onError: null,
  onLog: null,
  onVinculado: null,
  onConfiguracionCambiada: null,
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
 */
async function obtenerConfiguracion() {
  if (!token) {
    throw new Error('No autenticado');
  }

  const data = await fetchBackend('/agente/config', {
    method: 'GET',
  });

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
  return JSON.stringify(registradores.map(r => ({
    id: r.id,
    activo: r.activo,
    intervaloSegundos: r.intervaloSegundos,
    ip: r.ip,
    puerto: r.puerto,
  })));
}

/**
 * Polling de configuración para detectar cambios
 */
async function pollConfiguracion() {
  if (!token) return;

  try {
    const config = await obtenerConfiguracion();
    const nuevoHash = hashConfiguracion(config.registradores || []);

    if (ultimaConfigHash !== null && ultimaConfigHash !== nuevoHash) {
      log('Configuración cambiada, notificando...', 'info');
      if (callbacks.onConfiguracionCambiada) {
        callbacks.onConfiguracionCambiada(config.registradores);
      }
    }

    ultimaConfigHash = nuevoHash;
  } catch (error) {
    log(`Error obteniendo configuración: ${error.message}`, 'advertencia');
  }
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
  log(`Polling de configuración iniciado (cada ${CONFIG_POLL_INTERVAL / 1000}s)`, 'info');
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
  BACKEND_URL,
};
