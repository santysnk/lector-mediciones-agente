require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

sb.from('lecturas')
  .select('*')
  .order('timestamp', { ascending: false })
  .limit(5)
  .then(r => {
    console.log('Últimas lecturas en Supabase:');
    console.log(JSON.stringify(r.data, null, 2));
  });
