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
    
    // Extract data from request
    const { 
      screenshot_url,
      analysis_data,
      source_url,
      platform,
      user_id = 'anonymous' // Default user ID for now
    } = req.body;
    
    // Validate required fields
    if (!analysis_data) {
      res.status(400).json({
        error: 'Validation error',
        message: 'analysis_data is required'
      });
      return;
    }
    
    // Prepare data for database insertion
    const adData = {
      user_id,
      screenshot_url,
      source_url,
      platform: platform || 'unknown',
      analysis_data: typeof analysis_data === 'string' ? analysis_data : JSON.stringify(analysis_data),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log('Saving ad data to database:', {
      user_id: adData.user_id,
      platform: adData.platform,
      has_screenshot: !!adData.screenshot_url,
      has_analysis: !!adData.analysis_data
    });
    
    // Insert data into saved_ads table
    const { data, error } = await supabase
      .from('saved_ads')
      .insert([adData])
      .select();
    
    if (error) {
      console.error('Database insertion error:', error);
      
      // Check if it's a table not found error
      if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
        res.status(500).json({
          error: 'Database schema error',
          message: 'saved_ads table does not exist. Please create the table first.',
          details: 'Run: CREATE TABLE saved_ads (id SERIAL PRIMARY KEY, user_id TEXT, screenshot_url TEXT, source_url TEXT, platform TEXT, analysis_data TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());'
        });
        return;
      }
      
      res.status(500).json({
        error: 'Database error',
        message: 'Failed to save ad data',
        details: error.message
      });
      return;
    }
    
    console.log('Ad data saved successfully:', data[0]?.id);
    
    res.status(201).json({
      success: true,
      message: 'Ad data saved successfully',
      id: data[0]?.id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Save ad API error:', error);
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred',
      details: error.message
    });
  }
}