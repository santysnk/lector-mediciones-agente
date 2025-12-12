// src/servidor/httpServer.js
// Servidor HTTP para recibir peticiones de test de conexión Modbus

const http = require('http');
const { testConexionModbus } = require('../modbus/clienteModbus');

const PUERTO_HTTP = Number(process.env.PUERTO_HTTP) || 3002;

let servidor = null;

/**
 * Parsea el body JSON de una request
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Envía una respuesta JSON
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Handler para POST /test-conexion
 */
async function handleTestConexion(req, res) {
  try {
    const { ip, puerto, unitId } = await parseBody(req);

    // Validar parámetros requeridos
    if (!ip || !puerto) {
      return sendJSON(res, 400, {
        exito: false,
        error: 'Se requiere ip y puerto',
      });
    }

    console.log(`[HTTP] Test de conexión solicitado: ${ip}:${puerto}`);

    // Ejecutar test de conexión real
    const resultado = await testConexionModbus({
      ip,
      puerto: Number(puerto),
      unitId: Number(unitId) || 1,
    });

    if (resultado.exito) {
      console.log(`[HTTP] Conexión exitosa a ${ip}:${puerto}`);
      sendJSON(res, 200, resultado);
    } else {
      console.log(`[HTTP] Conexión fallida a ${ip}:${puerto}: ${resultado.error}`);
      sendJSON(res, 200, resultado);
    }
  } catch (error) {
    console.error('[HTTP] Error procesando test de conexión:', error.message);
    sendJSON(res, 500, {
      exito: false,
      error: error.message,
    });
  }
}

/**
 * Inicia el servidor HTTP
 */
function iniciarServidorHTTP(callback) {
  servidor = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    // Enrutamiento
    if (req.method === 'POST' && req.url === '/test-conexion') {
      return handleTestConexion(req, res);
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      return sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // 404 para otras rutas
    sendJSON(res, 404, { error: 'Ruta no encontrada' });
  });

  servidor.listen(PUERTO_HTTP, () => {
    console.log(`[HTTP] Servidor de test escuchando en puerto ${PUERTO_HTTP}`);
    if (callback) callback();
  });

  servidor.on('error', (error) => {
    console.error('[HTTP] Error del servidor:', error.message);
  });

  return servidor;
}

/**
 * Detiene el servidor HTTP
 */
function detenerServidorHTTP() {
  if (servidor) {
    servidor.close();
    servidor = null;
  }
}

module.exports = {
  iniciarServidorHTTP,
  detenerServidorHTTP,
  PUERTO_HTTP,
};
