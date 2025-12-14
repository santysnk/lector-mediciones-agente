// src/ui/webServer.js
// Servidor HTTP local para interfaz web del agente

const http = require('http');

// Puerto para la interfaz web (configurable via .env)
const WEB_PORT = process.env.WEB_PORT || 8080;

// Estado global compartido
const estado = {
  conectado: false,
  autenticado: false,
  agenteNombre: null,
  workspaceNombre: null,
  registradores: [],
  logs: [],
  iniciado: null,
};

const MAX_LOGS = 100;

let server = null;

// ============================================
// HTML Template
// ============================================

function generarHTML() {
  const tiempoActivo = formatearTiempoActivo();
  const estadoConexion = estado.conectado ? 'Conectado' : 'Desconectado';
  const estadoClase = estado.conectado ? 'conectado' : 'desconectado';

  const registradoresHTML = estado.registradores.length === 0
    ? '<tr><td colspan="6" class="empty">No hay registradores configurados</td></tr>'
    : estado.registradores.map(reg => {
        let estadoClase = 'espera';
        if (reg.estado === 'inactivo') estadoClase = 'inactivo';
        else if (reg.estado === 'activo' || reg.estado === 'leyendo') estadoClase = 'activo';
        else if (reg.estado === 'error') estadoClase = 'error';

        const proxLectura = reg.estado === 'inactivo' ? '---' :
          (reg.proximaLectura !== null ? `${reg.proximaLectura}s` : '---');

        return `
          <tr class="${estadoClase}">
            <td>${reg.nombre || 'Sin nombre'}</td>
            <td>${reg.ip}:${reg.puerto}</td>
            <td>[${reg.indiceInicial}-${reg.indiceInicial + reg.cantRegistros - 1}]</td>
            <td>${reg.intervalo}s</td>
            <td>${proxLectura}</td>
            <td><span class="badge ${estadoClase}">${reg.estado || 'espera'}</span></td>
          </tr>
        `;
      }).join('');

  const logsHTML = estado.logs.length === 0
    ? '<div class="log-entry info">Sin logs todavía...</div>'
    : estado.logs.map(log => `
        <div class="log-entry ${log.tipo}">
          <span class="timestamp">${log.timestamp}</span>
          <span class="mensaje">${escapeHTML(log.mensaje)}</span>
        </div>
      `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="2">
  <title>Agente Modbus</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }

    /* Header */
    .header {
      background: #16213e;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid #0f3460;
    }
    .header h1 {
      color: #00d9ff;
      margin-bottom: 15px;
      font-size: 1.5rem;
    }
    .status-bar {
      display: flex;
      gap: 30px;
      flex-wrap: wrap;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-item .label { color: #888; }
    .status-item .value { font-weight: 600; }
    .status-item .value.conectado { color: #00ff88; }
    .status-item .value.desconectado { color: #ff4757; }
    .status-item .value.info { color: #00d9ff; }

    /* Registradores */
    .section {
      background: #16213e;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid #0f3460;
    }
    .section h2 {
      color: #00d9ff;
      margin-bottom: 15px;
      font-size: 1.2rem;
      border-bottom: 1px solid #0f3460;
      padding-bottom: 10px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #0f3460;
    }
    th { color: #888; font-weight: 500; }
    tr:hover { background: #1a1a3e; }
    .empty { color: #666; text-align: center; padding: 30px; }

    .badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.activo { background: #00ff8820; color: #00ff88; }
    .badge.inactivo { background: #88888820; color: #888; }
    .badge.error { background: #ff475720; color: #ff4757; }
    .badge.espera { background: #ffa50020; color: #ffa500; }
    .badge.leyendo { background: #00d9ff20; color: #00d9ff; }

    /* Logs */
    .logs-container {
      max-height: 400px;
      overflow-y: auto;
      background: #0d1117;
      border-radius: 4px;
      padding: 10px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.85rem;
    }
    .log-entry {
      padding: 4px 8px;
      border-radius: 2px;
      margin-bottom: 2px;
    }
    .log-entry .timestamp {
      color: #666;
      margin-right: 10px;
    }
    .log-entry.exito .mensaje { color: #00ff88; }
    .log-entry.error .mensaje { color: #ff4757; }
    .log-entry.advertencia .mensaje { color: #ffa500; }
    .log-entry.ciclo .mensaje { color: #00d9ff; }
    .log-entry.info .mensaje { color: #ccc; }

    /* Footer */
    .footer {
      text-align: center;
      color: #666;
      padding: 20px;
      font-size: 0.85rem;
    }

    /* Auto-refresh indicator */
    .refresh-indicator {
      position: fixed;
      top: 10px;
      right: 10px;
      background: #0f3460;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.75rem;
      color: #00d9ff;
    }
  </style>
</head>
<body>
  <div class="refresh-indicator">Auto-refresh: 2s</div>

  <div class="container">
    <div class="header">
      <h1>🔌 Agente Modbus</h1>
      <div class="status-bar">
        <div class="status-item">
          <span class="label">Backend:</span>
          <span class="value ${estadoClase}">${estadoConexion}</span>
        </div>
        <div class="status-item">
          <span class="label">Agente:</span>
          <span class="value info">${estado.agenteNombre || '---'}</span>
        </div>
        <div class="status-item">
          <span class="label">Workspace:</span>
          <span class="value info">${estado.workspaceNombre || 'Sin vincular'}</span>
        </div>
        <div class="status-item">
          <span class="label">Tiempo activo:</span>
          <span class="value info">${tiempoActivo}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>📊 Registradores (${estado.registradores.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>IP:Puerto</th>
            <th>Registros</th>
            <th>Intervalo</th>
            <th>Próx. Lectura</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${registradoresHTML}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>📝 Log (últimos ${estado.logs.length} mensajes)</h2>
      <div class="logs-container">
        ${logsHTML}
      </div>
    </div>

    <div class="footer">
      Agente Modbus v1.0 | Puerto web: ${WEB_PORT} | Presiona Ctrl+C en la terminal para detener
    </div>
  </div>
</body>
</html>`;
}

// ============================================
// Utilidades
// ============================================

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearTiempoActivo() {
  if (!estado.iniciado) return '--:--:--';

  const diff = Math.floor((Date.now() - estado.iniciado.getTime()) / 1000);
  const horas = Math.floor(diff / 3600).toString().padStart(2, '0');
  const minutos = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
  const segundos = (diff % 60).toString().padStart(2, '0');

  return `${horas}:${minutos}:${segundos}`;
}

// ============================================
// Servidor HTTP
// ============================================

function inicializar(opciones = {}) {
  estado.iniciado = new Date();

  server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generarHTML());
    } else if (req.url === '/api/estado') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(estado));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(WEB_PORT, () => {
    console.log(`[WebUI] Interfaz web disponible en http://localhost:${WEB_PORT}`);
  });

  return server;
}

// ============================================
// API pública (compatible con terminal.js)
// ============================================

function log(mensaje, tipo = 'info') {
  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });

  estado.logs.unshift({ timestamp, mensaje, tipo });

  // Limitar cantidad de logs
  if (estado.logs.length > MAX_LOGS) {
    estado.logs = estado.logs.slice(0, MAX_LOGS);
  }

  // También imprimir en consola para el .bat
  const prefijos = {
    exito: '[+]',
    error: '[!]',
    advertencia: '[!]',
    ciclo: '[>]',
    info: '[-]',
  };
  console.log(`${timestamp} ${prefijos[tipo] || '[-]'} ${mensaje}`);
}

function setConectado(conectado) {
  estado.conectado = conectado;
}

function setAgente(agente) {
  estado.autenticado = !!agente;
  estado.agenteNombre = agente?.nombre || null;
}

function setWorkspace(workspace) {
  estado.workspaceNombre = workspace?.nombre || null;
}

function setRegistradores(registradores) {
  estado.registradores = registradores.map((r) => ({
    id: r.id,
    nombre: r.nombre || r.ubicacion || 'Sin nombre',
    ip: r.ip,
    puerto: r.puerto,
    indiceInicial: r.indice_inicial || r.indiceInicial || 0,
    cantRegistros: r.cantidad_registros || r.cantidadRegistros || 10,
    intervalo: r.intervalo_segundos || r.intervaloSegundos || 60,
    activo: r.activo !== false,
    estado: r.activo ? 'espera' : 'inactivo',
    proximaLectura: null,
    ultimaLectura: null,
  }));
}

function actualizarRegistrador(id, datos) {
  const reg = estado.registradores.find((r) => r.id === id);
  if (reg) {
    Object.assign(reg, datos);
  }
}

function renderizar() {
  // No necesario para web, se actualiza al refrescar
}

function destruir() {
  if (server) {
    server.close();
    server = null;
    console.log('[WebUI] Servidor web cerrado');
  }
}

function iniciarReloj() {
  // No necesario para web, el tiempo se calcula en cada request
}

module.exports = {
  inicializar,
  log,
  setConectado,
  setAgente,
  setWorkspace,
  setRegistradores,
  actualizarRegistrador,
  renderizar,
  destruir,
  iniciarReloj,
  estado,
};
