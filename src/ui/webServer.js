// src/ui/webServer.js
// Servidor HTTP local para interfaz web del agente

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Puerto para la interfaz web (configurable via .env)
const WEB_PORT = process.env.WEB_PORT || 8080;

// Ruta al archivo .env
const ENV_PATH = path.resolve(process.cwd(), '.env');

// Estado global compartido
const estado = {
  conectado: false,
  autenticado: false,
  agenteId: null,
  agenteNombre: null,
  workspaces: [], // Array de workspaces vinculados
  registradores: [],
  logs: [],
  logsRegistradores: [], // Log separado para lecturas de registradores
  estadisticasPorRegistrador: {}, // { registradorId: { exitosas: N, fallidas: N } }
  iniciado: null,
  claveConfigurada: !!process.env.CLAVE_SECRETA,
};

const MAX_LOGS = 100;
const MAX_LOGS_REGISTRADORES = 50;

let server = null;
let onSalir = null;
let onCambiarNombre = null;
let onReconectar = null;

// ============================================
// HTML Template
// ============================================

function generarHTML() {
  const tiempoActivo = formatearTiempoActivo();
  const estadoConexion = estado.conectado ? 'Conectado' : 'Desconectado';
  const estadoClase = estado.conectado ? 'conectado' : 'desconectado';

  // Mostrar workspaces vinculados
  const workspacesTexto = estado.workspaces.length === 0
    ? 'Sin vincular'
    : estado.workspaces.length === 1
      ? estado.workspaces[0].nombre
      : `${estado.workspaces.length} workspaces`;

  const registradoresHTML = estado.registradores.length === 0
    ? '<tr><td colspan="7" class="empty">No hay registradores configurados</td></tr>'
    : estado.registradores.map(reg => {
        let estadoClase = 'espera';
        if (reg.estado === 'inactivo') estadoClase = 'inactivo';
        else if (reg.estado === 'activo' || reg.estado === 'leyendo') estadoClase = 'activo';
        else if (reg.estado === 'error') estadoClase = 'error';

        const proxLectura = reg.estado === 'inactivo' ? '---' :
          (reg.proximaLectura !== null ? `${reg.proximaLectura}s` : '---');

        // Estadísticas individuales
        const stats = estado.estadisticasPorRegistrador[reg.id] || { exitosas: 0, fallidas: 0 };
        const statsHTML = `<span class="stats-mini"><span class="stat-ok">✓${stats.exitosas}</span> <span class="stat-err">✗${stats.fallidas}</span></span>`;

        return `
          <tr class="${estadoClase}">
            <td>${reg.nombre || 'Sin nombre'}</td>
            <td>${reg.ip}:${reg.puerto}</td>
            <td>[${reg.indiceInicial}-${reg.indiceInicial + reg.cantRegistros - 1}]</td>
            <td>${reg.intervalo}s</td>
            <td>${proxLectura}</td>
            <td>${statsHTML}</td>
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

  const logsRegistradoresHTML = estado.logsRegistradores.length === 0
    ? '<div class="log-entry info">Sin lecturas todavía...</div>'
    : estado.logsRegistradores.map(log => `
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
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .header h1 {
      color: #00d9ff;
      font-size: 1.5rem;
    }
    .btn-config {
      background: #0f3460;
      color: #00d9ff;
      border: 1px solid #00d9ff;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .btn-config:hover {
      background: #00d9ff;
      color: #16213e;
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
    .btn-editar {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 0.9rem;
      opacity: 0.6;
      transition: opacity 0.2s;
      padding: 2px 6px;
    }
    .btn-editar:hover { opacity: 1; }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #16213e;
      border-radius: 12px;
      padding: 24px;
      width: 90%;
      max-width: 500px;
      border: 1px solid #0f3460;
    }
    .modal h2 {
      color: #00d9ff;
      margin-bottom: 8px;
      font-size: 1.2rem;
    }
    .modal p {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 20px;
    }
    .modal-field {
      margin-bottom: 16px;
    }
    .modal-field label {
      display: block;
      color: #aaa;
      font-size: 0.85rem;
      margin-bottom: 6px;
    }
    .modal-field input {
      width: 100%;
      padding: 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #eee;
      font-size: 0.95rem;
      font-family: monospace;
    }
    .modal-field input:focus {
      outline: none;
      border-color: #00d9ff;
    }
    .modal-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 20px;
    }
    .modal-actions button {
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .btn-cancelar {
      background: transparent;
      border: 1px solid #666;
      color: #888;
    }
    .btn-cancelar:hover {
      border-color: #aaa;
      color: #aaa;
    }
    .btn-guardar {
      background: #00d9ff;
      border: none;
      color: #16213e;
      font-weight: 600;
    }
    .btn-guardar:hover {
      background: #00b8d9;
    }
    .btn-guardar:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .modal-error {
      background: #ff475720;
      border: 1px solid #ff4757;
      color: #ff4757;
      padding: 10px;
      border-radius: 6px;
      margin-top: 12px;
      font-size: 0.85rem;
      display: none;
    }
    .modal-success {
      background: #00ff8820;
      border: 1px solid #00ff88;
      color: #00ff88;
      padding: 10px;
      border-radius: 6px;
      margin-top: 12px;
      font-size: 0.85rem;
      display: none;
    }

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
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #0f3460;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .section-header h2 {
      margin-bottom: 0;
    }
    .btn-limpiar {
      background: #ff475730;
      color: #ff4757;
      border: 1px solid #ff4757;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s;
    }
    .btn-limpiar:hover {
      background: #ff475750;
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

    /* Estadísticas mini por registrador */
    .stats-mini {
      font-size: 0.85rem;
      font-weight: 500;
      display: inline-flex;
      gap: 8px;
    }
    .stats-mini .stat-ok { color: #00ff88; }
    .stats-mini .stat-err { color: #ff4757; }

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
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 20px;
      color: #666;
      padding: 20px;
      font-size: 0.85rem;
    }
    .btn-apagar {
      background: #ff475720;
      color: #ff4757;
      border: 1px solid #ff4757;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn-apagar:hover {
      background: #ff4757;
      color: #fff;
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
    .refresh-indicator.updating {
      color: #00ff88;
    }

    /* Sin clave configurada */
    .no-clave-banner {
      background: #ff475730;
      border: 1px solid #ff4757;
      color: #ff4757;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .no-clave-banner span { font-weight: 500; }

    /* Grid de dos columnas para logs */
    .logs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    /* Log de registradores */
    .logs-container-small {
      max-height: 300px;
      overflow-y: auto;
      background: #0d1117;
      border-radius: 4px;
      padding: 10px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="refresh-indicator">Auto-refresh: 2s</div>

  <!-- Modal de Configuración -->
  <div id="modal-config" class="modal-overlay">
    <div class="modal">
      <h2>Configurar Clave del Agente</h2>
      <p>Ingresa la clave secreta generada desde el Panel Admin del frontend.</p>

      <div class="modal-field">
        <label>Clave Secreta</label>
        <input type="text" id="input-clave" placeholder="Ej: 2f0f87f5d86134a3376cfb05524deb2fc..." autocomplete="off">
      </div>

      <div class="modal-field">
        <label>URL del Backend</label>
        <input type="text" id="input-backend" value="${process.env.BACKEND_URL || 'https://lector-mediciones-backend.onrender.com'}" placeholder="https://...">
      </div>

      <div id="modal-error" class="modal-error"></div>
      <div id="modal-success" class="modal-success"></div>

      <div class="modal-actions">
        <button class="btn-cancelar" onclick="cerrarModal()">Cancelar</button>
        <button id="btn-guardar-config" class="btn-guardar" onclick="guardarConfiguracion()">Guardar y Reiniciar</button>
      </div>
    </div>
  </div>

  <div class="container">
    ${!estado.claveConfigurada ? `
    <div class="no-clave-banner">
      <span>⚠️ No hay clave configurada. El agente no puede conectarse al backend.</span>
      <button class="btn-config" onclick="abrirModal()">Configurar Clave</button>
    </div>
    ` : ''}

    <div class="header">
      <div class="header-top">
        <h1>🔌 Agente Modbus</h1>
        <button class="btn-config" onclick="abrirModal()">⚙️ Configuración</button>
      </div>
      <div class="status-bar">
        <div class="status-item">
          <span class="label">Backend:</span>
          <span id="estado-conexion" class="value ${estadoClase}">${estadoConexion}</span>
        </div>
        <div class="status-item">
          <span class="label">Agente:</span>
          <span id="agente-nombre" class="value info">${estado.agenteNombre || '---'}</span>
          <button class="btn-editar" onclick="editarNombre()" title="Editar nombre">✏️</button>
        </div>
        <div class="status-item">
          <span class="label">Workspaces:</span>
          <span id="workspaces-info" class="value info">${workspacesTexto}</span>
        </div>
        <div class="status-item">
          <span class="label">Tiempo activo:</span>
          <span id="tiempo-activo" class="value info">${tiempoActivo}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>📊 Registradores (<span id="registradores-count">${estado.registradores.length}</span>)</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>IP:Puerto</th>
            <th>Registros</th>
            <th>Intervalo</th>
            <th>Próx. Lectura</th>
            <th>Lecturas</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody id="registradores-body">
          ${registradoresHTML}
        </tbody>
      </table>
    </div>

    <div class="logs-grid">
      <div class="section">
        <div class="section-header">
          <h2>📡 Log Registradores (<span id="logs-reg-count">${estado.logsRegistradores.length}</span>)</h2>
          <button class="btn-limpiar" onclick="limpiarLogsRegistradores()">🗑️ Limpiar</button>
        </div>
        <div id="logs-reg-container" class="logs-container-small">
          ${logsRegistradoresHTML}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>📝 Log Sistema (<span id="logs-count">${estado.logs.length}</span>)</h2>
          <button id="btn-limpiar-logs" class="btn-limpiar" onclick="limpiarLogs()">🗑️ Limpiar</button>
        </div>
        <div id="logs-container" class="logs-container-small">
          ${logsHTML}
        </div>
      </div>
    </div>

    <div class="footer">
      <button id="btn-apagar" class="btn-apagar" onclick="apagarAgente()">Apagar Agente</button>
      <span>Agente Modbus v2.0 | Puerto web: ${WEB_PORT}</span>
    </div>
  </div>

  <script>
    // Modal
    function abrirModal() {
      document.getElementById('modal-config').classList.add('active');
      document.getElementById('modal-error').style.display = 'none';
      document.getElementById('modal-success').style.display = 'none';
    }

    function cerrarModal() {
      document.getElementById('modal-config').classList.remove('active');
    }

    async function guardarConfiguracion() {
      const clave = document.getElementById('input-clave').value.trim();
      const backend = document.getElementById('input-backend').value.trim();
      const errorDiv = document.getElementById('modal-error');
      const successDiv = document.getElementById('modal-success');
      const btnGuardar = document.getElementById('btn-guardar-config');

      errorDiv.style.display = 'none';
      successDiv.style.display = 'none';

      if (!clave) {
        errorDiv.textContent = 'La clave secreta es requerida';
        errorDiv.style.display = 'block';
        return;
      }

      if (clave.length < 32) {
        errorDiv.textContent = 'La clave parece muy corta. Debe ser de al menos 64 caracteres.';
        errorDiv.style.display = 'block';
        return;
      }

      if (!backend) {
        errorDiv.textContent = 'La URL del backend es requerida';
        errorDiv.style.display = 'block';
        return;
      }

      btnGuardar.disabled = true;
      btnGuardar.textContent = 'Guardando...';

      try {
        const response = await fetch('/api/guardar-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clave, backend })
        });

        const resultado = await response.json();

        if (resultado.ok) {
          successDiv.textContent = 'Configuración guardada. Reiniciando agente...';
          successDiv.style.display = 'block';

          // Reiniciar después de 2 segundos
          setTimeout(() => {
            fetch('/api/reiniciar', { method: 'POST' });
          }, 2000);
        } else {
          errorDiv.textContent = resultado.error || 'Error al guardar';
          errorDiv.style.display = 'block';
          btnGuardar.disabled = false;
          btnGuardar.textContent = 'Guardar y Reiniciar';
        }
      } catch (error) {
        errorDiv.textContent = 'Error de conexión: ' + error.message;
        errorDiv.style.display = 'block';
        btnGuardar.disabled = false;
        btnGuardar.textContent = 'Guardar y Reiniciar';
      }
    }

    // Actualización sin recarga de página
    let ultimoLogCount = 0;
    let ultimoLogRegCount = 0;

    async function actualizarEstado() {
      try {
        const indicator = document.querySelector('.refresh-indicator');
        indicator.classList.add('updating');
        indicator.textContent = 'Actualizando...';

        const response = await fetch('/api/estado');
        const estado = await response.json();

        // Actualizar header
        document.getElementById('estado-conexion').textContent = estado.conectado ? 'Conectado' : 'Desconectado';
        document.getElementById('estado-conexion').className = 'value ' + (estado.conectado ? 'conectado' : 'desconectado');
        document.getElementById('agente-nombre').textContent = estado.agenteNombre || '---';

        // Actualizar workspaces
        const workspacesInfo = document.getElementById('workspaces-info');
        if (estado.workspaces && estado.workspaces.length > 0) {
          workspacesInfo.textContent = estado.workspaces.length === 1
            ? estado.workspaces[0].nombre
            : estado.workspaces.length + ' workspaces';
          workspacesInfo.title = estado.workspaces.map(w => w.nombre).join(', ');
        } else {
          workspacesInfo.textContent = 'Sin vincular';
          workspacesInfo.title = '';
        }

        document.getElementById('tiempo-activo').textContent = formatearTiempo(estado.iniciado);

        // Actualizar registradores
        document.getElementById('registradores-count').textContent = estado.registradores.length;
        document.getElementById('registradores-body').innerHTML = generarRegistradoresHTML(estado.registradores, estado.estadisticasPorRegistrador || {});

        // Actualizar logs del sistema SOLO si hay nuevos
        const logsContainer = document.getElementById('logs-container');
        if (estado.logs.length !== ultimoLogCount) {
          document.getElementById('logs-count').textContent = estado.logs.length;
          logsContainer.innerHTML = generarLogsHTML(estado.logs);
          ultimoLogCount = estado.logs.length;
        }

        // Actualizar logs de registradores SOLO si hay nuevos
        const logsRegContainer = document.getElementById('logs-reg-container');
        const logsRegistradores = estado.logsRegistradores || [];
        if (logsRegistradores.length !== ultimoLogRegCount) {
          document.getElementById('logs-reg-count').textContent = logsRegistradores.length;
          logsRegContainer.innerHTML = generarLogsHTML(logsRegistradores);
          ultimoLogRegCount = logsRegistradores.length;
        }

        indicator.classList.remove('updating');
        indicator.textContent = 'Auto-refresh: 2s';

      } catch (error) {
        console.error('Error actualizando:', error);
        document.querySelector('.refresh-indicator').textContent = 'Error de conexión';
      }
    }

    function formatearTiempo(iniciado) {
      if (!iniciado) return '--:--:--';
      const diff = Math.floor((Date.now() - new Date(iniciado).getTime()) / 1000);
      const horas = Math.floor(diff / 3600).toString().padStart(2, '0');
      const minutos = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const segundos = (diff % 60).toString().padStart(2, '0');
      return horas + ':' + minutos + ':' + segundos;
    }

    function generarRegistradoresHTML(registradores, estadisticasPorRegistrador) {
      if (registradores.length === 0) {
        return '<tr><td colspan="7" class="empty">No hay registradores configurados</td></tr>';
      }
      return registradores.map(reg => {
        let estadoClase = 'espera';
        if (reg.estado === 'inactivo') estadoClase = 'inactivo';
        else if (reg.estado === 'activo' || reg.estado === 'leyendo') estadoClase = 'activo';
        else if (reg.estado === 'error') estadoClase = 'error';

        const proxLectura = reg.estado === 'inactivo' ? '---' :
          (reg.proximaLectura !== null ? reg.proximaLectura + 's' : '---');

        // Estadísticas individuales
        const stats = estadisticasPorRegistrador[reg.id] || { exitosas: 0, fallidas: 0 };
        const statsHTML = '<span class="stats-mini"><span class="stat-ok">✓' + stats.exitosas + '</span> <span class="stat-err">✗' + stats.fallidas + '</span></span>';

        return '<tr class="' + estadoClase + '">' +
          '<td>' + (reg.nombre || 'Sin nombre') + '</td>' +
          '<td>' + reg.ip + ':' + reg.puerto + '</td>' +
          '<td>[' + reg.indiceInicial + '-' + (reg.indiceInicial + reg.cantRegistros - 1) + ']</td>' +
          '<td>' + reg.intervalo + 's</td>' +
          '<td>' + proxLectura + '</td>' +
          '<td>' + statsHTML + '</td>' +
          '<td><span class="badge ' + estadoClase + '">' + (reg.estado || 'espera') + '</span></td>' +
          '</tr>';
      }).join('');
    }

    function generarLogsHTML(logs) {
      if (logs.length === 0) {
        return '<div class="log-entry info"><span class="timestamp"></span><span class="mensaje">Sin logs todavía...</span></div>';
      }
      return logs.map(log =>
        '<div class="log-entry ' + log.tipo + '">' +
        '<span class="timestamp">' + log.timestamp + '</span>' +
        '<span class="mensaje">' + escapeHTML(log.mensaje) + '</span>' +
        '</div>'
      ).join('');
    }

    function escapeHTML(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Limpiar logs del sistema
    async function limpiarLogs() {
      try {
        const response = await fetch('/api/limpiar-logs', { method: 'POST' });
        if (response.ok) {
          document.getElementById('logs-container').innerHTML =
            '<div class="log-entry info"><span class="timestamp"></span><span class="mensaje">Logs limpiados</span></div>';
          document.getElementById('logs-count').textContent = '0';
          ultimoLogCount = 0;
        }
      } catch (error) {
        console.error('Error limpiando logs:', error);
      }
    }

    // Limpiar logs de registradores
    async function limpiarLogsRegistradores() {
      try {
        const response = await fetch('/api/limpiar-logs-registradores', { method: 'POST' });
        if (response.ok) {
          document.getElementById('logs-reg-container').innerHTML =
            '<div class="log-entry info"><span class="timestamp"></span><span class="mensaje">Logs limpiados</span></div>';
          document.getElementById('logs-reg-count').textContent = '0';
          ultimoLogRegCount = 0;
        }
      } catch (error) {
        console.error('Error limpiando logs de registradores:', error);
      }
    }

    // Apagar agente
    async function apagarAgente() {
      if (!confirm('¿Estás seguro de que quieres apagar el agente?')) return;

      try {
        document.getElementById('btn-apagar').disabled = true;
        document.getElementById('btn-apagar').textContent = 'Apagando...';
        await fetch('/api/apagar', { method: 'POST' });
        document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#ff4757;font-size:1.5rem;">Agente apagado. Puedes cerrar esta pestaña.</div>';
      } catch (error) {
        console.error('Error apagando:', error);
      }
    }

    // Editar nombre del agente
    async function editarNombre() {
      const nombreActual = document.getElementById('agente-nombre').textContent;
      const nuevoNombre = prompt('Ingresa el nuevo nombre del agente:', nombreActual);

      if (!nuevoNombre || nuevoNombre.trim() === '' || nuevoNombre === nombreActual) return;

      try {
        const response = await fetch('/api/cambiar-nombre', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: nuevoNombre.trim() })
        });

        const resultado = await response.json();

        if (resultado.ok) {
          document.getElementById('agente-nombre').textContent = nuevoNombre.trim();
          alert('Nombre actualizado correctamente');
        } else {
          alert('Error: ' + (resultado.error || 'No se pudo cambiar el nombre'));
        }
      } catch (error) {
        console.error('Error cambiando nombre:', error);
        alert('Error al cambiar el nombre');
      }
    }

    // Actualizar cada 2 segundos
    setInterval(actualizarEstado, 2000);
  </script>
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

/**
 * Guarda la configuración en el archivo .env
 */
function guardarEnv(clave, backend) {
  try {
    let contenido = '';

    // Leer .env existente si existe
    if (fs.existsSync(ENV_PATH)) {
      contenido = fs.readFileSync(ENV_PATH, 'utf8');
    }

    // Actualizar o agregar CLAVE_SECRETA
    if (contenido.includes('CLAVE_SECRETA=')) {
      contenido = contenido.replace(/CLAVE_SECRETA=.*/, `CLAVE_SECRETA=${clave}`);
    } else {
      contenido += `\nCLAVE_SECRETA=${clave}`;
    }

    // Actualizar o agregar BACKEND_URL
    if (contenido.includes('BACKEND_URL=')) {
      contenido = contenido.replace(/BACKEND_URL=.*/, `BACKEND_URL=${backend}`);
    } else {
      contenido += `\nBACKEND_URL=${backend}`;
    }

    // Asegurar que tenga INTERFAZ=web
    if (!contenido.includes('INTERFAZ=')) {
      contenido += `\nINTERFAZ=web`;
    }

    fs.writeFileSync(ENV_PATH, contenido.trim() + '\n');
    return true;
  } catch (error) {
    console.error('[WebUI] Error guardando .env:', error);
    return false;
  }
}

// ============================================
// Servidor HTTP
// ============================================

function inicializar(opciones = {}) {
  estado.iniciado = new Date();

  // Guardar callbacks
  if (opciones.onSalir) onSalir = opciones.onSalir;
  if (opciones.onCambiarNombre) onCambiarNombre = opciones.onCambiarNombre;
  if (opciones.onReconectar) onReconectar = opciones.onReconectar;

  server = http.createServer((req, res) => {
    // Página principal
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generarHTML());
    }
    // API: Estado actual
    else if (req.url === '/api/estado') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(estado));
    }
    // API: Limpiar logs del sistema
    else if (req.url === '/api/limpiar-logs' && req.method === 'POST') {
      estado.logs = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
    // API: Limpiar logs de registradores
    else if (req.url === '/api/limpiar-logs-registradores' && req.method === 'POST') {
      estado.logsRegistradores = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
    // API: Apagar
    else if (req.url === '/api/apagar' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      if (onSalir) {
        setTimeout(() => {
          onSalir();
          process.exit(0);
        }, 100);
      } else {
        setTimeout(() => process.exit(0), 100);
      }
    }
    // API: Cambiar nombre
    else if (req.url === '/api/cambiar-nombre' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { nombre } = JSON.parse(body);
          if (!nombre || nombre.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Nombre vacío' }));
            return;
          }
          if (!estado.agenteId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Agente no autenticado' }));
            return;
          }
          if (onCambiarNombre) {
            const resultado = await onCambiarNombre(estado.agenteId, nombre.trim());
            if (resultado.ok) {
              estado.agenteNombre = nombre.trim();
              log(`Nombre cambiado a: ${nombre.trim()}`, 'exito');
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resultado));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Función no disponible' }));
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
    }
    // API: Guardar configuración
    else if (req.url === '/api/guardar-config' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { clave, backend } = JSON.parse(body);

          if (!clave || clave.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Clave vacía' }));
            return;
          }

          const guardado = guardarEnv(clave.trim(), backend.trim());

          if (guardado) {
            estado.claveConfigurada = true;
            log('Configuración guardada en .env', 'exito');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Error escribiendo archivo .env' }));
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
    }
    // API: Reiniciar agente
    else if (req.url === '/api/reiniciar' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      log('Reiniciando agente...', 'advertencia');

      // Cerrar conexiones y reiniciar el proceso
      setTimeout(() => {
        if (onSalir) onSalir();

        // Reiniciar el proceso Node
        const args = process.argv.slice(1);
        const options = { stdio: 'inherit', detached: true };

        if (process.platform === 'win32') {
          exec(`start cmd /c "cd ${process.cwd()} && npm start"`, { windowsHide: true });
        } else {
          exec(`cd ${process.cwd()} && npm start &`);
        }

        setTimeout(() => process.exit(0), 500);
      }, 100);
    }
    // 404
    else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(WEB_PORT, () => {
    const url = `http://localhost:${WEB_PORT}`;
    console.log(`[WebUI] Interfaz web disponible en ${url}`);

    // Abrir navegador automáticamente
    if (process.platform === 'win32') {
      exec(`start ${url}`);
    } else if (process.platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
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

/**
 * Log específico para lecturas de registradores (va al log separado y actualiza estadísticas)
 * @param {string} registradorId - ID del registrador
 * @param {string} mensaje - Mensaje de log
 * @param {boolean} exito - Si la lectura fue exitosa
 */
function logRegistrador(registradorId, mensaje, exito) {
  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
  const tipo = exito ? 'exito' : 'error';

  estado.logsRegistradores.unshift({ timestamp, mensaje, tipo });

  // Limitar cantidad de logs
  if (estado.logsRegistradores.length > MAX_LOGS_REGISTRADORES) {
    estado.logsRegistradores = estado.logsRegistradores.slice(0, MAX_LOGS_REGISTRADORES);
  }

  // Actualizar estadísticas por registrador
  if (registradorId) {
    if (!estado.estadisticasPorRegistrador[registradorId]) {
      estado.estadisticasPorRegistrador[registradorId] = { exitosas: 0, fallidas: 0 };
    }
    if (exito) {
      estado.estadisticasPorRegistrador[registradorId].exitosas++;
    } else {
      estado.estadisticasPorRegistrador[registradorId].fallidas++;
    }
  }

  // También imprimir en consola
  const prefijo = exito ? '[+]' : '[!]';
  console.log(`${timestamp} ${prefijo} [REG] ${mensaje}`);
}

function setConectado(conectado) {
  estado.conectado = conectado;
}

function setAgente(agente) {
  estado.autenticado = !!agente;
  estado.agenteId = agente?.id || null;
  estado.agenteNombre = agente?.nombre || null;
}

function setWorkspace(workspace) {
  // Compatibilidad: si recibe un solo workspace, agregarlo al array
  if (workspace && !estado.workspaces.find(w => w.id === workspace.id)) {
    estado.workspaces.push(workspace);
  }
}

function setWorkspaces(workspaces) {
  estado.workspaces = workspaces || [];
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
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));
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
  logRegistrador,
  setConectado,
  setAgente,
  setWorkspace,
  setWorkspaces,
  setRegistradores,
  actualizarRegistrador,
  renderizar,
  destruir,
  iniciarReloj,
  estado,
};
