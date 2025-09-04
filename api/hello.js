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
          // Extract screenshot image data
          const imageData = data.imageDataUrl || data.croppedImageDataUrl;
          
          if (!imageData) {
            throw new Error('No image data provided');
          }
          
          // Use OpenAI Vision API for image analysis
          const apiKey = process.env.OPENAI_API_KEY;
          if (apiKey) {
            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
              model: "gpt-4-vision-preview",
              max_tokens: 300,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Analyze this screenshot for advertising and marketing purposes. Please identify:

1. **Ad Type**: What type of advertisement or content is this? (Social media ad, banner ad, product page, etc.)
2. **Key Elements**: What are the main visual elements, text, colors, and layout?
3. **Target Audience**: Based on the content and design, who might this be targeting?
4. **Effectiveness**: What makes this ad potentially effective or ineffective?
5. **Call-to-Action**: What action is the ad trying to get users to take?

Provide a detailed but concise analysis suitable for competitive intelligence and marketing research.`
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: imageData,
                        detail: "high"
                      }
                    }
                  ]
                }
              ]
            });
            
            res.status(200).json({
              message: 'Screenshot analysis complete',
              timestamp: new Date().toISOString(),
              analysis: completion.choices[0]?.message?.content || 'Analysis completed',
              type: 'screenshot_analysis',
              model_used: 'gpt-4-vision-preview'
            });
            return;
          } else {
            throw new Error('OpenAI API key not configured');
          }
        } catch (error) {
          console.error('Analysis error:', error);
          
          // Return error details for debugging
          res.status(500).json({
            message: 'Screenshot analysis failed',
            timestamp: new Date().toISOString(),
            error: error.message,
            type: 'screenshot_analysis_error'
          });
          return;
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