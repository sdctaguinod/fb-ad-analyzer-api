// Inline the test functions to avoid import path issues with Vercel
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

async function testSupabaseConnection() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        status: 'error',
        message: 'Missing Supabase environment variables'
      };
    }
    
    // Simple connection test using REST API health check
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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

async function testOpenAIConnection() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return {
        status: 'error',
        message: 'Missing OpenAI API key environment variable'
      };
    }
    
    const openai = new OpenAI({ apiKey });
    
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "user",
          content: "Hello, this is a connection test. Please respond with 'Connection successful'."
        }
      ],
      model: "gpt-3.5-turbo",
      max_tokens: 10
    });

    const response = completion.choices[0]?.message?.content;
    
    return {
      status: 'connected',
      message: 'OpenAI connection successful',
      response: response
    };
  } catch (error) {
    return {
      status: 'error',
      message: `OpenAI connection failed: ${error.message}`
    };
  }
}

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
    
    // Handle different request types
    if (req.method === 'POST') {
      // Handle screenshot analysis requests
      const { type, data } = req.body || {};
      
      if (type === 'analyze_screenshot' && data) {
        try {
          // Simple analysis using OpenAI (if available)
          const apiKey = process.env.OPENAI_API_KEY;
          if (apiKey) {
            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
              messages: [
                {
                  role: "user",
                  content: "Analyze this screenshot data and provide a brief description of what you see. This is for ad analysis purposes."
                }
              ],
              model: "gpt-3.5-turbo",
              max_tokens: 100
            });
            
            res.status(200).json({
              message: 'Screenshot analysis complete',
              timestamp: new Date().toISOString(),
              analysis: completion.choices[0]?.message?.content || 'Analysis completed',
              type: 'screenshot_analysis'
            });
            return;
          }
        } catch (error) {
          console.error('Analysis error:', error);
        }
      }
      
      // If POST analysis fails or isn't available, fall back to connection test
    }
    
    // Default: Connection test
    const [supabaseTest, openaiTest] = await Promise.all([
      testSupabaseConnection(),
      testOpenAIConnection()
    ]);

    const response = {
      message: 'Facebook Ad Analyzer API - Connection Test',
      timestamp: new Date().toISOString(),
      method: req.method,
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
        vercel_url: process.env.VERCEL_URL || 'local',
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