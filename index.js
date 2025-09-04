// Root index for Facebook Ad Analyzer API
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  res.status(200).json({
    name: 'Facebook Ad Analyzer API',
    version: '1.0.0',
    description: 'API for analyzing Facebook ads',
    endpoints: {
      'GET /api/hello': 'Test endpoint and service connections',
      'POST /api/hello': 'Analyze screenshot data',
      'GET /api/test': 'Simple test endpoint'
    },
    timestamp: new Date().toISOString(),
    status: 'online'
  });
}