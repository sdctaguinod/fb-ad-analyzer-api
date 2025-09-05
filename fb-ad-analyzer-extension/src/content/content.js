// Facebook Ad Analyzer - Content Script for Screenshot Capture
(function() {
  'use strict';

  let isCapturing = false;
  let captureOverlay = null;
  let selectionBox = null;
  let startX, startY, endX, endY;
  let isSelecting = false;
  let streamId = null;
  let mediaStream = null;

  // Initialize content script
  function init() {
    console.log('Screenshot Analyzer: Content script loaded');
    setupMessageListeners();
  }
  
  function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'START_SCREEN_CAPTURE':
          if (message.streamId) {
            // Desktop capture method (legacy)
            startDesktopCapture(message.streamId);
          } else if (message.imageDataUrl) {
            // Tab capture method with visual selection
            startTabCapture(message.imageDataUrl);
          }
          sendResponse({ success: true });
          break;
          
        case 'STOP_CAPTURE':
          stopScreenCapture();
          sendResponse({ success: true });
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    });
  }
  
  
  async function startDesktopCapture(captureStreamId) {
    if (isCapturing) return;
    
    streamId = captureStreamId;
    isCapturing = true;
    
    try {
      // Get media stream from the streamId
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        }
      });
      
      createScreenOverlay();
      
    } catch (error) {
      console.error('Failed to start screen capture:', error);
      stopScreenCapture();
    }
  }
  
  async function startTabCapture(imageDataUrl) {
    if (isCapturing) return;
    
    isCapturing = true;
    
    try {
      console.log('Starting tab capture with visual selection');
      
      // Create overlay with the captured image as background
      createTabCaptureOverlay(imageDataUrl);
      
    } catch (error) {
      console.error('Failed to start tab capture:', error);
      stopScreenCapture();
    }
  }
  
  function createTabCaptureOverlay(imageDataUrl) {
    // Create full-screen overlay with the captured image as background
    captureOverlay = document.createElement('div');
    captureOverlay.id = 'screenshot-overlay';
    captureOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-image: url(${imageDataUrl});
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      z-index: 999999;
      cursor: crosshair;
      user-select: none;
    `;
    
    // Add dark overlay for dimming effect
    const dimOverlay = document.createElement('div');
    dimOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(1px);
    `;
    
    // Create selection box
    selectionBox = document.createElement('div');
    selectionBox.id = 'selection-box';
    selectionBox.style.cssText = `
      position: absolute;
      border: 2px solid #007AFF;
      background: rgba(0, 122, 255, 0.1);
      display: none;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
      pointer-events: none;
    `;
    
    // Create instruction overlay
    const instruction = document.createElement('div');
    instruction.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 30px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 500;
      text-align: center;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      z-index: 1000000;
      transition: opacity 0.3s ease;
    `;
    instruction.innerHTML = `
      <div style="margin-bottom: 8px;">📸 Select Area to Capture</div>
      <div style="font-size: 14px; opacity: 0.8;">Drag to select area • Press ESC to cancel</div>
    `;
    
    // Add event listeners
    captureOverlay.addEventListener('mousedown', startTabSelection);
    captureOverlay.addEventListener('mousemove', updateSelection);
    captureOverlay.addEventListener('mouseup', endTabSelection);
    
    // ESC to cancel
    document.addEventListener('keydown', handleKeyPress);
    
    // Append to DOM
    captureOverlay.appendChild(dimOverlay);
    captureOverlay.appendChild(selectionBox);
    captureOverlay.appendChild(instruction);
    document.body.appendChild(captureOverlay);
    
    // Store the image data for later cropping
    captureOverlay.imageDataUrl = imageDataUrl;
    
    // Hide instruction after 3 seconds
    setTimeout(() => {
      if (instruction.parentNode) {
        instruction.style.opacity = '0';
        setTimeout(() => {
          if (instruction.parentNode) {
            instruction.remove();
          }
        }, 300);
      }
    }, 3000);
  }
  
  function startTabSelection(e) {
    if (e.target !== captureOverlay && e.target.parentNode !== captureOverlay) return;
    
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
    
    e.preventDefault();
  }
  
  async function endTabSelection(e) {
    if (!isSelecting) return;
    
    isSelecting = false;
    
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    // Minimum selection size
    if (width < 10 || height < 10) {
      selectionBox.style.display = 'none';
      return;
    }
    
    // Crop the captured image to selected area
    await cropTabCapture(left, top, width, height);
    
    e.preventDefault();
  }
  
  async function cropTabCapture(left, top, width, height) {
    try {
      const imageDataUrl = captureOverlay.imageDataUrl;
      
      // Create image element to load the captured screenshot
      const img = new Image();
      img.onload = () => {
        // Create canvas for cropping
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate scaling factors
        const scaleX = img.width / window.innerWidth;
        const scaleY = img.height / window.innerHeight;
        
        // Set canvas size to selected area
        canvas.width = width * scaleX;
        canvas.height = height * scaleY;
        
        // Draw the selected portion
        ctx.drawImage(
          img,
          left * scaleX, top * scaleY, width * scaleX, height * scaleY,
          0, 0, canvas.width, canvas.height
        );
        
        // Convert to base64
        const croppedImageDataUrl = canvas.toDataURL('image/png', 0.8);
        
        // Create screenshot data
        const screenshotData = {
          imageDataUrl: croppedImageDataUrl,
          dimensions: {
            width: canvas.width,
            height: canvas.height,
            originalWidth: width,
            originalHeight: height
          },
          selection: {
            left: left,
            top: top,
            width: width,
            height: height
          },
          timestamp: Date.now(),
          method: 'tab_capture',
          url: window.location.href,
          title: document.title
        };
        
        // Send to background script
        chrome.runtime.sendMessage({
          type: 'SCREENSHOT_SELECTED',
          data: screenshotData
        });
        
        // Clean up
        stopScreenCapture();
        
        // Show success feedback
        showCaptureSuccess();
      };
      
      img.src = imageDataUrl;
      
    } catch (error) {
      console.error('Failed to crop tab capture:', error);
      stopScreenCapture();
      showCaptureError(error.message);
    }
  }
  
  function createScreenOverlay() {
    // Create full-screen overlay with Mac-style dimming
    captureOverlay = document.createElement('div');
    captureOverlay.id = 'screenshot-overlay';
    captureOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.3);
      z-index: 999999;
      cursor: crosshair;
      user-select: none;
      backdrop-filter: blur(1px);
    `;
    
    // Create selection box
    selectionBox = document.createElement('div');
    selectionBox.id = 'selection-box';
    selectionBox.style.cssText = `
      position: absolute;
      border: 2px solid #007AFF;
      background: rgba(0, 122, 255, 0.1);
      display: none;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
      pointer-events: none;
    `;
    
    // Create instruction overlay
    const instruction = document.createElement('div');
    instruction.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 30px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 500;
      text-align: center;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      z-index: 1000000;
      transition: opacity 0.3s ease;
    `;
    instruction.innerHTML = `
      <div style="margin-bottom: 8px;">📸 Screenshot Capture</div>
      <div style="font-size: 14px; opacity: 0.8;">Drag to select area • Press ESC to cancel</div>
    `;
    
    // Add event listeners
    captureOverlay.addEventListener('mousedown', startSelection);
    captureOverlay.addEventListener('mousemove', updateSelection);
    captureOverlay.addEventListener('mouseup', endSelection);
    
    // ESC to cancel
    document.addEventListener('keydown', handleKeyPress);
    
    // Append to DOM
    captureOverlay.appendChild(selectionBox);
    captureOverlay.appendChild(instruction);
    document.body.appendChild(captureOverlay);
    
    // Hide instruction after 3 seconds
    setTimeout(() => {
      if (instruction.parentNode) {
        instruction.style.opacity = '0';
        setTimeout(() => {
          if (instruction.parentNode) {
            instruction.remove();
          }
        }, 300);
      }
    }, 3000);
  }
  
  function startSelection(e) {
    if (e.target !== captureOverlay) return;
    
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
    
    e.preventDefault();
  }
  
  function updateSelection(e) {
    if (!isSelecting) return;
    
    endX = e.clientX;
    endY = e.clientY;
    
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    
    e.preventDefault();
  }
  
  async function endSelection(e) {
    if (!isSelecting) return;
    
    isSelecting = false;
    
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    // Minimum selection size
    if (width < 10 || height < 10) {
      selectionBox.style.display = 'none';
      return;
    }
    
    // Capture the selected area
    await captureSelectedArea(left, top, width, height);
    
    e.preventDefault();
  }
  
  async function captureSelectedArea(left, top, width, height) {
    try {
      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = mediaStream;
      video.style.position = 'absolute';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      document.body.appendChild(video);
      
      // Wait for video to load
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
        video.play();
      });
      
      // Get screen dimensions
      const screenWidth = screen.width * devicePixelRatio;
      const screenHeight = screen.height * devicePixelRatio;
      
      // Calculate scaling factors
      const scaleX = screenWidth / window.innerWidth;
      const scaleY = screenHeight / window.innerHeight;
      
      // Create canvas for capture
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set canvas size to selected area
      canvas.width = width * scaleX;
      canvas.height = height * scaleY;
      
      // Draw the selected portion
      ctx.drawImage(
        video,
        left * scaleX, top * scaleY, width * scaleX, height * scaleY,
        0, 0, canvas.width, canvas.height
      );
      
      // Convert to base64
      const imageDataUrl = canvas.toDataURL('image/png', 0.8);
      
      // Create screenshot data
      const screenshotData = {
        imageDataUrl: imageDataUrl,
        dimensions: {
          width: canvas.width,
          height: canvas.height,
          originalWidth: width,
          originalHeight: height
        },
        selection: {
          left: left,
          top: top,
          width: width,
          height: height
        },
        timestamp: Date.now(),
        url: window.location.href,
        title: document.title
      };
      
      // Send to background script
      chrome.runtime.sendMessage({
        type: 'SCREENSHOT_SELECTED',
        data: screenshotData
      });
      
      // Clean up
      video.remove();
      stopScreenCapture();
      
      // Show success feedback
      showCaptureSuccess();
      
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      stopScreenCapture();
      showCaptureError(error.message);
    }
  }
  
  function handleKeyPress(e) {
    if (e.key === 'Escape' && isCapturing) {
      stopScreenCapture();
    }
  }
  
  function stopScreenCapture() {
    if (!isCapturing) return;
    
    isCapturing = false;
    isSelecting = false;
    
    // Clean up media stream
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    
    // Remove overlay
    if (captureOverlay) {
      captureOverlay.remove();
      captureOverlay = null;
    }
    
    // Remove selection box reference
    selectionBox = null;
    
    // Remove event listeners
    document.removeEventListener('keydown', handleKeyPress);
    
    streamId = null;
  }
  
  function showCaptureSuccess() {
    const successIndicator = document.createElement('div');
    successIndicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #28a745;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 1000000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s;
    `;
    successIndicator.innerHTML = '✅ Screenshot captured and analyzing...';
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(successIndicator);
    
    setTimeout(() => {
      if (successIndicator.parentNode) {
        successIndicator.remove();
      }
      style.remove();
    }, 3000);
  }
  
  function showCaptureError(message) {
    const errorIndicator = document.createElement('div');
    errorIndicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #dc3545;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 1000000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-width: 300px;
    `;
    errorIndicator.innerHTML = `❌ Capture failed: ${message}`;
    
    document.body.appendChild(errorIndicator);
    
    setTimeout(() => {
      if (errorIndicator.parentNode) {
        errorIndicator.remove();
      }
    }, 5000);
  }
  
  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();