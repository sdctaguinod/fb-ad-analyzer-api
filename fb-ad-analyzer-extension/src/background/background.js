// Facebook Ad Analyzer - Background Script (Service Worker)
const API_ENDPOINT = 'https://fb-ad-analyzer-api.vercel.app';

// Utility function for fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

let isCapturing = false;
let captureTabId = null;

// Initialize extension
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      console.log('Facebook Ad Analyzer extension installed');
      
      // Set default settings with error handling
      chrome.storage.sync.set({
        autoAnalyze: true,
        captureFormat: 'screenshot'
      }).catch(error => {
        console.error('Failed to set sync storage:', error);
      });
      
      // Initialize local storage with error handling
      chrome.storage.local.set({
        captureCount: 0,
        lastAnalysis: null
      }).catch(error => {
        console.error('Failed to set local storage:', error);
      });
    }
  } catch (error) {
    console.error('Extension initialization failed:', error);
  }
});

// Handle extension icon click - Quick screenshot
chrome.action.onClicked.addListener(async (tab) => {
  try {
    console.log('Extension icon clicked, taking quick screenshot...');
    if (!tab || !tab.id) {
      throw new Error('Invalid tab information');
    }
    await startScreenshotCapture(tab.id);
  } catch (error) {
    console.error('Quick screenshot failed:', error);
    // Try to show error in badge
    try {
      chrome.action.setBadgeText({ text: '!', tabId: tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545', tabId: tab?.id });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: tab?.id });
      }, 3000);
    } catch (badgeError) {
      console.error('Failed to show error badge:', badgeError);
    }
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    switch (message.type) {
      case 'START_SCREENSHOT_CAPTURE':
        // Send immediate ACK to keep popup happy
        sendResponse({ success: true, message: 'Capture initiated' });
        
        // Do heavy work asynchronously without blocking the response
        (async () => {
          try {
            // Get tab ID (existing logic)
            let tabId;
            if (sender.tab && sender.tab.id) {
              tabId = sender.tab.id;
            } else {
              const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (!activeTab || !activeTab.id) {
                console.error('No active tab found');
                return;
              }
              tabId = activeTab.id;
            }
            
            // Do the actual capture work
            await startScreenshotCapture(tabId);
          } catch (error) {
            console.error('Async capture failed:', error);
            // Could send error via storage or another message if needed
          }
        })();
        
        return true; // Keep port open for async work
        
      case 'SCREENSHOT_SELECTED':
        // This should only come from content scripts, so sender.tab should exist
        const contentTabId = sender.tab?.id;
        if (!contentTabId) {
          console.error('SCREENSHOT_SELECTED message without valid tab ID');
          break;
        }
        handleScreenshotCapture(message.data, contentTabId);
        break;
        
      case 'ANALYZE_SCREENSHOT':
        handleScreenshotAnalysis(message.data);
        break;
        
      case 'GET_SETTINGS':
        getSettings().then(sendResponse).catch(error => {
          console.error('Failed to get settings:', error);
          sendResponse({ error: error.message });
        });
        return true; // Will respond asynchronously
        
      case 'API_TEST':
        testApiConnection().then(sendResponse).catch(error => {
          console.error('API test failed:', error);
          sendResponse({ success: false, error: error.message });
        });
        return true; // Will respond asynchronously
        
      default:
        console.log('Unknown message type:', message.type);
        sendResponse({ error: 'Unknown message type: ' + message.type });
    }
  } catch (error) {
    console.error('Message handler error:', error);
    sendResponse({ success: false, error: 'Message handler error: ' + error.message });
  }
});

async function startScreenshotCapture(tabId) {
  try {
    if (isCapturing) {
      console.error('Already capturing, ignoring request');
      return;
    }
    
    isCapturing = true;
    captureTabId = tabId;
    
    console.log('Starting screenshot capture for tab:', tabId);
    
    // Inject content script first
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      
      if (chrome.runtime.lastError) {
        throw new Error('Script injection failed: ' + chrome.runtime.lastError.message);
      }
    } catch (scriptError) {
      console.error('Failed to inject content script:', scriptError);
      throw new Error('Failed to inject content script: ' + scriptError.message);
    }
    
    // Capture visible tab
    try {
      // Get window ID for the tab
      let windowId;
      try {
        const tab = await chrome.tabs.get(tabId);
        windowId = tab.windowId;
        console.log(`Got window ID ${windowId} for tab ${tabId}`);
      } catch (tabError) {
        console.error('Failed to get tab info:', tabError);
        // Fallback: try to get current window
        const currentWindow = await chrome.windows.getCurrent();
        windowId = currentWindow.id;
        console.log(`Using current window ID ${windowId} as fallback`);
      }
      
      const screenshotDataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, {
          format: 'png',
          quality: 90
        }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (dataUrl) {
            resolve(dataUrl);
          } else {
            reject(new Error('Tab capture returned no data'));
          }
        });
      });
      
      console.log('Tab screenshot captured successfully');
      
      // Send screenshot to content script for area selection
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'START_SCREEN_CAPTURE',
          imageDataUrl: screenshotDataUrl,
          method: 'tab_capture'
        });
      } catch (messageError) {
        console.error('Failed to send screenshot to content script:', messageError);
        // Continue anyway - content script might still receive the message
      }
      
      console.log('Screenshot capture initiated successfully');
      
    } catch (captureError) {
      console.error('Tab capture failed:', captureError);
      throw new Error('Screenshot capture failed: ' + captureError.message);
    }
    
  } catch (error) {
    isCapturing = false;
    captureTabId = null;
    console.error('Screenshot capture failed:', error);
    // Could notify popup of error via storage or message if needed
  }
}

