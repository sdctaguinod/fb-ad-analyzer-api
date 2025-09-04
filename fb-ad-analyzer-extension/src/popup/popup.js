// Screenshot Analyzer - Popup Script
import './popup.css';

class PopupController {
  constructor() {
    this.captureBtn = document.getElementById('captureBtn');
    this.statusElement = document.getElementById('status');
    this.resultsSection = document.getElementById('resultsSection');
    this.resultsContent = document.getElementById('resultsContent');
    this.captureCount = document.getElementById('captureCount');
    this.autoAnalyze = document.getElementById('autoAnalyze');
    
    this.init();
  }
  
  async init() {
    await this.loadStats();
    this.setupEventListeners();
    this.updateStatus('ready', 'Ready');
  }
  
  setupEventListeners() {
    this.captureBtn.addEventListener('click', () => this.handleCapture());
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'SCREENSHOT_CAPTURED') {
        this.handleScreenshotCaptured(message.data);
      } else if (message.type === 'ANALYSIS_COMPLETE') {
        this.displayResults(message.data);
      } else if (message.type === 'ANALYSIS_ERROR') {
        this.displayError(message.error);
      }
    });
    
    // Save settings when changed
    this.autoAnalyze.addEventListener('change', () => {
      chrome.storage.sync.set({
        autoAnalyze: this.autoAnalyze.checked
      });
    });
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
      
      console.log('Starting capture from popup...');
      
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Active tab:', tab.url);
      
      // Send message to background script to start screenshot capture
      console.log('Sending START_SCREENSHOT_CAPTURE message...');
      
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_SCREENSHOT_CAPTURE'
        }, (response) => {
          console.log('Background response:', response);
          if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError);
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      });
      
      if (response && response.success) {
        if (response.method === 'desktop') {
          this.updateStatus('processing', 'Screen will dim - drag to select area');
        } else if (response.method === 'tab') {
          this.updateStatus('processing', 'Screenshot captured! Analyzing...');
          // Tab capture completes immediately
          setTimeout(() => {
            this.updateStatus('ready', 'Ready for next capture');
            this.captureBtn.disabled = false;
          }, 2000);
        } else {
          this.updateStatus('ready', 'Capture completed');
          this.captureBtn.disabled = false;
        }
      } else {
        throw new Error(response?.error || 'Unknown capture error');
      }
      
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      this.updateStatus('error', 'Capture failed: ' + error.message);
      this.captureBtn.disabled = false;
      
      // Show detailed error in results section
      this.displayError('Screenshot capture failed. Try refreshing the page or check extension permissions.');
    }
  }
  
  async handleScreenshotCaptured(screenshotData) {
    try {
      // Update capture count
      const result = await chrome.storage.local.get(['captureCount']);
      const newCount = (result.captureCount || 0) + 1;
      await chrome.storage.local.set({ captureCount: newCount });
      this.captureCount.textContent = newCount;
      
      this.updateStatus('processing', 'Screenshot captured, processing...');
      
      // Analysis is handled automatically by background script based on settings
      // Just update UI to ready state
      setTimeout(() => {
        this.updateStatus('ready', 'Ready for next capture');
        this.captureBtn.disabled = false;
      }, 1000);
      
    } catch (error) {
      console.error('Failed to handle captured screenshot:', error);
      this.updateStatus('error', 'Processing failed');
      this.captureBtn.disabled = false;
    }
  }
  
  
  displayResults(data) {
    this.resultsContent.innerHTML = `
      <div class="result-item">
        <strong>Status:</strong> ${data.message || 'Screenshot analysis complete'}
      </div>
      <div class="result-item">
        <strong>Timestamp:</strong> ${data.timestamp || new Date().toLocaleString()}
      </div>
      ${data.analysis ? `
        <div class="result-item">
          <strong>AI Analysis:</strong> ${data.analysis}
        </div>
      ` : ''}
      ${data.overall_status ? `
        <div class="result-item">
          <strong>System Status:</strong> ${data.overall_status}
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
    
    text.textContent = message;
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});