// src/index.js
// Punto de entrada del Agente de Lecturas Modbus

require('dotenv').config();

const { leerRegistrosModbus, MODO_MODBUS } = require('./modbus/clienteModbus');
const { obtenerAlimentadores } = require('./servicios/alimentadoresService');
const { guardarLecturasBatch } = require('./servicios/lecturasService');
const ui = require('./ui/consola');

// Configuración
const CONFIGURACION_ID = process.env.CONFIGURACION_ID;
const INTERVALO_LECTURA = Number(process.env.INTERVALO_LECTURA) || 60;

// Estado del agente
let alimentadoresCache = [];
let cicloActivo = false;

/**
 * Carga o recarga la lista de alimentadores desde Supabase
 */
async function cargarAlimentadores() {
  ui.log('Cargando alimentadores desde Supabase...', 'info');

  const alimentadores = await obtenerAlimentadores(CONFIGURACION_ID);

  if (alimentadores.length === 0) {
    ui.log('No se encontraron alimentadores para monitorear', 'advertencia');
    return false;
  }

  alimentadoresCache = alimentadores;
  ui.setAlimentadores(alimentadores);
  ui.log(`${alimentadores.length} alimentador(es) cargados`, 'exito');

  return true;
}

/**
 * Lee un dispositivo (relé o analizador) de un alimentador
 */
async function leerDispositivo(alimentador, tipoDispositivo) {
  const config = tipoDispositivo === 'analizador' ? alimentador.config_analizador : alimentador.config_rele;

  if (!config?.ip || !config?.puerto) {
    return { valores: null, error: null };
  }

  try {
    const valores = await leerRegistrosModbus({
      ip: config.ip,
      puerto: config.puerto,
      indiceInicial: config.indiceInicial || 0,
      cantRegistros: config.cantRegistros || 10,
      unitId: config.unitId || 1,
    });

    return { valores, error: null };
  } catch (error) {
    return { valores: null, error: error.message };
  }
}

/**
 * Ejecuta un ciclo de lectura de todos los alimentadores
 */
async function ejecutarCicloLectura() {
  ui.incrementarCiclo();
  ui.log(`Iniciando ciclo de lectura...`, 'ciclo');

  const lecturas = [];

  for (const alimentador of alimentadoresCache) {
    // Leer relé
    if (alimentador.config_rele?.ip) {
      const { valores, error } = await leerDispositivo(alimentador, 'rele');

      if (valores) {
        lecturas.push({
          alimentador_id: alimentador.id,
          tipo_dispositivo: 'rele',
          valores: valores,
        });
        ui.registrarLectura(alimentador.id, 'rele', true);
        ui.log(`${alimentador.nombre} (relé): ${valores.length} registros`, 'exito');
      } else if (error) {
        ui.registrarLectura(alimentador.id, 'rele', false, `${alimentador.nombre}: ${error}`);
        ui.log(`${alimentador.nombre} (relé): ${error}`, 'error');
      }
    }

    // Leer analizador
    if (alimentador.config_analizador?.ip) {
      const { valores, error } = await leerDispositivo(alimentador, 'analizador');

      if (valores) {
        lecturas.push({
          alimentador_id: alimentador.id,
          tipo_dispositivo: 'analizador',
          valores: valores,
        });
        ui.registrarLectura(alimentador.id, 'analizador', true);
        ui.log(`${alimentador.nombre} (analizador): ${valores.length} registros`, 'exito');
      } else if (error) {
        ui.registrarLectura(alimentador.id, 'analizador', false, `${alimentador.nombre}: ${error}`);
        ui.log(`${alimentador.nombre} (analizador): ${error}`, 'error');
      }
    }
  }

  // Guardar todas las lecturas en Supabase
  if (lecturas.length > 0) {
    const { exitosas, fallidas } = await guardarLecturasBatch(lecturas);

    if (fallidas > 0) {
      ui.log(`Guardadas: ${exitosas} | Fallidas: ${fallidas}`, 'advertencia');
    } else {
      ui.log(`${exitosas} lecturas guardadas en Supabase`, 'exito');
    }
  } else {
    ui.log('No hubo lecturas para guardar', 'advertencia');
  }

  // Actualizar la pantalla
  ui.renderizar();
}

/**
 * Inicia el ciclo de polling
 */
async function iniciarPolling() {
  if (cicloActivo) {
    ui.log('El ciclo ya está activo', 'advertencia');
    return;
  }

  cicloActivo = true;
  ui.log(`Iniciando polling cada ${INTERVALO_LECTURA} segundos...`, 'info');

  // Primera lectura inmediata
  await ejecutarCicloLectura();

  // Configurar intervalo
  setInterval(async () => {
    if (cicloActivo) {
      await ejecutarCicloLectura();
    }
  }, INTERVALO_LECTURA * 1000);
}

/**
 * Función principal
 */
async function main() {
  ui.mostrarInicio();

  // Validar configuración
  if (!CONFIGURACION_ID) {
    ui.errorFatal('Falta la variable CONFIGURACION_ID en el archivo .env\n\nDebes especificar qué configuración va a monitorear este agente.');
    process.exit(1);
  }

  // Configurar UI
  ui.setConfiguracion({
    modo: MODO_MODBUS,
    intervalo: INTERVALO_LECTURA,
    configuracionId: CONFIGURACION_ID,
  });

  ui.log(`Configuración: ${CONFIGURACION_ID.substring(0, 8)}...`, 'info');

  // Cargar alimentadores
  const cargaExitosa = await cargarAlimentadores();

  if (!cargaExitosa) {
    ui.errorFatal('No se pudo iniciar: no hay alimentadores configurados para esta configuración.');
    process.exit(1);
  }

  // Mostrar estado inicial
  ui.renderizar();

  // Esperar un momento para que el usuario vea el estado inicial
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Iniciar polling
  await iniciarPolling();
}

// Manejar señales de terminación
process.on('SIGINT', () => {
  console.log('\n');
  ui.log('Deteniendo agente...', 'advertencia');
  cicloActivo = false;
  setTimeout(() => process.exit(0), 500);
});

process.on('SIGTERM', () => {
  ui.log('Terminando agente...', 'advertencia');
  cicloActivo = false;
  setTimeout(() => process.exit(0), 500);
});

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  ui.errorFatal(`Error no capturado: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  ui.log(`Promesa rechazada: ${reason}`, 'error');
});

// Ejecutar
main().catch((error) => {
  ui.errorFatal(`Error fatal: ${error.message}`);
  process.exit(1);
});
