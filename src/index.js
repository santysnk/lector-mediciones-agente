// src/index.js
// Punto de entrada del Agente de Lecturas Modbus

require('dotenv').config();

const { leerRegistrosModbus, MODO_MODBUS } = require('./modbus/clienteModbus');
const { obtenerAlimentadores } = require('./servicios/alimentadoresService');
const { guardarLecturasBatch } = require('./servicios/lecturasService');
const {
  iniciarConexion,
  estaConectado,
  estaAutenticado,
  enviarCodigoVinculacion,
  BACKEND_URL,
} = require('./servicios/websocketService');
const ui = require('./ui/consola');
const readline = require('readline');

// Configuración
const CLAVE_SECRETA = process.env.CLAVE_SECRETA;
const INTERVALO_LECTURA = Number(process.env.INTERVALO_LECTURA) || 60;

// Estado del agente
let alimentadoresCache = [];
let cicloActivo = false;
let workspaceVinculado = null;

// Interfaz de readline para comandos
let rl = null;

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
 * Procesa comandos del usuario
 */
function procesarComando(input) {
  const comando = input.trim().toLowerCase();

  if (comando.startsWith('vincular ')) {
    const codigo = input.trim().substring(9).toUpperCase();
    if (codigo.length !== 9 || codigo[4] !== '-') {
      console.log('\n[ERROR] Formato de código inválido. Usa: vincular XXXX-XXXX\n');
      return;
    }

    if (!estaConectado()) {
      console.log('\n[ERROR] No estás conectado al backend\n');
      return;
    }

    if (!estaAutenticado()) {
      console.log('\n[ERROR] El agente no está autenticado\n');
      return;
    }

    enviarCodigoVinculacion(codigo);

  } else if (comando === 'estado') {
    console.log('\n=== Estado del Agente ===');
    console.log(`Conectado: ${estaConectado() ? 'Sí' : 'No'}`);
    console.log(`Autenticado: ${estaAutenticado() ? 'Sí' : 'No'}`);
    console.log(`Workspace: ${workspaceVinculado ? workspaceVinculado.nombre : 'Sin vincular'}`);
    console.log('');

  } else if (comando === 'ayuda' || comando === 'help') {
    console.log('\n=== Comandos disponibles ===');
    console.log('  vincular XXXX-XXXX  - Vincular con un workspace usando código');
    console.log('  estado              - Ver estado actual del agente');
    console.log('  ayuda               - Mostrar esta ayuda');
    console.log('  salir               - Cerrar el agente');
    console.log('');

  } else if (comando === 'salir' || comando === 'exit') {
    console.log('\nCerrando agente...');
    process.exit(0);

  } else if (comando) {
    console.log(`\n[?] Comando desconocido: ${comando}`);
    console.log('    Escribe "ayuda" para ver comandos disponibles\n');
  }
}

/**
 * Inicia la interfaz de comandos
 */
function iniciarInterfazComandos() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', (input) => {
    procesarComando(input);
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nAgente cerrado.');
    process.exit(0);
  });

  console.log('\nEscribe "ayuda" para ver comandos disponibles.\n');
  rl.prompt();
}

/**
 * Función principal
 */
async function main() {
  ui.mostrarInicio();

  // Validar configuración
  if (!CLAVE_SECRETA) {
    ui.errorFatal('Falta la variable CLAVE_SECRETA en el archivo .env\n\nDebes configurar la clave secreta del agente.');
    process.exit(1);
  }

  // Configurar UI
  ui.setConfiguracion({
    modo: MODO_MODBUS,
    intervalo: INTERVALO_LECTURA,
  });

  // Iniciar conexión WebSocket al backend
  ui.log(`Conectando al backend: ${BACKEND_URL}`, 'info');

  iniciarConexion({
    onConectado: () => {
      ui.log('Conectado al backend via WebSocket', 'exito');
      ui.renderizar();
    },
    onAutenticado: (agente) => {
      ui.log(`Autenticado como: ${agente.nombre}`, 'exito');
      ui.renderizar();

      // Si no hay workspace vinculado, esperar comando de vinculación
      // En futuro: verificar workspaces vinculados y cargar alimentadores
    },
    onVinculado: (workspace) => {
      workspaceVinculado = workspace;
      ui.log(`Workspace vinculado: ${workspace.nombre}`, 'exito');
      ui.renderizar();
    },
    onDesconectado: (reason) => {
      ui.log(`Desconectado del backend: ${reason}`, 'advertencia');
      ui.renderizar();
    },
    onError: (error) => {
      ui.log(`Error: ${error.message}`, 'error');
    },
    onLog: (mensaje, tipo) => {
      ui.log(`[WS] ${mensaje}`, tipo);
    },
  });

  // Iniciar interfaz de comandos
  iniciarInterfazComandos();
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