async function handleScreenshotCapture(screenshotData, tabId) {
  try {
    console.log('Screenshot captured:', screenshotData);
    
    // Store the captured screenshot data
    const timestamp = Date.now();
    const captureId = `capture_${timestamp}`;
    
    await chrome.storage.local.set({
      [captureId]: {
        ...screenshotData,
        timestamp,
        tabId,
        status: 'captured'
      }
    });
    
    // Update capture count
    const result = await chrome.storage.local.get(['captureCount']);
    const newCount = (result.captureCount || 0) + 1;
    await chrome.storage.local.set({ captureCount: newCount });
    
    // Store latest capture info for popup to pick up
    await chrome.storage.local.set({
      latestCapture: {
        captureId,
        timestamp,
        status: 'captured',
        data: screenshotData
      }
    });
    
    // Notify popup if open
    try {
      chrome.runtime.sendMessage({
        type: 'SCREENSHOT_CAPTURED',
        data: { ...screenshotData, captureId }
      });
    } catch (error) {
      // Popup might not be open, that's okay
      console.log('Could not notify popup:', error.message);
    }
    
    // Check if auto-analysis is enabled
    const settings = await chrome.storage.sync.get(['autoAnalyze']);
    console.log('Auto-analyze setting:', settings.autoAnalyze);
    
    if (settings.autoAnalyze !== false) {
      console.log('Starting auto-analysis for screenshot:', captureId);
      await handleScreenshotAnalysis({ ...screenshotData, captureId });
    } else {
      console.log('Auto-analysis disabled, skipping analysis');
    }
    
    // Reset capture state
    isCapturing = false;
    captureTabId = null;
    
  } catch (error) {
    console.error('Failed to handle screenshot capture:', error);
    isCapturing = false;
    captureTabId = null;
  }
}

