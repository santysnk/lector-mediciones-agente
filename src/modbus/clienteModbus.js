// src/modbus/clienteModbus.js
// Cliente Modbus para leer registros de dispositivos

const ModbusRTU = require('modbus-serial');

const MODO_MODBUS = process.env.MODO_MODBUS || 'simulado';

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

  // === MODO SIMULADO ===
  if (MODO_MODBUS === 'simulado') {
    // Generar valores aleatorios para pruebas
    const valores = Array.from({ length: cantidad }, () =>
      Math.floor(Math.random() * 501)
    );
    return valores;
  }

  // === MODO REAL ===
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
    return null;
  } finally {
    // Siempre cerrar la conexión
    try {
      cliente.close();
    } catch (e) {
      // Ignorar errores al cerrar
    }
  }
}

module.exports = { leerRegistrosModbus, MODO_MODBUS };
