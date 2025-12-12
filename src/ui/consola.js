// src/ui/consola.js
// Interfaz de consola visual para el agente

const chalk = require('chalk');
const boxen = require('boxen');
const Table = require('cli-table3');

// Estado global de la UI
const estado = {
  modo: 'simulado',
  intervalo: 60,
  configuracionId: '',
  alimentadores: [],
  ciclosCompletados: 0,
  lecturasExitosas: 0,
  lecturasFallidas: 0,
  ultimaLectura: null,
  errores: [],
  iniciado: null,
};

// Máximo de errores a mostrar en el log
const MAX_ERRORES = 10;

/**
 * Limpia la consola
 */
function limpiarConsola() {
  process.stdout.write('\x1B[2J\x1B[0f');
}

/**
 * Muestra el banner inicial
 */
function mostrarBanner() {
  const titulo = chalk.bold.cyan('LECTOR MEDICIONES - AGENTE');
  const subtitulo = chalk.gray('Monitor de dispositivos Modbus');

  console.log(boxen(`${titulo}\n${subtitulo}`, {
    padding: 1,
    margin: 1,
    borderStyle: 'double',
    borderColor: 'cyan',
  }));
}

/**
 * Actualiza la configuración en el estado
 */
function setConfiguracion({ modo, intervalo, configuracionId }) {
  estado.modo = modo || estado.modo;
  estado.intervalo = intervalo || estado.intervalo;
  estado.configuracionId = configuracionId || estado.configuracionId;
  estado.iniciado = new Date();
}

/**
 * Actualiza la lista de alimentadores
 */
function setAlimentadores(alimentadores) {
  estado.alimentadores = alimentadores.map(a => ({
    id: a.id,
    nombre: a.nombre,
    puesto: a.nombrePuesto,
    tieneRele: !!a.config_rele?.ip,
    tieneAnalizador: !!a.config_analizador?.ip,
    ipRele: a.config_rele?.ip || '-',
    ipAnalizador: a.config_analizador?.ip || '-',
    ultimoEstadoRele: null,
    ultimoEstadoAnalizador: null,
  }));
}

/**
 * Registra el resultado de una lectura
 */
function registrarLectura(alimentadorId, tipo, exito, mensaje = null) {
  const ahora = new Date();
  estado.ultimaLectura = ahora;

  if (exito) {
    estado.lecturasExitosas++;
  } else {
    estado.lecturasFallidas++;
    agregarError(`[${tipo}] ${mensaje || 'Error desconocido'}`);
  }

  // Actualizar estado del alimentador
  const alim = estado.alimentadores.find(a => a.id === alimentadorId);
  if (alim) {
    if (tipo === 'rele') {
      alim.ultimoEstadoRele = exito ? 'ok' : 'error';
    } else {
      alim.ultimoEstadoAnalizador = exito ? 'ok' : 'error';
    }
  }
}

/**
 * Incrementa el contador de ciclos
 */
function incrementarCiclo() {
  estado.ciclosCompletados++;
}

/**
 * Agrega un error al log
 */
function agregarError(mensaje) {
  const timestamp = new Date().toLocaleTimeString();
  estado.errores.unshift(`[${timestamp}] ${mensaje}`);

  // Mantener solo los últimos N errores
  if (estado.errores.length > MAX_ERRORES) {
    estado.errores = estado.errores.slice(0, MAX_ERRORES);
  }
}

/**
 * Formatea la duración desde el inicio
 */
function formatearDuracion() {
  if (!estado.iniciado) return '-';

  const ahora = new Date();
  const diff = Math.floor((ahora - estado.iniciado) / 1000);

  const horas = Math.floor(diff / 3600);
  const minutos = Math.floor((diff % 3600) / 60);
  const segundos = diff % 60;

  if (horas > 0) {
    return `${horas}h ${minutos}m ${segundos}s`;
  } else if (minutos > 0) {
    return `${minutos}m ${segundos}s`;
  }
  return `${segundos}s`;
}

/**
 * Renderiza el estado actual en la consola
 */
