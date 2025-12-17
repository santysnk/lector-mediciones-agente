// src/modbus/clienteModbus.js
// Cliente Modbus para leer registros de dispositivos

const ModbusRTU = require('modbus-serial');

/**
 * Lee registros holding de un dispositivo Modbus TCP
 *
 * @param {Object} config - Configuración de lectura
 * @param {string} config.ip - Dirección IP del dispositivo
 * @param {number} config.puerto - Puerto Modbus (usualmente 502)
 * @param {number} config.indiceInicial - Primer registro a leer
 * @param {number} config.cantRegistros - Cantidad de registros a leer
 * @param {number} config.unitId - ID de unidad Modbus (por defecto 1)
 * @returns {Promise<Array<number>|null>} Array de valores o null si hay error
 */
async function leerRegistrosModbus({ ip, puerto, indiceInicial, cantRegistros, unitId = 1 }) {
  const inicio = Number(indiceInicial);
  const cantidad = Number(cantRegistros);
  const puertoNum = Number(puerto);

  // Validación básica
  if (!ip || !puertoNum || Number.isNaN(inicio) || Number.isNaN(cantidad) || cantidad <= 0) {
    console.warn(`[Modbus] Parámetros inválidos: ip=${ip}, puerto=${puertoNum}, inicio=${inicio}, cantidad=${cantidad}`);
    return null;
  }

  const cliente = new ModbusRTU();

  try {
    // Conectar al dispositivo
    await cliente.connectTCP(ip, { port: puertoNum });
    cliente.setID(unitId);
    cliente.setTimeout(5000); // 5 segundos de timeout

    // Leer registros holding
    const respuesta = await cliente.readHoldingRegisters(inicio, cantidad);

    return respuesta.data;
  } catch (error) {
    console.error(`[Modbus] Error leyendo ${ip}:${puertoNum} - ${error.message}`);
    throw error;
  } finally {
    // Siempre cerrar la conexión
    try {
      cliente.close();
    } catch (e) {
      // Ignorar errores al cerrar
    }
  }
}

/**
 * Prueba la conexión a un dispositivo Modbus TCP y lee registros
 * Lee los registros especificados y devuelve los valores
 *
 * @param {Object} config - Configuración de conexión
 * @param {string} config.ip - Dirección IP del dispositivo
 * @param {number} config.puerto - Puerto Modbus (usualmente 502)
 * @param {number} config.unitId - ID de unidad Modbus (por defecto 1)
 * @param {number} config.indiceInicial - Primer registro a leer (por defecto 0)
 * @param {number} config.cantRegistros - Cantidad de registros a leer (por defecto 10)
 * @returns {Promise<{exito: boolean, error?: string, tiempoMs?: number, registros?: Array}>}
 */
async function testConexionModbus({ ip, puerto, unitId = 1, indiceInicial = 0, cantRegistros = 10 }) {
  const puertoNum = Number(puerto);
  const inicio = Number(indiceInicial) || 0;
  const cantidad = Number(cantRegistros) || 10;

  // Validación básica
  if (!ip || !puertoNum) {
    return {
      exito: false,
      error: 'IP y puerto son requeridos',
    };
  }

  const cliente = new ModbusRTU();
  const tiempoInicio = Date.now();

  try {
    // Intentar conectar con timeout de 5 segundos
    await cliente.connectTCP(ip, { port: puertoNum });
    cliente.setID(unitId);
    cliente.setTimeout(5000);

    // Leer los registros especificados
    const respuesta = await cliente.readHoldingRegisters(inicio, cantidad);

    const tiempoMs = Date.now() - tiempoInicio;

    // Formatear los registros para la respuesta
    const registros = respuesta.data.map((valor, i) => ({
      indice: i,
      direccion: inicio + i,
      valor: valor,
    }));

    return {
      exito: true,
      tiempoMs,
      mensaje: `Conexión exitosa en ${tiempoMs}ms`,
      registros,
    };
  } catch (error) {
    const tiempoMs = Date.now() - tiempoInicio;

    return {
      exito: false,
      error: error.message || 'Error de conexión desconocido',
      tiempoMs,
    };
  } finally {
    try {
      cliente.close();
    } catch (e) {
      // Ignorar errores al cerrar
    }
  }
}

module.exports = { leerRegistrosModbus, testConexionModbus };
