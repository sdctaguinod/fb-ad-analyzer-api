import { testSupabaseConnection } from '../lib/supabase.js';
import { testOpenAIConnection } from '../lib/openai.js';

export default async function handler(req, res) {
  try {
    const [supabaseTest, openaiTest] = await Promise.all([
      testSupabaseConnection(),
      testOpenAIConnection()
    ]);

    const response = {
      message: 'Facebook Ad Analyzer API - Connection Test',
      timestamp: new Date().toISOString(),
      services: {
        supabase: supabaseTest,
        openai: openaiTest
      },
      overall_status: (supabaseTest.status === 'connected' && openaiTest.status === 'connected') 
        ? 'all_services_connected' 
        : 'some_services_failed',
      environment: {
        node_version: process.version,
        vercel_region: process.env.VERCEL_REGION || 'local',
        has_supabase_url: !!process.env.SUPABASE_URL,
        has_supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
        has_openai_key: !!process.env.OPENAI_API_KEY
      }
    };

    const statusCode = response.overall_status === 'all_services_connected' ? 200 : 207;
    
    res.status(statusCode).json(response);
  } catch (error) {
    console.error('Hello endpoint error:', error);
    
    res.status(500).json({
      message: 'Facebook Ad Analyzer API - Connection Test Failed',
      timestamp: new Date().toISOString(),
      error: error.message,
      overall_status: 'endpoint_error',
      environment: {
        node_version: process.version,
        vercel_region: process.env.VERCEL_REGION || 'local',
        has_supabase_url: !!process.env.SUPABASE_URL,
        has_supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
        has_openai_key: !!process.env.OPENAI_API_KEY
      }
    });
  }
}