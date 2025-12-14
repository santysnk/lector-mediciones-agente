// src/servicios/websocketService.js
// Servicio de conexión WebSocket al backend

const { io } = require('socket.io-client');
const { testConexionModbus } = require('../modbus/clienteModbus');

// URL del backend (configurable via .env)
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Clave secreta del agente (obligatoria)
const CLAVE_SECRETA = process.env.CLAVE_SECRETA;

// Estado de la conexión
let socket = null;
let conectado = false;
let autenticado = false;
let intentosReconexion = 0;
const MAX_INTENTOS = 10;

// Datos del agente autenticado
let agenteData = null;

// Intervalo del heartbeat (30 segundos)
const PING_INTERVAL = 30000;
let pingIntervalId = null;

// Callbacks para eventos (se setean desde index.js)
let onConectado = null;
let onAutenticado = null;
let onDesconectado = null;
let onError = null;
let onLog = null;
let onVinculado = null;
let onRegistradoresActualizar = null;

/**
 * Función auxiliar para logging
 */
function log(mensaje, tipo = 'info') {
  if (onLog) {
    onLog(mensaje, tipo);
  } else {
    console.log(`[WebSocket] ${mensaje}`);
  }
}

/**
 * Inicia la conexión WebSocket al backend
 */
function iniciarConexion(opciones = {}) {
  // Validar que existe la clave secreta
  if (!CLAVE_SECRETA) {
    log('ERROR: Falta la variable CLAVE_SECRETA en .env', 'error');
    if (opciones.onError) opciones.onError(new Error('Falta CLAVE_SECRETA'));
    return null;
  }

  // Configurar callbacks si se proporcionan
  if (opciones.onConectado) onConectado = opciones.onConectado;
  if (opciones.onAutenticado) onAutenticado = opciones.onAutenticado;
  if (opciones.onDesconectado) onDesconectado = opciones.onDesconectado;
  if (opciones.onError) onError = opciones.onError;
  if (opciones.onLog) onLog = opciones.onLog;
  if (opciones.onVinculado) onVinculado = opciones.onVinculado;
  if (opciones.onRegistradoresActualizar) onRegistradoresActualizar = opciones.onRegistradoresActualizar;

  log(`Conectando a backend: ${BACKEND_URL}`, 'info');

  socket = io(BACKEND_URL, {
    reconnection: true,
    reconnectionAttempts: MAX_INTENTOS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  // === Evento: Conexión establecida ===
  socket.on('connect', () => {
    conectado = true;
    autenticado = false;
    intentosReconexion = 0;
    log(`Conectado al backend (socket: ${socket.id})`, 'exito');

    // Autenticar el agente con la clave secreta
    log('Autenticando agente...', 'info');
    socket.emit('agente:autenticar', {
      claveSecreta: CLAVE_SECRETA,
    });

    if (onConectado) onConectado();
  });

  // === Evento: Resultado de autenticación ===
  socket.on('agente:autenticado', (datos) => {
    if (datos.exito) {
      autenticado = true;
      agenteData = datos.agente;
      log(`Autenticado como: ${datos.agente.nombre}`, 'exito');

      if (datos.advertencia) {
        log(`ADVERTENCIA: ${datos.advertencia}`, 'advertencia');
      }

      // Iniciar heartbeat (ping cada 30 segundos)
      iniciarHeartbeat();

      if (onAutenticado) onAutenticado(datos.agente);

      // Si hay workspace vinculado, notificar
      if (datos.workspace && onVinculado) {
        log(`Workspace vinculado: ${datos.workspace.nombre}`, 'exito');
        onVinculado(datos.workspace);
      }
    } else {
      autenticado = false;
      agenteData = null;
      log(`Error de autenticación: ${datos.error}`, 'error');

      if (onError) onError(new Error(datos.error));
    }
  });

  // === Evento: Respuesta al ping ===
  socket.on('agente:pong', () => {
    // El backend respondió al ping, conexión OK
  });

  // === Evento: Resultado de vinculación ===
  socket.on('agente:vinculado', (datos) => {
    if (datos.exito) {
      log(`Vinculado a workspace: ${datos.workspace.nombre}`, 'exito');
      if (onVinculado) onVinculado(datos.workspace);
    } else {
      log(`Error de vinculación: ${datos.error}`, 'error');
    }
  });

  // === Evento: Actualización de registradores desde el frontend ===
  socket.on('registradores:actualizar', (datos) => {
    const { agenteId, registradorId, activo } = datos;

    // Solo procesar si es para este agente
    if (agenteData && agenteData.id === agenteId) {
      log(`Registrador ${registradorId} ${activo ? 'activado' : 'desactivado'} desde frontend`, 'info');
      if (onRegistradoresActualizar) onRegistradoresActualizar(datos);
    }
  });

  // === Evento: Solicitud de test de conexión Modbus ===
  socket.on('modbus:test:solicitud', async (datos) => {
    const { requestId, ip, puerto, unitId, indiceInicial, cantRegistros } = datos;

    log(`Recibida solicitud de test: ${ip}:${puerto} (registros: ${indiceInicial}-${indiceInicial + cantRegistros})`, 'info');

    try {
      // Ejecutar el test de conexión Modbus con lectura de registros
      const resultado = await testConexionModbus({ ip, puerto, unitId, indiceInicial, cantRegistros });

      // Enviar respuesta al backend
      socket.emit('modbus:test:respuesta', {
        requestId,
        resultado,
      });

      if (resultado.exito) {
        log(`Test exitoso: ${ip}:${puerto} (${resultado.tiempoMs}ms)`, 'exito');
      } else {
        log(`Test fallido: ${ip}:${puerto} - ${resultado.error}`, 'error');
      }
    } catch (error) {
      // Enviar error al backend
      socket.emit('modbus:test:respuesta', {
        requestId,
        resultado: {
          exito: false,
          error: error.message || 'Error desconocido en test',
        },
      });

      log(`Error en test: ${error.message}`, 'error');
    }
  });

  // === Evento: Desconexión ===
  socket.on('disconnect', (reason) => {
    conectado = false;
    autenticado = false;
    detenerHeartbeat();
    log(`Desconectado del backend: ${reason}`, 'advertencia');

    if (onDesconectado) onDesconectado(reason);
  });

  // === Evento: Error de conexión ===
  socket.on('connect_error', (error) => {
    intentosReconexion++;
    log(`Error de conexión (intento ${intentosReconexion}/${MAX_INTENTOS}): ${error.message}`, 'error');

    if (onError) onError(error);
  });

  // === Evento: Reconexión exitosa ===
  socket.on('reconnect', (attemptNumber) => {
    log(`Reconectado al backend (intento ${attemptNumber})`, 'exito');
  });

  // === Evento: Fallo en reconexión ===
  socket.on('reconnect_failed', () => {
    log('No se pudo reconectar al backend después de múltiples intentos', 'error');
  });

  return socket;
}

/**
 * Inicia el heartbeat (ping periódico al backend)
 */
function iniciarHeartbeat() {
  // Limpiar intervalo anterior si existe
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
  }

  // Enviar ping inmediatamente
  if (socket && socket.connected) {
    socket.emit('agente:ping');
  }

  // Configurar ping cada 30 segundos
  pingIntervalId = setInterval(() => {
    if (socket && socket.connected && autenticado) {
      socket.emit('agente:ping');
    }
  }, PING_INTERVAL);

  log('Heartbeat iniciado (ping cada 30s)', 'info');
}

/**
 * Detiene el heartbeat
 */
function detenerHeartbeat() {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
}

/**
 * Cierra la conexión WebSocket
 */
function cerrarConexion() {
  detenerHeartbeat();

  if (socket) {
    socket.disconnect();
    socket = null;
    conectado = false;
    log('Conexión WebSocket cerrada', 'info');
  }
}

/**
 * Verifica si está conectado
 */
function estaConectado() {
  return conectado && socket && socket.connected;
}

/**
 * Verifica si está autenticado
 */
function estaAutenticado() {
  return autenticado && agenteData !== null;
}

/**
 * Obtiene los datos del agente autenticado
 */
function obtenerDatosAgente() {
  return agenteData;
}

/**
 * Obtiene el ID del socket actual
 */
function obtenerSocketId() {
  return socket ? socket.id : null;
}

/**
 * Envía un código de vinculación al backend
 * @param {string} codigo - Código de 8 caracteres (XXXX-XXXX)
 */
function enviarCodigoVinculacion(codigo) {
  if (!socket || !socket.connected) {
    log('No conectado al backend', 'error');
    return false;
  }

  if (!autenticado) {
    log('Agente no autenticado', 'error');
    return false;
  }

  log(`Enviando código de vinculación: ${codigo}`, 'info');
  socket.emit('agente:vincular', { codigo });
  return true;
}

module.exports = {
  iniciarConexion,
  cerrarConexion,
  estaConectado,
  estaAutenticado,
  obtenerDatosAgente,
  obtenerSocketId,
  enviarCodigoVinculacion,
  BACKEND_URL,
};
