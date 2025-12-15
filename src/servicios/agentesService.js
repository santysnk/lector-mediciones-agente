// src/servicios/agentesService.js
// Servicio para operaciones del agente en Supabase

const supabase = require('../config/supabase');

/**
 * Actualiza el nombre del agente en la base de datos
 * @param {string} agenteId - ID del agente
 * @param {string} nuevoNombre - Nuevo nombre para el agente
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function cambiarNombre(agenteId, nuevoNombre) {
  try {
    const { error } = await supabase
      .from('agentes')
      .update({ nombre: nuevoNombre })
      .eq('id', agenteId);

    if (error) {
      console.error('[AgentesService] Error actualizando nombre:', error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    console.error('[AgentesService] Error:', error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  cambiarNombre,
};
