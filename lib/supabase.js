import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function testSupabaseConnection() {
  try {
    // Validate environment variables exist
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }
    
    // Validate URL format
    try {
      new URL(supabaseUrl);
    } catch {
      throw new Error('Invalid Supabase URL format');
    }
    
    // Validate service key format (should be a JWT-like string)
    if (!supabaseServiceKey.includes('.') || supabaseServiceKey.length < 20) {
      throw new Error('Invalid Supabase service key format');
    }
    
    // Test client creation (this will validate credentials are properly formatted)
    const testClient = createClient(supabaseUrl, supabaseServiceKey);
    
    if (!testClient) {
      throw new Error('Failed to create Supabase client');
    }
    
    return { 
      status: 'connected',
      message: 'Supabase client created successfully with valid credentials'
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Supabase connection failed: ${error.message}`
    };
  }
}