// src/servicios/alimentadoresService.js
// Servicio para obtener alimentadores de Supabase

const supabase = require('../config/supabase');

/**
 * Obtiene todos los alimentadores de una configuración
 *
 * @param {string} configuracionId - UUID de la configuración
 * @returns {Promise<Array>} Lista de alimentadores con datos de puesto
 */
async function obtenerAlimentadores(configuracionId) {
  // Primero obtener los puestos de la configuración
  const { data: puestos, error: errorPuestos } = await supabase
    .from('puestos')
    .select('id, nombre')
    .eq('configuracion_id', configuracionId)
    .order('orden');

  if (errorPuestos) {
    console.error('[Service] Error obteniendo puestos:', errorPuestos.message);
    return [];
  }

  if (!puestos || puestos.length === 0) {
    console.warn('[Service] No hay puestos configurados para esta configuración');
    return [];
  }

  // Obtener alimentadores de todos los puestos
  const puestoIds = puestos.map((p) => p.id);

  const { data: alimentadores, error: errorAlim } = await supabase
    .from('alimentadores')
    .select('*')
    .in('puesto_id', puestoIds)
    .order('orden');

  if (errorAlim) {
    console.error('[Service] Error obteniendo alimentadores:', errorAlim.message);
    return [];
  }

  // Agregar nombre del puesto a cada alimentador
  const puestosMap = Object.fromEntries(puestos.map((p) => [p.id, p.nombre]));

  return (alimentadores || []).map((alim) => ({
    ...alim,
    nombrePuesto: puestosMap[alim.puesto_id] || 'Sin puesto',
  }));
}

module.exports = { obtenerAlimentadores };
