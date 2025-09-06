// Inline the test functions to avoid import path issues with Vercel
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// Function to parse AI response and extract analysis and structured data
function parseAIResponse(rawResponse) {
  try {
    // Split the response by the STRUCTURED_DATA marker
    const parts = rawResponse.split('**STRUCTURED_DATA**');
    
    let analysis = rawResponse;
    let structured_data = {};
    
    if (parts.length >= 2) {
      // Extract analysis section (everything before STRUCTURED_DATA)
      analysis = parts[0].replace('**ANALYSIS**', '').trim();
      if (analysis.includes('(for display):')) {
        analysis = analysis.replace('(for display):', '').trim();
      }
      
      // Extract and parse structured data section
      const structuredSection = parts[1].trim();
      
      // Find JSON object in the structured section
      const jsonMatch = structuredSection.match(/\{[\s\S]*?\}/);
      
      if (jsonMatch) {
        try {
          structured_data = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('Failed to parse structured data JSON:', parseError);
          // Try to extract data manually if JSON parsing fails
          structured_data = extractStructuredDataManually(structuredSection);
        }
      } else {
        // Try to extract data manually if no JSON found
        structured_data = extractStructuredDataManually(structuredSection);
      }
    }
    
    // Clean up analysis text
    analysis = analysis.replace(/^\*\*ANALYSIS\*\*\s*(\(for display\):)?\s*/, '');
    
    return {
      analysis: analysis.trim() || rawResponse,
      structured_data: structured_data
    };
    
  } catch (error) {
    console.error('Error parsing AI response:', error);
    return {
      analysis: rawResponse,
      structured_data: {}
    };
  }
}

// Fallback function to manually extract structured data
function extractStructuredDataManually(text) {
  const data = {};
  
  // Try to extract common fields using regex
  const patterns = {
    advertiser_name: /(?:advertiser_name|company|brand)["']?\s*:\s*["']?([^",\n}]+)/i,
    headline: /(?:headline|title)["']?\s*:\s*["']?([^",\n}]+)/i,
    description: /(?:description|body|text)["']?\s*:\s*["']?([^",\n}]+)/i,
    call_to_action: /(?:call_to_action|cta|button)["']?\s*:\s*["']?([^",\n}]+)/i,
    product_service: /(?:product_service|product|service)["']?\s*:\s*["']?([^",\n}]+)/i
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match && match[1]) {
      data[key] = match[1].replace(/["']/g, '').trim();
    }
  }
  
  return data;
}

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
              model: "gpt-4o",
              max_tokens: 300,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Analyze this ad screenshot and provide:

**ANALYSIS** (for display):
1. Image Type: [Type of image/content]
2. Image Content & Design: [Visual elements and design]
3. Value Provided: [What the ad offers]
4. Tone of Copy: [Writing style and mood]
5. Call to Action: [CTA analysis]

**STRUCTURED_DATA** (for database):
{
  "advertiser_name": "[Company/brand name]",
  "headline": "[Main headline text]",
  "description": "[Ad body/description text]",
  "call_to_action": "[Actual button text]",
  "product_service": "[What's being promoted]"
}

Separate the analysis and structured data clearly.`
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
            
            const rawResponse = completion.choices[0]?.message?.content || 'Analysis completed';
            
            // Parse the AI response to extract analysis and structured data
            const parsedResponse = parseAIResponse(rawResponse);
            
            res.status(200).json({
              message: 'Screenshot analysis complete',
              timestamp: new Date().toISOString(),
              analysis: parsedResponse.analysis,
              structured_data: parsedResponse.structured_data,
              raw_response: rawResponse, // For debugging
              type: 'screenshot_analysis',
              model_used: 'gpt-4o'
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