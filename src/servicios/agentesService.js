// src/servicios/agentesService.js
// Servicio para operaciones del agente via REST

const { enviarLog } = require('./restService');

/**
 * Actualiza el nombre del agente
 * NOTA: Esta operación ahora debería hacerse desde el frontend.
 * El agente solo puede reportar logs al backend.
 * @param {string} agenteId - ID del agente
 * @param {string} nuevoNombre - Nuevo nombre para el agente
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function cambiarNombre(agenteId, nuevoNombre) {
  // Por seguridad, el agente no puede cambiar su propio nombre directamente
  // Esta operación debe hacerse desde el frontend con autenticación de usuario
  console.log('[AgentesService] Cambio de nombre debe hacerse desde el frontend');

  // Registrar intento en logs
  await enviarLog('info', `Intento de cambio de nombre a: ${nuevoNombre}`, { agenteId });

  return {
    ok: false,
    error: 'El cambio de nombre debe realizarse desde el panel de administración'
  };
}

module.exports = {
  cambiarNombre,
};