function renderizar() {
  limpiarConsola();
  mostrarBanner();

  // Info de configuración
  const modoColor = estado.modo === 'real' ? chalk.green('REAL') : chalk.yellow('SIMULADO');
  console.log(chalk.bold('\n📋 CONFIGURACIÓN'));
  console.log(`   Modo: ${modoColor}`);
  console.log(`   Intervalo: ${chalk.cyan(estado.intervalo + 's')}`);
  console.log(`   Config ID: ${chalk.gray(estado.configuracionId.substring(0, 8) + '...')}`);
  console.log(`   Tiempo activo: ${chalk.cyan(formatearDuracion())}`);

  // Estadísticas
  console.log(chalk.bold('\n📊 ESTADÍSTICAS'));
  console.log(`   Ciclos completados: ${chalk.cyan(estado.ciclosCompletados)}`);
  console.log(`   Lecturas exitosas: ${chalk.green(estado.lecturasExitosas)}`);
  console.log(`   Lecturas fallidas: ${chalk.red(estado.lecturasFallidas)}`);

  if (estado.ultimaLectura) {
    console.log(`   Última lectura: ${chalk.gray(estado.ultimaLectura.toLocaleTimeString())}`);
  }

  // Tabla de alimentadores
  if (estado.alimentadores.length > 0) {
    console.log(chalk.bold('\n🔌 ALIMENTADORES'));

    const tabla = new Table({
      head: [
        chalk.white('Nombre'),
        chalk.white('Puesto'),
        chalk.white('Relé'),
        chalk.white('Analizador'),
      ],
      colWidths: [20, 20, 15, 15],
    });

    estado.alimentadores.forEach(alim => {
      const estadoRele = alim.tieneRele
        ? (alim.ultimoEstadoRele === 'ok' ? chalk.green('● OK')
           : alim.ultimoEstadoRele === 'error' ? chalk.red('● ERROR')
           : chalk.gray('○ ---'))
        : chalk.gray('No config');

      const estadoAnalizador = alim.tieneAnalizador
        ? (alim.ultimoEstadoAnalizador === 'ok' ? chalk.green('● OK')
           : alim.ultimoEstadoAnalizador === 'error' ? chalk.red('● ERROR')
           : chalk.gray('○ ---'))
        : chalk.gray('No config');

      tabla.push([
        alim.nombre,
        alim.puesto,
        estadoRele,
        estadoAnalizador,
      ]);
    });

    console.log(tabla.toString());
  }

  // Log de errores
  if (estado.errores.length > 0) {
    console.log(chalk.bold.red('\n⚠️  ÚLTIMOS ERRORES'));
    estado.errores.forEach(err => {
      console.log(chalk.red(`   ${err}`));
    });
  }

  // Footer
  console.log(chalk.gray('\n─────────────────────────────────────────────────'));
  console.log(chalk.gray('Presiona Ctrl+C para detener el agente'));
}

/**
 * Muestra un mensaje de log simple (sin limpiar pantalla)
 */
function log(mensaje, tipo = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  let icono = 'ℹ️';
  let color = chalk.white;

  switch (tipo) {
    case 'exito':
      icono = '✅';
      color = chalk.green;
      break;
    case 'error':
      icono = '❌';
      color = chalk.red;
      agregarError(mensaje);
      break;
    case 'advertencia':
      icono = '⚠️';
      color = chalk.yellow;
      break;
    case 'ciclo':
      icono = '🔄';
      color = chalk.cyan;
      break;
  }

  console.log(color(`[${timestamp}] ${icono} ${mensaje}`));
}

/**
 * Muestra mensaje de inicio
 */
function mostrarInicio() {
  limpiarConsola();
  mostrarBanner();
  console.log(chalk.cyan('\n⏳ Iniciando agente...\n'));
}

/**
 * Muestra mensaje de error fatal y sale
 */
function errorFatal(mensaje) {
  console.log(boxen(chalk.red.bold('ERROR FATAL\n\n') + chalk.white(mensaje), {
    padding: 1,
    margin: 1,
    borderStyle: 'double',
    borderColor: 'red',
  }));
}

module.exports = {
  mostrarInicio,
  mostrarBanner,
  setConfiguracion,
  setAlimentadores,
  registrarLectura,
  incrementarCiclo,
  agregarError,
  renderizar,
  log,
  errorFatal,
  estado,
};
