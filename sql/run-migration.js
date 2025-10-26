const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = 'https://bkvmqiznstcapyzxwash.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrdm1xaXpuc3RjYXB5enh3YXNoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTkwNDUxNywiZXhwIjoyMDc1NDgwNTE3fQ.fAf8kweB11WESjZL1BaXR2yIbm0fiGnjBHG3-m3L0Lg';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  try {
    console.log('Running migration 010_add_user_id_to_suppliers.sql...');
    
    const sqlPath = path.join(__dirname, '010_add_user_id_to_suppliers.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split SQL into statements and execute them one by one
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) continue;
      
      console.log(`\nExecuting statement ${i + 1}/${statements.length}...`);
      console.log(statement.substring(0, 100) + '...');
      
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });
      
      if (error) {
        console.error('Error executing statement:', error);
        // Try alternative method
        console.log('Trying alternative method...');
        const { error: error2 } = await supabase.from('_sql').insert({ query: statement });
        if (error2) {
          console.error('Alternative method also failed:', error2);
        }
      } else {
        console.log('✓ Success');
      }
    }
    
    console.log('\n✓ Migration completed!');
    
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

runMigration();
