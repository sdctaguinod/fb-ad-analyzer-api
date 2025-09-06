// Screenshot Analyzer - Popup Script
import './popup.css';

// Utility function for sendMessage with timeout
function sendMessageWithTimeout(message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Message timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    try {
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || { success: false, error: 'No response received' });
        }
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

class PopupController {
  constructor() {
    this.captureBtn = document.getElementById('captureBtn');
    this.statusElement = document.getElementById('status');
    this.resultsSection = document.getElementById('resultsSection');
    this.resultsContent = document.getElementById('resultsContent');
    this.captureCount = document.getElementById('captureCount');
    this.autoAnalyze = document.getElementById('autoAnalyze');
    
    // Persistence tracking
    this.isWaitingForResults = false;
    this.lastCaptureTimestamp = 0;
    this.keepAliveInterval = null;
    this.timeoutId = null;
    
    this.init();
  }
  
  async init() {
    await this.loadStats();
    this.setupEventListeners();
    this.setupStorageListeners();
    this.setupKeepAlive();
    this.checkForRecentResults();
    this.updateStatus('ready', 'Ready');
  }
  
  setupKeepAlive() {
    // Keep the popup connection alive when waiting for results
    this.keepAliveInterval = setInterval(() => {
      if (this.isWaitingForResults) {
        // Perform a lightweight operation to keep popup active
        chrome.storage.local.get(['timestamp']).catch(() => {});
      }
    }, 1000);
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
      }
    });
  }
  
  setupEventListeners() {
    this.captureBtn.addEventListener('click', () => this.handleCapture());
    
    // Save settings when changed
    this.autoAnalyze.addEventListener('change', () => {
      chrome.storage.sync.set({
        autoAnalyze: this.autoAnalyze.checked
      });
    });
  }
  
  setupStorageListeners() {
    // Listen for storage changes to get real-time updates (for analysis results only)
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        if (changes.latestAnalysis) {
          this.handleStorageAnalysis(changes.latestAnalysis.newValue);
        }
        if (changes.captureCount) {
          this.captureCount.textContent = changes.captureCount.newValue || 0;
        }
      }
    });
    
    // Listen for messages from background script for capture completion
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Popup received message:', message.type, message);
      
      if (message.type === 'SCREENSHOT_CAPTURED') {
        this.handleScreenshotCaptured(message.data);
      } else if (message.type === 'ANALYSIS_COMPLETE') {
        console.log('Analysis complete, displaying results');
        this.displayResults(message.data);
        this.updateStatus('ready', 'Analysis complete');
        this.captureBtn.disabled = false;
      } else if (message.type === 'ANALYSIS_ERROR') {
        console.log('Analysis error:', message.error);
        this.displayError(message.error);
        this.updateStatus('error', 'Analysis failed');
        this.captureBtn.disabled = false;
      }
    });
  }
  
  async checkForRecentResults() {
    try {
      // Check for recent capture or analysis results
      const storage = await chrome.storage.local.get(['latestCapture', 'latestAnalysis']);
      
      if (storage.latestCapture && storage.latestCapture.timestamp > (Date.now() - 30000)) {
        this.handleStorageCapture(storage.latestCapture);
      }
      
      if (storage.latestAnalysis && storage.latestAnalysis.timestamp > (Date.now() - 30000)) {
        this.handleStorageAnalysis(storage.latestAnalysis);
      }
    } catch (error) {
      console.error('Failed to check recent results:', error);
    }
  }
  
  async loadStats() {
    try {
      const result = await chrome.storage.local.get(['captureCount']);
      this.captureCount.textContent = result.captureCount || 0;
      
      const settings = await chrome.storage.sync.get(['autoAnalyze']);
      this.autoAnalyze.checked = settings.autoAnalyze !== false;
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }
  
  async handleCapture() {
    try {
      this.updateStatus('processing', 'Starting screenshot capture...');
      this.captureBtn.disabled = true;
      this.isWaitingForResults = true;
      this.lastCaptureTimestamp = Date.now();
      
      // Set a timeout to clear waiting state if no results come back
      if (this.timeoutId) clearTimeout(this.timeoutId);
      this.timeoutId = setTimeout(() => {
        if (this.isWaitingForResults) {
          console.log('Analysis timeout - clearing waiting state');
          this.isWaitingForResults = false;
          this.updateStatus('ready', 'Ready (timeout)');
          this.captureBtn.disabled = false;
        }
      }, 45000); // 45 second timeout for the entire process
      
      console.log('Starting capture from popup...');
      
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Active tab:', tab.url);
      
      // Send message to background script to start screenshot capture
      console.log('Sending START_SCREENSHOT_CAPTURE message...');
      
      const response = await sendMessageWithTimeout({
        type: 'START_SCREENSHOT_CAPTURE'
      }, 15000); // 15 second timeout for screenshot capture
      
      console.log('Background response:', response);
      
      if (response && response.success) {
        if (response.method === 'tab_capture') {
          this.updateStatus('processing', response.message || 'Screenshot captured, select area to analyze');
        } else {
          this.updateStatus('processing', response.message || 'Screenshot capture initiated');
        }
        // Keep waiting for the SCREENSHOT_CAPTURED message from background script
        // Don't re-enable the button yet - that happens when we get the result
      } else {
        throw new Error(response?.error || 'Unknown capture error');
      }
      
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      
      // Provide specific error messages based on error type
      let errorMessage = 'Capture failed';
      let detailedMessage = 'Screenshot capture failed';
      
      if (error.message.includes('timeout')) {
        errorMessage = 'Capture timeout';
        detailedMessage = 'Screenshot capture timed out. This may happen if the system is slow or if there are permission issues. Please try again.';
      } else if (error.message.includes('permission')) {
        errorMessage = 'Permission denied';
        detailedMessage = 'Screenshot permission denied. Please check extension permissions in Chrome settings.';
      } else if (error.message.includes('runtime')) {
        errorMessage = 'Extension error';
        detailedMessage = 'Extension communication error. Try refreshing the page and reopening the extension.';
      } else {
        errorMessage = 'Capture failed';
        detailedMessage = `Screenshot capture failed: ${error.message}. Try refreshing the page or check extension permissions.`;
      }
      
      this.updateStatus('error', errorMessage);
      this.isWaitingForResults = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.captureBtn.disabled = false;
      
      // Show detailed error in results section
      this.displayError(detailedMessage);
    }
  }
  
  // Handle direct screenshot captured messages from background script
  async handleScreenshotCaptured(screenshotData) {
    try {
      console.log('Screenshot captured message received:', screenshotData);
      
      // Update capture count
      const result = await chrome.storage.local.get(['captureCount']);
      const newCount = (result.captureCount || 0) + 1;
      await chrome.storage.local.set({ captureCount: newCount });
      this.captureCount.textContent = newCount;
      
      this.updateStatus('processing', 'Screenshot captured, analyzing...');
      
      // Clear waiting state
      this.isWaitingForResults = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      
      // DON'T automatically re-enable the button - wait for analysis results
      // The analysis result handlers will re-enable the button
      console.log('Waiting for analysis results...');
      
    } catch (error) {
      console.error('Failed to handle captured screenshot:', error);
      this.updateStatus('error', 'Processing failed');
      this.isWaitingForResults = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.captureBtn.disabled = false;
    }
  }
  
  handleStorageAnalysis(analysisData) {
    try {
      console.log('Storage analysis received:', analysisData);
      
      if (analysisData.status === 'completed' && analysisData.result) {
        this.displayResults(analysisData.result);
        this.updateStatus('ready', 'Analysis complete');
      } else if (analysisData.status === 'error') {
        this.displayError(analysisData.error);
        this.updateStatus('error', 'Analysis failed');
      }
      
      // Clear waiting state, timeout, and re-enable capture button
      this.isWaitingForResults = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.captureBtn.disabled = false;
      
    } catch (error) {
      console.error('Failed to handle storage analysis:', error);
      this.updateStatus('error', 'Processing failed');
      this.isWaitingForResults = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.captureBtn.disabled = false;
    }
  }
  
  handleStorageCapture(captureData) {
    try {
      console.log('Storage capture received:', captureData);
      
      if (captureData.status === 'captured' && captureData.data) {
        this.updateStatus('processing', 'Screenshot captured, analyzing...');
        // Don't re-enable button yet, wait for analysis
      }
      
    } catch (error) {
      console.error('Failed to handle storage capture:', error);
      this.updateStatus('error', 'Processing failed');
      this.captureBtn.disabled = false;
    }
  }
  
  // Keep the old method for backward compatibility but simplify it
  async handleScreenshotCaptured(screenshotData) {
    // This method is now mainly handled by storage listeners
    console.log('Direct screenshot message received (deprecated):', screenshotData);
  }
  
  
  displayResults(data) {
    console.log('Displaying results:', data);
    
    // Show only the analysis content without metadata
    this.resultsContent.innerHTML = `
      ${data.analysis ? `
        <div class="result-item">
          <div style="white-space: pre-wrap; line-height: 1.4;">${data.analysis}</div>
        </div>
      ` : ''}
      ${data.error ? `
        <div class="result-item error">
          <strong>Error:</strong> ${data.error}
        </div>
      ` : ''}
    `;
    this.resultsSection.style.display = 'block';
  }
  
  displayError(message) {
    this.resultsContent.innerHTML = `
      <div class="result-item error">
        <strong>Error:</strong> ${message}
      </div>
    `;
    this.resultsSection.style.display = 'block';
  }
  
  updateStatus(type, message) {
    const indicator = this.statusElement.querySelector('.indicator');
    const text = this.statusElement.querySelector('.text');
    
    // Remove existing status classes
    this.statusElement.className = 'status';
    
    // Add new status class
    if (type !== 'ready') {
      this.statusElement.classList.add(type);
    }
    
    // Add timestamp for debugging
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] Status update: ${type} - ${message}`);
    
    text.textContent = message;
    
    // Add loading animation for processing states
    if (type === 'processing') {
      indicator.style.animation = 'pulse 1.5s infinite';
    } else {
      indicator.style.animation = '';
    }
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});