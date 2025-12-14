// crear-agente.js
// Script para crear un nuevo agente en la base de datos
// Genera una clave secreta y la guarda hasheada en Supabase

require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Crear cliente Supabase con service role
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Función simple de hash (similar a bcrypt pero sin dependencia adicional)
// El backend usa bcrypt, así que aquí solo generamos la clave
async function main() {
  const nombre = process.argv[2];

  if (!nombre) {
    console.log('\nUso: node crear-agente.js "Nombre del Agente"');
    console.log('\nEjemplo: node crear-agente.js "Agente Sala de Control"');
    process.exit(1);
  }

  console.log('\n=== Crear Nuevo Agente ===\n');

  // Generar clave secreta aleatoria (32 bytes = 256 bits)
  const claveSecreta = crypto.randomBytes(32).toString('hex');

  console.log(`Nombre: ${nombre}`);
  console.log(`Clave secreta generada: ${claveSecreta.substring(0, 16)}...`);

  // Para el hash, usamos bcrypt del lado del backend
  // Aquí simplemente guardamos un placeholder que luego actualizaremos
  // O mejor: generamos el hash aquí también

  // Importar bcrypt dinámicamente
  let bcrypt;
  try {
    bcrypt = require('bcrypt');
  } catch (e) {
    console.log('\n[NOTA] bcrypt no está instalado en el agente.');
    console.log('Debes crear el agente desde el backend o instalar bcrypt.\n');
    console.log('Para instalar bcrypt: npm install bcrypt\n');
    console.log('O usa este SQL en Supabase (reemplaza el hash con uno válido):');
    console.log(`
INSERT INTO agentes (nombre, clave_hash, activo)
VALUES ('${nombre}', '<hash_bcrypt>', true);
`);
    console.log('\nPara generar el hash, usa el backend con esta clave:');
    console.log(`\nCLAVE_SECRETA=${claveSecreta}\n`);
    process.exit(1);
  }

  // Generar hash
  const saltRounds = 10;
  const claveHash = await bcrypt.hash(claveSecreta, saltRounds);

  console.log('Hash generado correctamente');

  // Insertar en la base de datos
  const { data, error } = await supabase
    .from('agentes')
    .insert({
      nombre,
      clave_hash: claveHash,
      activo: true,
    })
    .select()
    .single();

  if (error) {
    console.error('\n[ERROR] No se pudo crear el agente:', error.message);
    process.exit(1);
  }

  console.log('\n=== Agente Creado Exitosamente ===\n');
  console.log(`ID: ${data.id}`);
  console.log(`Nombre: ${data.nombre}`);
  console.log(`Creado: ${data.creado_en}`);
  console.log('\n=== IMPORTANTE: Guarda esta clave secreta ===');
  console.log('(Solo se muestra una vez)\n');
  console.log(`CLAVE_SECRETA=${claveSecreta}`);
  console.log('\nAgrega esta línea a tu archivo .env\n');
}

main().catch(console.error);
