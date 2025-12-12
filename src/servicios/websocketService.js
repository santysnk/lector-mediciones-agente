// src/servicios/websocketService.js
// Servicio de conexión WebSocket al backend

const { io } = require('socket.io-client');
const { testConexionModbus } = require('../modbus/clienteModbus');

// URL del backend (configurable via .env)
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Estado de la conexión
let socket = null;
let conectado = false;
let intentosReconexion = 0;
const MAX_INTENTOS = 10;

// Callbacks para eventos (se setean desde index.js)
let onConectado = null;
let onDesconectado = null;
let onError = null;
let onLog = null;

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
  const { agenteId, configuracionId } = opciones;

  // Configurar callbacks si se proporcionan
  if (opciones.onConectado) onConectado = opciones.onConectado;
  if (opciones.onDesconectado) onDesconectado = opciones.onDesconectado;
  if (opciones.onError) onError = opciones.onError;
  if (opciones.onLog) onLog = opciones.onLog;

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
    intentosReconexion = 0;
    log(`Conectado al backend (socket: ${socket.id})`, 'exito');

    // Registrar el agente
    socket.emit('agente:registrar', {
      agenteId: agenteId || `agente-${Date.now()}`,
      configuracionId,
    });

    if (onConectado) onConectado();
  });

  // === Evento: Agente registrado ===
  socket.on('agente:registrado', (datos) => {
    log(`Agente registrado en backend: ${datos.mensaje}`, 'exito');
  });

  // === Evento: Solicitud de test de conexión Modbus ===
  socket.on('modbus:test:solicitud', async (datos) => {
    const { requestId, ip, puerto, unitId } = datos;

    log(`Recibida solicitud de test: ${ip}:${puerto}`, 'info');

    try {
      // Ejecutar el test de conexión Modbus
      const resultado = await testConexionModbus({ ip, puerto, unitId });

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
 * Cierra la conexión WebSocket
 */
function cerrarConexion() {
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
 * Obtiene el ID del socket actual
 */
function obtenerSocketId() {
  return socket ? socket.id : null;
}

module.exports = {
  iniciarConexion,
  cerrarConexion,
  estaConectado,
  obtenerSocketId,
  BACKEND_URL,
};
