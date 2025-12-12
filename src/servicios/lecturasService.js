// src/servicios/lecturasService.js
// Servicio para guardar lecturas en Supabase

const supabase = require('../config/supabase');

/**
 * Guarda una lectura en la base de datos
 *
 * @param {Object} lectura - Datos de la lectura
 * @param {string} lectura.alimentador_id - UUID del alimentador
 * @param {string} lectura.tipo_dispositivo - "rele" o "analizador"
 * @param {Array<number>} lectura.valores - Array de valores de registros
 * @returns {Promise<boolean>} true si se guardó correctamente
 */
async function guardarLectura({ alimentador_id, tipo_dispositivo, valores }) {
  const { error } = await supabase.from('lecturas').insert({
    alimentador_id,
    tipo: tipo_dispositivo,
    valores,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    console.error(`[Lecturas] Error guardando lectura: ${error.message}`);
    return false;
  }

  return true;
}

/**
 * Guarda múltiples lecturas en batch
 *
 * @param {Array<Object>} lecturas - Array de lecturas
 * @returns {Promise<{exitosas: number, fallidas: number}>}
 */
async function guardarLecturasBatch(lecturas) {
  if (!lecturas || lecturas.length === 0) {
    return { exitosas: 0, fallidas: 0 };
  }

  const ahora = new Date().toISOString();

  // Preparar registros con timestamp
  const registros = lecturas.map((l) => ({
    alimentador_id: l.alimentador_id,
    tipo: l.tipo_dispositivo,
    valores: l.valores,
    timestamp: ahora,
  }));

  const { error } = await supabase.from('lecturas').insert(registros);

  if (error) {
    console.error(`[Lecturas] Error en batch insert: ${error.message}`);
    return { exitosas: 0, fallidas: lecturas.length };
  }

  return { exitosas: lecturas.length, fallidas: 0 };
}

module.exports = { guardarLectura, guardarLecturasBatch };
