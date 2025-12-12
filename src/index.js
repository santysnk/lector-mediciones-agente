// src/index.js
// Punto de entrada del Agente de Lecturas Modbus

require('dotenv').config();

const { leerRegistrosModbus, MODO_MODBUS } = require('./modbus/clienteModbus');
const { obtenerAlimentadores } = require('./servicios/alimentadoresService');
const { guardarLecturasBatch } = require('./servicios/lecturasService');

// Configuración
const CONFIGURACION_ID = process.env.CONFIGURACION_ID;
const INTERVALO_LECTURA = Number(process.env.INTERVALO_LECTURA) || 60;

// Estado del agente
let alimentadoresCache = [];
let cicloActivo = false;
let contadorCiclos = 0;

/**
 * Muestra el banner de inicio
 */
function mostrarBanner() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   Lector Mediciones - Agente de Lecturas                   ║
║   Modo: ${MODO_MODBUS.toUpperCase().padEnd(10)}                                    ║
║   Intervalo: ${INTERVALO_LECTURA}s                                          ║
╚════════════════════════════════════════════════════════════╝
  `);
}

/**
 * Carga o recarga la lista de alimentadores desde Supabase
 */
async function cargarAlimentadores() {
  console.log('[Agente] Cargando alimentadores desde Supabase...');

  const alimentadores = await obtenerAlimentadores(CONFIGURACION_ID);

  if (alimentadores.length === 0) {
    console.warn('[Agente] No se encontraron alimentadores para monitorear');
    return false;
  }

  alimentadoresCache = alimentadores;
  console.log(`[Agente] ${alimentadores.length} alimentador(es) cargados:`);

  alimentadores.forEach((alim) => {
    const tieneRele = alim.config_rele?.ip ? 'Sí' : 'No';
    const tieneAnalizador = alim.config_analizador?.ip ? 'Sí' : 'No';
    console.log(`  - ${alim.nombre} (${alim.nombrePuesto}) | Relé: ${tieneRele} | Analizador: ${tieneAnalizador}`);
  });

  return true;
}

/**
 * Lee un dispositivo (relé o analizador) de un alimentador
 */
async function leerDispositivo(alimentador, tipoDispositivo) {
  const config = tipoDispositivo === 'analizador' ? alimentador.config_analizador : alimentador.config_rele;

  if (!config?.ip || !config?.puerto) {
    return null;
  }

  const valores = await leerRegistrosModbus({
    ip: config.ip,
    puerto: config.puerto,
    indiceInicial: config.indiceInicial || 0,
    cantRegistros: config.cantRegistros || 10,
    unitId: config.unitId || 1,
  });

  return valores;
}

/**
 * Ejecuta un ciclo de lectura de todos los alimentadores
 */
async function ejecutarCicloLectura() {
  contadorCiclos++;
  const timestamp = new Date().toISOString();
  console.log(`\n[Ciclo ${contadorCiclos}] ${timestamp}`);

  const lecturas = [];

  for (const alimentador of alimentadoresCache) {
    // Leer relé
    const valoresRele = await leerDispositivo(alimentador, 'rele');
    if (valoresRele) {
      lecturas.push({
        alimentador_id: alimentador.id,
        tipo_dispositivo: 'rele',
        valores: valoresRele,
      });
      console.log(`  ✓ ${alimentador.nombre} (relé): ${valoresRele.length} registros`);
    }

    // Leer analizador
    const valoresAnalizador = await leerDispositivo(alimentador, 'analizador');
    if (valoresAnalizador) {
      lecturas.push({
        alimentador_id: alimentador.id,
        tipo_dispositivo: 'analizador',
        valores: valoresAnalizador,
      });
      console.log(`  ✓ ${alimentador.nombre} (analizador): ${valoresAnalizador.length} registros`);
    }
  }

  // Guardar todas las lecturas en Supabase
  if (lecturas.length > 0) {
    const { exitosas, fallidas } = await guardarLecturasBatch(lecturas);
    console.log(`[Ciclo ${contadorCiclos}] Guardadas: ${exitosas} | Fallidas: ${fallidas}`);
  } else {
    console.log(`[Ciclo ${contadorCiclos}] No hubo lecturas para guardar`);
  }
}

/**
 * Inicia el ciclo de polling
 */
async function iniciarPolling() {
  if (cicloActivo) {
    console.warn('[Agente] El ciclo ya está activo');
    return;
  }

  cicloActivo = true;
  console.log(`[Agente] Iniciando polling cada ${INTERVALO_LECTURA} segundos...`);

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
  mostrarBanner();

  // Validar configuración
  if (!CONFIGURACION_ID) {
    console.error('ERROR: Falta la variable CONFIGURACION_ID en el archivo .env');
    console.error('       Debes especificar qué configuración va a monitorear este agente.');
    process.exit(1);
  }

  console.log(`[Agente] Configuración ID: ${CONFIGURACION_ID}`);

  // Cargar alimentadores
  const cargaExitosa = await cargarAlimentadores();

  if (!cargaExitosa) {
    console.error('[Agente] No se pudo iniciar: no hay alimentadores configurados');
    process.exit(1);
  }

  // Iniciar polling
  await iniciarPolling();

  // Mantener el proceso vivo
  console.log('\n[Agente] Presiona Ctrl+C para detener el agente');
}

// Manejar señales de terminación
process.on('SIGINT', () => {
  console.log('\n[Agente] Deteniendo...');
  cicloActivo = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Agente] Terminando...');
  cicloActivo = false;
  process.exit(0);
});

// Ejecutar
main().catch((error) => {
  console.error('[Agente] Error fatal:', error);
  process.exit(1);
});
