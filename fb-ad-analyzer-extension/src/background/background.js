// Facebook Ad Analyzer - Background Script (Service Worker)
const API_ENDPOINT = 'https://fb-ad-analyzer-pyuev885i-dominics-projects-14a42b14.vercel.app';

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
        // Handle messages from popup (sender.tab is undefined) vs content scripts
        let tabId;
        if (sender.tab && sender.tab.id) {
          // Message from content script
          tabId = sender.tab.id;
        } else {
          // Message from popup - get active tab
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab || !activeTab.id) {
              sendResponse({ success: false, error: 'No active tab found' });
              return;
            }
            tabId = activeTab.id;
          } catch (error) {
            console.error('Failed to get active tab:', error);
            sendResponse({ success: false, error: 'Failed to get active tab: ' + error.message });
            return;
          }
        }
        
        console.log('Starting screenshot capture for tab ID:', tabId);
        startScreenshotCapture(tabId).then(sendResponse).catch(error => {
          console.error('Screenshot capture failed:', error);
          sendResponse({ success: false, error: error.message });
        });
        return true; // Will respond asynchronously
        
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
      return { success: false, error: 'Already capturing' };
    }
    
    isCapturing = true;
    captureTabId = tabId;
    
    console.log('Starting screenshot capture for tab:', tabId);
    
    // Try desktop capture first, then fallback to visible tab capture
    try {
      const streamId = await new Promise((resolve, reject) => {
        console.log('Attempting desktop capture...');
        
        if (!chrome.desktopCapture) {
          reject(new Error('Desktop capture API not available'));
          return;
        }
        
        try {
          chrome.desktopCapture.chooseDesktopMedia(
            ['screen', 'window', 'tab'],
            (streamId) => {
              console.log('Desktop capture result:', streamId);
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (streamId) {
                resolve(streamId);
              } else {
                reject(new Error('Desktop capture cancelled or denied'));
              }
            }
          );
        } catch (apiError) {
          reject(new Error('Desktop capture API error: ' + apiError.message));
        }
      });
      
      console.log('Desktop capture successful, streamId:', streamId);
      
      // Inject content script and start desktop capture
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        
        if (chrome.runtime.lastError) {
          throw new Error('Script injection failed: ' + chrome.runtime.lastError.message);
        }
      } catch (scriptError) {
        throw new Error('Failed to inject content script: ' + scriptError.message);
      }
      
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'START_SCREEN_CAPTURE',
          streamId: streamId
        });
      } catch (messageError) {
        console.error('Failed to send message to content script:', messageError);
        // Don't throw here, desktop capture might still work
      }
      
      return { success: true, method: 'desktop', streamId };
      
    } catch (desktopError) {
      console.log('Desktop capture failed, trying tab capture:', desktopError.message);
      
      try {
        // Fallback: Use tab screenshot with visual selection
        if (!chrome.tabs || !chrome.tabs.captureVisibleTab) {
          throw new Error('Tab capture API not available');
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
        
        console.log('Tab capture successful, sending to content script for selection');
        
        // Inject content script if not already present
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });
          
          if (chrome.runtime.lastError) {
            throw new Error('Script injection failed: ' + chrome.runtime.lastError.message);
          }
        } catch (scriptError) {
          console.error('Content script injection failed:', scriptError);
          // Continue anyway, script might already be injected
        }
        
        // Send image data to content script for visual selection
        try {
          chrome.tabs.sendMessage(tabId, {
            type: 'START_SCREEN_CAPTURE',
            imageDataUrl: screenshotDataUrl,
            method: 'tab_capture'
          });
        } catch (messageError) {
          console.error('Failed to send message to content script:', messageError);
        }
        
        return { success: true, method: 'tab' };
        
      } catch (tabError) {
        console.error('Tab capture also failed:', tabError);
        throw new Error('Both desktop and tab capture failed: ' + tabError.message);
      }
    }
    
  } catch (error) {
    isCapturing = false;
    captureTabId = null;
    console.error('All screenshot methods failed:', error);
    return { success: false, error: 'Screenshot capture failed: ' + error.message };
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
        tabId
      }
    });
    
    // Update capture count
    const result = await chrome.storage.local.get(['captureCount']);
    const newCount = (result.captureCount || 0) + 1;
    await chrome.storage.local.set({ captureCount: newCount });
    
    // Notify popup if open
    try {
      chrome.runtime.sendMessage({
        type: 'SCREENSHOT_CAPTURED',
        data: { ...screenshotData, captureId }
      });
    } catch (error) {
      // Popup might not be open, that's okay
    }
    
    // Check if auto-analysis is enabled
    const settings = await chrome.storage.sync.get(['autoAnalyze']);
    if (settings.autoAnalyze) {
      await handleScreenshotAnalysis({ ...screenshotData, captureId });
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
    const apiTest = await testApiConnection();
    if (!apiTest.success) {
      throw new Error('API connection failed');
    }
    
    // Send analysis request
    const response = await fetch(`${API_ENDPOINT}/api/hello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'analyze_screenshot',
        data: screenshotData,
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    // Store analysis result
    if (screenshotData.captureId) {
      const existingCapture = await chrome.storage.local.get([screenshotData.captureId]);
      if (existingCapture[screenshotData.captureId]) {
        existingCapture[screenshotData.captureId].analysis = result;
        await chrome.storage.local.set(existingCapture);
      }
    }
    
    // Update last analysis timestamp
    await chrome.storage.local.set({ lastAnalysis: Date.now() });
    
    // Notify popup
    try {
      chrome.runtime.sendMessage({
        type: 'ANALYSIS_COMPLETE',
        data: result
      });
    } catch (error) {
      // Popup might not be open
    }
    
    console.log('Analysis complete:', result);
    
  } catch (error) {
    console.error('Analysis failed:', error);
    
    // Notify popup about error
    try {
      chrome.runtime.sendMessage({
        type: 'ANALYSIS_ERROR',
        error: error.message
      });
    } catch (e) {
      // Popup might not be open
    }
  }
}

async function testApiConnection() {
  try {
    const response = await fetch(`${API_ENDPOINT}/api/hello`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
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