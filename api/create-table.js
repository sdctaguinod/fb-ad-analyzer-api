import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    // Only allow POST requests
    if (req.method !== 'POST') {
      res.status(405).json({
        error: 'Method not allowed',
        message: 'Only POST requests are supported'
      });
      return;
    }
    
    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({
        error: 'Configuration error',
        message: 'Missing database configuration'
      });
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('Creating saved_ads table...');
    
    // SQL to create the saved_ads table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS saved_ads (
        id SERIAL PRIMARY KEY,
        user_id TEXT DEFAULT 'anonymous',
        screenshot_url TEXT,
        source_url TEXT,
        platform TEXT DEFAULT 'unknown',
        analysis_data TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Create index for better performance
      CREATE INDEX IF NOT EXISTS idx_saved_ads_user_id ON saved_ads(user_id);
      CREATE INDEX IF NOT EXISTS idx_saved_ads_platform ON saved_ads(platform);
      CREATE INDEX IF NOT EXISTS idx_saved_ads_created_at ON saved_ads(created_at DESC);
    `;
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: createTableSQL
    });
    
    if (error) {
      console.error('Table creation error:', error);
      
      // Try alternative approach using raw SQL
      const { data: altData, error: altError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_name', 'saved_ads')
        .limit(1);
      
      if (altError) {
        res.status(500).json({
          error: 'Database error',
          message: 'Failed to create table and unable to check if table exists',
          details: error.message,
          sql_command: createTableSQL.trim()
        });
        return;
      }
      
      if (altData && altData.length > 0) {
        res.status(200).json({
          success: true,
          message: 'Table already exists',
          table_name: 'saved_ads'
        });
        return;
      }
      
      res.status(500).json({
        error: 'Database error',
        message: 'Failed to create saved_ads table',
        details: error.message,
        suggestion: 'Please create the table manually using the SQL command provided',
        sql_command: createTableSQL.trim()
      });
      return;
    }
    
    console.log('Table created successfully');
    
    res.status(201).json({
      success: true,
      message: 'saved_ads table created successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Create table API error:', error);
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while creating the table',
      details: error.message
    });
  }
}