async function handleScreenshotAnalysis(screenshotData) {
  try {
    console.log('Starting screenshot analysis:', screenshotData);
    
    // Test API connection first
    console.log('Testing API connection...');
    const apiTest = await testApiConnection();
    console.log('API test result:', apiTest);
    
    if (!apiTest.success) {
      throw new Error('API connection failed: ' + (apiTest.error || 'Unknown error'));
    }
    
    console.log('API connection successful, sending analysis request...');
    
    // Log image data info for debugging
    const imageData = screenshotData.imageDataUrl || screenshotData.croppedImageDataUrl;
    if (imageData) {
      console.log('Image data found:', imageData.substring(0, 50) + '... (length:', imageData.length, ')');
    } else {
      console.error('No image data found in screenshot data:', Object.keys(screenshotData));
    }
    
    // Send analysis request with timeout
    const response = await fetchWithTimeout(`${API_ENDPOINT}/api/hello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'analyze_screenshot',
        data: screenshotData,
        timestamp: Date.now()
      })
    }, 20000); // 20 second timeout for analysis
    
    console.log('Analysis API response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('Analysis API result:', result);
    
    // Store analysis result
    if (screenshotData.captureId) {
      const existingCapture = await chrome.storage.local.get([screenshotData.captureId]);
      if (existingCapture[screenshotData.captureId]) {
        existingCapture[screenshotData.captureId].analysis = result;
        existingCapture[screenshotData.captureId].status = 'analyzed';
        await chrome.storage.local.set(existingCapture);
      }
    }
    
    // Update last analysis timestamp and store result for popup
    await chrome.storage.local.set({ 
      lastAnalysis: Date.now(),
      latestAnalysis: {
        timestamp: Date.now(),
        captureId: screenshotData.captureId,
        result: result,
        status: 'completed'
      }
    });
    
    // Notify popup
    try {
      chrome.runtime.sendMessage({
        type: 'ANALYSIS_COMPLETE',
        data: result
      });
    } catch (error) {
      // Popup might not be open
      console.log('Could not notify popup of analysis completion:', error.message);
    }
    
    console.log('Analysis complete:', result);
    
    // Save analysis data to database
    await saveAnalysisToDatabase(screenshotData, result);
    
  } catch (error) {
    console.error('Analysis failed:', error);
    
    // Store error result for popup
    await chrome.storage.local.set({
      latestAnalysis: {
        timestamp: Date.now(),
        captureId: screenshotData.captureId,
        error: error.message,
        status: 'error'
      }
    });
    
    // Notify popup about error
    try {
      chrome.runtime.sendMessage({
        type: 'ANALYSIS_ERROR',
        error: error.message
      });
    } catch (e) {
      // Popup might not be open
      console.log('Could not notify popup of analysis error:', e.message);
    }
  }
}

async function testApiConnection() {
  try {
    const response = await fetchWithTimeout(`${API_ENDPOINT}/api/hello`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    }, 10000); // 10 second timeout for connection test
    
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
    
    const data = await response.json();
    return {
      success: true,
      data
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function getSettings() {
  try {
    const syncSettings = await chrome.storage.sync.get([
      'autoAnalyze',
      'captureFormat'
    ]);
    
    const localData = await chrome.storage.local.get([
      'captureCount',
      'lastAnalysis'
    ]);
    
    return {
      ...syncSettings,
      ...localData,
      apiEndpoint: API_ENDPOINT
    };
    
  } catch (error) {
    console.error('Failed to get settings:', error);
    return {};
  }
}

// Handle tab updates - extension works on all sites now
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Update badge to show extension is ready on all sites
    chrome.action.setBadgeText({
      tabId: tabId,
      text: '●'
    });
    
    chrome.action.setBadgeBackgroundColor({
      tabId: tabId,
      color: '#1877f2'
    });
  }
});

// Clean up old captures periodically (keep last 50)
try {
  if (chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create('cleanup', { periodInMinutes: 60 });
    console.log('Cleanup alarm created');
  } else {
    console.warn('Alarms API not available');
  }
} catch (error) {
  console.error('Failed to create cleanup alarm:', error);
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
      if (alarm.name === 'cleanup') {
        console.log('Running cleanup...');
        const storage = await chrome.storage.local.get();
        const captures = Object.entries(storage)
          .filter(([key]) => key.startsWith('capture_'))
          .sort(([, a], [, b]) => b.timestamp - a.timestamp);
        
        if (captures.length > 50) {
          const toDelete = captures.slice(50).map(([key]) => key);
          await chrome.storage.local.remove(toDelete);
          console.log(`Cleaned up ${toDelete.length} old captures`);
        }
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  });
}

// Function to save analysis data to database
async function saveAnalysisToDatabase(screenshotData, analysisResult) {
  try {
    console.log('Attempting to save analysis to database...');
    
    // Prepare data for database
    const saveData = {
      screenshot_url: screenshotData.imageDataUrl || screenshotData.croppedImageDataUrl || null,
      analysis_data: analysisResult.analysis || analysisResult.message || 'No analysis data',
      source_url: screenshotData.url || null,
      platform: detectPlatform(screenshotData.url),
      user_id: 'anonymous', // Placeholder for now
      // Add structured data fields from AI response
      advertiser_name: analysisResult.structured_data?.advertiser_name || null,
      headline: analysisResult.structured_data?.headline || null,
      description: analysisResult.structured_data?.description || null,
      call_to_action: analysisResult.structured_data?.call_to_action || null,
      product_service: analysisResult.structured_data?.product_service || null
    };
    
    console.log('Preparing to save data:', {
      has_screenshot: !!saveData.screenshot_url,
      has_analysis: !!saveData.analysis_data,
      platform: saveData.platform,
      source_url: saveData.source_url,
      has_structured_data: !!analysisResult.structured_data,
      advertiser: saveData.advertiser_name,
      headline: saveData.headline ? saveData.headline.substring(0, 50) + '...' : null
    });
    
    // Send to save-ad API
    const response = await fetchWithTimeout(`${API_ENDPOINT}/api/save-ad`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saveData)
    }, 10000); // 10 second timeout
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Database save failed: ${response.status} ${errorData.message || response.statusText}`);
    }
    
    const result = await response.json();
    console.log('Analysis saved to database successfully:', result.id);
    
    return { success: true, id: result.id };
    
  } catch (error) {
    console.error('Failed to save analysis to database:', error);
    
    // Don't throw error - we don't want to break the extension if database save fails
    // Just log the error and continue
    return { success: false, error: error.message };
  }
}

// Helper function to detect platform from URL
function detectPlatform(url) {
  if (!url) return 'unknown';
  
  if (url.includes('facebook.com') || url.includes('fb.com')) {
    return 'facebook';
  } else if (url.includes('linkedin.com')) {
    return 'linkedin';
  } else if (url.includes('instagram.com')) {
    return 'instagram';
  } else if (url.includes('twitter.com') || url.includes('x.com')) {
    return 'twitter';
  } else {
    return 'other';
  }
}