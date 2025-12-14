// src/servicios/registradoresService.js
// Servicio para obtener registradores del agente desde Supabase

const supabase = require('../config/supabase');

/**
 * Obtiene todos los registradores asignados a un agente
 *
 * @param {string} agenteId - UUID del agente
 * @returns {Promise<Array>} Lista de registradores
 */
async function obtenerRegistradoresPorAgente(agenteId) {
  if (!agenteId) {
    console.error('[RegistradoresService] No se proporcionó agenteId');
    return [];
  }

  // Obtener TODOS los registradores (activos e inactivos)
  // El campo 'activo' indica si debe hacer polling, pero igual los mostramos
  const { data: registradores, error } = await supabase
    .from('registradores')
    .select('*')
    .eq('agente_id', agenteId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[RegistradoresService] Error obteniendo registradores:', error.message);
    return [];
  }

  return registradores || [];
}

/**
 * Guarda una lectura en la tabla dinámica del registrador
 *
 * @param {string} tablaLecturas - Nombre de la tabla (ej: "lecturas_terna_3_12345")
 * @param {string} registradorId - UUID del registrador
 * @param {Array<number>} valores - Array de valores leídos
 * @param {number} indiceInicial - Índice inicial del registrador
 */
async function guardarLectura(tablaLecturas, registradorId, valores, indiceInicial) {
  if (!tablaLecturas || !registradorId || !valores || valores.length === 0) {
    console.error('[RegistradoresService] Datos incompletos para guardar lectura');
    return { exito: false, error: 'Datos incompletos' };
  }

  // Construir objeto con las columnas (índices como nombres de columna)
  const datos = {
    registrador_id: registradorId,
  };

  valores.forEach((valor, i) => {
    const indice = indiceInicial + i;
    datos[indice.toString()] = valor;
  });

  // Usar RPC para insertar en tabla dinámica
  const columnas = Object.keys(datos).map((k) => `"${k}"`).join(', ');
  const valores_ = Object.values(datos).map((v) =>
    typeof v === 'string' ? `'${v}'` : v
  ).join(', ');

  const sql = `INSERT INTO "${tablaLecturas}" (${columnas}) VALUES (${valores_});`;

  const { error } = await supabase.rpc('exec_sql', { sql });

  if (error) {
    console.error('[RegistradoresService] Error guardando lectura:', error.message);
    return { exito: false, error: error.message };
  }

  return { exito: true };
}

module.exports = {
  obtenerRegistradoresPorAgente,
  guardarLectura,
};
