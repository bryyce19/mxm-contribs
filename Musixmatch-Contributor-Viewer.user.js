// ==UserScript==
// @name         Musixmatch-Contributor-Viewer
// @author       Bryce
// @namespace    http://tampermonkey.net/
// @version      5.5.1
// @description  Removed jump buttons, added click-to-close, squashed some bugs, and did some other cool things. See the changelog.
// @icon         https://raw.githubusercontent.com/bryyce19/mxm-contribs/refs/heads/main/img/finallogosquare.png
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @grant        GM_xmlhttpRequest
// @connect      musixmatch.com
// @connect      opensheet.elk.sh
// @updateURL    https://github.com/bryyce19/mxm-contribs/raw/refs/heads/main/Musixmatch-Contributor-Viewer.user.js
// @downloadURL  https://github.com/bryyce19/mxm-contribs/raw/refs/heads/main/Musixmatch-Contributor-Viewer.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SHEET_URL = 'https://opensheet.elk.sh/1p_8KtGQG1F4ztIy_yGKGIo-T6Le_d5HmXuMERAhBIZM/Sheet1';
  const roleIcons = {
    specialist: 'https://github.com/bryyce19/mxm-contribs/blob/main/img/spec1.png?raw=true',
    curator: 'https://github.com/bryyce19/mxm-contribs/blob/main/img/curator1.png?raw=true',
    fallback: 'https://github.com/bryyce19/mxm-contribs/blob/main/img/grad1.png?raw=true'
  };
  const emojiFallback = { editor: '✍️', admin: '🛡' };
  const lockDisplay = {
    yes: ['🔓', 'Allows overwrites'],
    ask: ['🙋‍🔒', 'Ask before overwriting'],
    no: ['🔒', 'Does not allow overwrites'],
    staff: ['🛠️', 'Overwrite at your discretion'],
    'no / notify': ['🔒', 'Does not allow overwrites']
  };
  let contributors = [], lastLyricsUrl = '', lastTaskId = '',
    isDark = localStorage.getItem('mxmTheme') === null ? true : localStorage.getItem('mxmTheme') === 'dark',
    permissionData = {};
  let lastPermissionFetch = 0;
  const PERMISSION_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  let hasAcknowledgedWarning = false;
  let debugMode = false;
  let currentPageContributors = []; // track contributors for current page only
  let pendingFetches = new Map(); // Track pending fetches to prevent duplicates
  let fetchDebounceTimers = new Map(); // Track debounce timers

  // Simple resize variables
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;
  const MIN_WIDTH = 300; // Minimum width
  const MAX_WIDTH = window.innerWidth / 2; // Half screen width

  // enhanced debugging log funcction
  const debugLog = (...args) => {
    if (debugMode) {
      const timestamp = new Date().toISOString();
      const location = new Error().stack.split('\n')[2].trim();
      console.log(`[MXM Debug ${timestamp}]`, ...args);
      console.log(`[MXM Debug Location] ${location}`);

      // Log additional context if available
      if (args[0]?.includes('Error') || args[0]?.includes('Failed')) {
        console.log('[MXM Debug Context]', {
          currentPage: window.location.href,
          lastLyricsUrl,
          lastTaskId,
          currentContributors: currentPageContributors,
          permissionDataSize: Object.keys(permissionData).length,
          hasAcknowledgedWarning,
          isDark
        });
      }
    }
  };

  // Add debug state tracking
  const debugState = {
    lastAction: null,
    lastError: null,
    actionCount: 0,
    errorCount: 0,
    startTime: Date.now()
  };

  // Enhanced error logging
  const debugError = (error, context = {}) => {
    if (debugMode) {
      debugState.lastError = error;
      debugState.errorCount++;

      console.error('[MXM Debug Error]', {
        error: error.toString(),
        stack: error.stack,
        context,
        state: {
          ...debugState,
          uptime: Date.now() - debugState.startTime
        }
      });
    }
  };

  // Add performance tracking
  const debugPerformance = (label, startTime) => {
    if (debugMode) {
      const duration = Date.now() - startTime;
      console.log(`[MXM Debug Performance] ${label}: ${duration}ms`);
    }
  };

  const normalizeName = name => {
    if (!name) return '';
    const parts = name.trim().split(' ').filter(part => part.length > 0);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].toLowerCase();

    // Handle cases where second part is just a single letter (with or without period)
    const secondPart = parts[1].replace(/\.$/, ''); // Remove trailing period
    if (secondPart.length === 1) {
      return `${parts[0].toLowerCase()} ${secondPart.toLowerCase()}`;
    }
    if (secondPart.length > 1) {
      return `${parts[0].toLowerCase()} ${secondPart[0].toLowerCase()}`;
    }
    // If secondPart is empty, just return the first part
    return parts[0].toLowerCase();
  };

  const fetchPermissionData = () => new Promise(resolve => {
    const startTime = Date.now();
    debugLog('Fetching permission data...');

    const now = Date.now();
    // return cached data if it's still fresh
    if (permissionData && Object.keys(permissionData).length > 0 && (now - lastPermissionFetch) < PERMISSION_CACHE_DURATION) {
      debugLog('Using cached permission data');
      debugPerformance('Permission data cache hit', startTime);
      resolve(permissionData);
      return;
    }

    GM_xmlhttpRequest({
      method: 'GET',
      url: SHEET_URL,
      onload: res => {
        try {
          const rows = JSON.parse(res.responseText);
          const data = {};
          rows.forEach(row => {
            const key = row.name?.trim().toLowerCase();
            if (!key) return;

            const entry = {
              permission: (row.permission || '').toLowerCase(),
              note: row.note || '',
              language: row.language || '',
              musixmatch_link: row.musixmatch_link,
              slack_link: row.slack_link
            };

            // Store under raw key (lowercased)
            if (!data[key]) data[key] = [];
            data[key].push(entry);

            // Also store under normalized key to handle "Name M." vs "Name M" issues
            const normalizedKey = normalizeName(row.name);
            if (normalizedKey && normalizedKey !== key) {
              if (!data[normalizedKey]) data[normalizedKey] = [];
              data[normalizedKey].push(entry);
            }
          });
          permissionData = data;
          lastPermissionFetch = now;
          debugLog(`Successfully loaded permission data for ${Object.keys(data).length} contributors`);
          debugPerformance('Permission data fetch', startTime);
          resolve(data);
        } catch (error) {
          debugError(error, { responseText: res.responseText });
          resolve({});
        }
      },
      onerror: error => {
        debugError(error, { url: SHEET_URL });
        resolve({});
      }
    });
  });

  // --- CSS STYLES ---
  const STYLES = `
      :root {
        --mxm-cv-bg: #ffffff;
        --mxm-cv-text: #111111;
        --mxm-cv-text-secondary: #666666;
        --mxm-cv-border: #ddd;
        --mxm-cv-accent: #FC542E;
        --mxm-cv-hover: #f4f4f4;
        --mxm-cv-shadow: rgba(0,0,0,0.1);
        --mxm-cv-scrollbar-thumb: #ddd;
      }
      
      [data-mxm-theme="dark"] {
        --mxm-cv-bg: #1e1e1e;
        --mxm-cv-text: #ffffff;
        --mxm-cv-text-secondary: #aaaaaa;
        --mxm-cv-border: #444;
        --mxm-cv-hover: #2a2a2a;
        --mxm-cv-shadow: rgba(0,0,0,0.4);
        --mxm-cv-scrollbar-thumb: #444;
      }

      /* Animations */
      @keyframes mxm-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes mxm-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes mxm-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      @keyframes mxm-popupFadeIn { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }

      .mxm-fade-in { animation: mxm-fadeIn 0.4s ease-in-out; }

      /* Panel */
      .mxm-panel {
        position: fixed;
        top: 100px;
        right: 20px;
        max-height: 70vh;
        overflow-y: auto !important;
        background: var(--mxm-cv-bg);
        color: var(--mxm-cv-text);
        font-family: 'Helvetica Neue', sans-serif;
        font-size: 14px;
        border: 1px solid var(--mxm-cv-border);
        border-radius: 10px;
        padding: 1.2em;
        box-shadow: 0 8px 16px var(--mxm-cv-shadow);
        display: none;
        z-index: 9999999 !important;
        pointer-events: auto !important;
      }
      .mxm-panel::-webkit-scrollbar { width: 6px; }
      .mxm-panel::-webkit-scrollbar-thumb { background-color: var(--mxm-cv-scrollbar-thumb); border-radius: 8px; }
      .mxm-panel::-webkit-scrollbar-track { background-color: transparent; }
      
      .mxm-panel.resizable-left { cursor: ew-resize; }

      /* Buttons & Controls */
      .mxm-btn-icon {
        cursor: pointer;
        border: none;
        background: transparent;
        color: var(--mxm-cv-text);
        transition: transform 0.2s ease;
      }
      .mxm-btn-icon:hover { transform: scale(1.1); }
      
      .mxm-main-btn {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 40px;
        height: 40px;
        background-color: var(--mxm-cv-hover);
        color: var(--mxm-cv-text);
        font-size: 18px;
        border: 1px solid var(--mxm-cv-border);
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        cursor: pointer;
        z-index: 99999;
        display: none;
        transition: all 0.2s ease;
      }
      .mxm-main-btn:hover { transform: scale(1.05); background: var(--mxm-cv-border); }

      .mxm-theme-toggle {
        position: absolute;
        top: 10px;
        right: 34px;
        font-size: 14px;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
      }


      /* Contributors List */
      .mxm-contributor-entry {
        margin-bottom: 12px;
        padding: 6px 4px;
      }
      .mxm-role-icon {
        width: 16px;
        height: 16px;
        vertical-align: middle;
        margin-right: 5px;
        border-radius: 3px;
      }
      .mxm-lock-icon { font-size: 14px; margin-right: 4px; vertical-align: middle; }
      
      .mxm-most-recent {
        background: var(--mxm-cv-hover);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
        border: 1px solid var(--mxm-cv-border);
      }
      
      .mxm-load-more {
        width: 100%;
        padding: 10px;
        margin-top: 16px;
        background: var(--mxm-cv-hover);
        border: 1px solid var(--mxm-cv-border);
        border-radius: 8px;
        color: var(--mxm-cv-text);
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
      }
      .mxm-load-more:hover { background: var(--mxm-cv-border); }

      /* Links & Text */
      .mxm-link {
        color: var(--mxm-cv-text);
        text-decoration: none;
        font-size: 16px;
        margin-right: 10px;
        transition: color 0.2s ease;
      }
      .mxm-link:hover { color: #4EA9FF; }
      
      .mxm-text-secondary { color: var(--mxm-cv-text-secondary); }
      .mxm-month-header {
        color: var(--mxm-cv-text-secondary);
        font-size: 1em;
        font-weight: 600;
        margin: 20px 0 12px 0;
        padding: 4px 0;
        border-bottom: 1px solid var(--mxm-cv-border);
        letter-spacing: 0.5px;
      }

      /* Dropdowns */
      .mxm-dropdown-content {
        margin-top: 6px;
        padding: 6px 10px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        font-size: 13px;
        color: inherit;
        display: none;
      }
      .mxm-dropdown-toggle {
        margin-left: 8px;
        font-size: 13px;
        cursor: pointer;
        color: #aaa;
        transition: transform 0.3s ease;
      }
      .mxm-dropdown-toggle.rotated { transform: rotate(180deg); }

      /* Error / Info Cards */
      .mxm-info-card {
        margin-top: 16px;
        padding: 16px;
        background: var(--mxm-cv-hover);
        border-radius: 8px;
        border-left-width: 4px;
        border-left-style: solid;
        box-shadow: 0 2px 6px rgba(0,0,0,0.05);
      }
      .mxm-info-header {
        font-weight: 600;
        color: var(--mxm-cv-text);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
      }
      .mxm-info-body {
        color: var(--mxm-cv-text-secondary);
        font-size: 13px;
        line-height: 1.5;
      }
      .mxm-info-list { margin: 0; padding-left: 20px; }
      
      /* Popup */
      .mxm-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--mxm-cv-bg);
        border: 1px solid var(--mxm-cv-border);
        border-radius: 12px;
        padding: 28px;
        z-index: 1000000;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        max-width: 420px;
        width: 90%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
        animation: mxm-popupFadeIn 0.3s ease-out;
      }
      
      .mxm-popup-btn {
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        min-width: 120px;
        transition: all 0.2s ease;
      }
      .mxm-popup-btn-secondary {
        border: 1px solid var(--mxm-cv-border);
        background: var(--mxm-cv-hover);
        color: var(--mxm-cv-text);
      }
      .mxm-popup-btn-secondary:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
      .mxm-popup-btn-primary {
        border: none;
        background: var(--mxm-cv-accent);
        color: white;
      }
      .mxm-popup-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(252, 84, 46, 0.3); }

      /* Popup Minimal Info */
      .mxm-popup-info {
        background: transparent;
        border: none;
        padding: 0;
        margin-top: 12px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: left;
      }
      .mxm-popup-btn-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        color: var(--mxm-cv-text);
        font-size: 20px;
        cursor: pointer;
        text-decoration: none !important; /* Remove underline */
        transition: color 0.2s ease;
      }
      .mxm-popup-btn-icon:hover {
        transform: none; /* No scaling */
        color: var(--mxm-cv-accent); /* Orange on hover */
      }

      /* Loading */
      .mxm-loading-dots { display: inline-flex; align-items: center; gap: 4px; }
      .mxm-loading-dots span {
        width: 6px;
        height: 6px;
        background: var(--mxm-cv-accent);
        border-radius: 50%;
        animation: mxm-bounce 0.6s infinite;
      }
      .mxm-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
      .mxm-loading-dots span:nth-child(3) { animation-delay: 0.4s; }

      /* Context Menu */
      .mxm-context-menu {
        position: fixed;
        background: var(--mxm-cv-bg);
        border: 1px solid var(--mxm-cv-border);
        border-radius: 8px;
        padding: 6px 0;
        box-shadow: 0 4px 12px var(--mxm-cv-shadow);
        z-index: 1000000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
        min-width: 180px;
      }
      .mxm-context-item {
        padding: 8px 16px;
        cursor: pointer;
        color: var(--mxm-cv-text);
        font-size: 13px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .mxm-context-item:hover {
        background: var(--mxm-cv-hover);
        transform: translateX(2px);
      }
      
      @keyframes mxm-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.15); }
        100% { transform: scale(1); }
      }
      .mxm-popup-emoji { display: inline-block; animation: mxm-pulse 2s infinite ease-in-out; }

      /* Resize Handle */
      .mxm-resize-handle {
        position: absolute;
        top: 0;
        left: 0;
        width: 12px;
        height: 100%;
        cursor: ew-resize;
        z-index: 10;
        background: transparent;
      }
      
      /* Contact Card Design */
      .mxm-contact-card {
        background: transparent;
        padding: 4px 8px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
        text-align: left;
      }
      .mxm-contact-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .mxm-contact-icon {
        color: var(--mxm-cv-accent);
        font-size: 14px;
        width: 16px;
        text-align: center;
      }
      .mxm-contact-content {
        flex: 1;
        font-size: 13px;
        color: var(--mxm-cv-text);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mxm-contact-label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--mxm-cv-text-secondary);
        font-weight: 700;
        margin-right: 4px;
      }
      .mxm-contact-value {
        font-weight: 500;
      }
      
      /* Detailed Actions */
      .mxm-contact-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-top: 6px;
        padding-top: 8px;
        border-top: 1px solid var(--mxm-cv-border);
      }
      .mxm-contact-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 6px;
        background: var(--mxm-cv-bg);
        color: var(--mxm-cv-text);
        font-size: 16px;
        text-decoration: none;
        transition: all 0.2s ease;
        border: 1px solid var(--mxm-cv-border);
      }
      .mxm-contact-btn:hover {
        background: var(--mxm-cv-hover);
        color: var(--mxm-cv-accent);
        transform: translateY(-1px);
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      }
    `;

  const injectStyles = () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES.replace('.mxm-link:hover { color: #4EA9FF; }', '.mxm-link:hover { color: var(--mxm-cv-accent); }');
    document.head.appendChild(styleEl);
  };
  injectStyles();

  const fontAwesome = document.createElement('link');
  fontAwesome.rel = 'stylesheet';
  fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
  document.head.appendChild(fontAwesome);


  // Get saved panel width or use default
  // Get saved panel width or use default
  const savedWidth = localStorage.getItem('mxmPanelWidth');
  const panelWidth = savedWidth ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(savedWidth))) : 360;

  const panel = document.createElement('div');
  panel.className = 'mxm-panel';
  panel.style.width = `${panelWidth}px`;
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'mxm-resize-handle';
  panel.appendChild(resizeHandle);
  document.body.appendChild(panel);


  const button = document.createElement('button');
  button.innerHTML = '👥';
  button.title = 'View Contributors';
  button.className = 'mxm-main-btn';
  document.body.appendChild(button);

  const themeToggle = document.createElement('button');
  themeToggle.textContent = '🌗';
  themeToggle.className = 'mxm-theme-toggle mxm-btn-icon';


  // List of elements that need theme attributes
  const themeElements = [panel, button];

  const setElementTheme = (el, dark) => {
    if (el) el.setAttribute('data-mxm-theme', dark ? 'dark' : 'light');
  };

  const updateTheme = () => {
    isDark = !isDark;
    localStorage.setItem('mxmTheme', isDark ? 'dark' : 'light');
    debugLog('Theme updated:', { isDark });
    themeElements.forEach(el => setElementTheme(el, isDark));
  };

  const applyTheme = () => {
    debugLog('Applying initial theme:', { isDark });
    themeElements.forEach(el => setElementTheme(el, isDark));
  };

  // Call applyTheme when the script starts
  applyTheme();

  // Simple resize functionality
  const startResize = (e) => {
    const rect = panel.getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    if (clickX <= 10) {
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startWidth = parseInt(panel.style.width);
      panel.classList.add('resizable-left');
    }
  };

  const doResize = (e) => {
    if (!isResizing) return;

    const deltaX = startX - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));
    panel.style.width = `${newWidth}px`;
  };

  const stopResize = () => {
    if (isResizing) {
      const finalWidth = parseInt(panel.style.width);
      localStorage.setItem('mxmPanelWidth', finalWidth.toString());
    }
    isResizing = false;
    panel.classList.remove('resizable-left');
  };

  // Add resize event listeners directly to panel
  // Add resize event listeners directly to panel
  panel.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);

  // Prevent clicks inside panel from closing it (if click-outside logic is active)
  panel.onclick = (e) => {
    e.stopPropagation();
  };

  themeToggle.onclick = updateTheme;

  const renderDropdown = (entries = []) => {
    const el = document.createElement('div');
    el.className = 'mxm-dropdown-content mxm-fade-in';
    entries.forEach((entry, i) => {
      const [icon, label] = lockDisplay[entry.permission] || ['🔒', '—'];
      el.innerHTML += `
          <div><b>Language:</b> ${entry.language || '—'}</div>
          <div><b>Permission:</b> ${label}</div>
          <div><b>Note:</b> ${entry.note || '—'}</div>
          <div style="margin-top:6px;">
          ${entry.musixmatch_link ? `<a href="${entry.musixmatch_link}" target="_blank" class="mxm-link"><i class="fas fa-user-circle"></i></a>` : ''}
          ${entry.slack_link ? `<a href="${entry.slack_link}" target="_blank" class="mxm-link"><i class="fab fa-slack"></i></a>` : ''}
          </div>
          ${i < entries.length - 1 ? '<hr style="border-color:var(--mxm-cv-border);">' : ''}
        `;
    });
    return el;
  };

  const renderContributors = (filtered, isAutoRefresh = false) => {
    if (!filtered || filtered.length === 0) {
      showMessage(`⚠️No contributor data found for this track`);
      return;
    }

    // Debug log the filtered data
    debugLog('Rendering contributors:', {
      totalContributors: filtered.length,
      firstContributor: filtered[0],
      allContributors: filtered.map(c => ({ name: c.name, role: c.role, type: c.type })),
      isAutoRefresh
    });

    //  auto-refresh indicator
    const titleText = isAutoRefresh ?
      '<strong style="font-size: 1.3em; display:block; margin-bottom: 12px;">Contributors <span id="mxm-refresh-indicator" style="font-size: 0.8em; color: var(--mxm-cv-accent); font-weight: normal;">refreshing...</span></strong>' :
      '<strong style="font-size: 1.3em; display:block; margin-bottom: 12px;">Contributors</strong>';

    panel.innerHTML = titleText;

    // Remove refresh indicator after 3 seconds if this is an auto-refresh
    if (isAutoRefresh) {
      setTimeout(() => {
        const indicator = panel.querySelector('#mxm-refresh-indicator');
        if (indicator) {
          indicator.textContent = '';
        }
      }, 3000);
    }

    // Clear panel
    panel.innerHTML = titleText;

    // Add header controls (Close, Theme, Copy)
    renderHeaderControls(panel);

    // --- Click Outside to Close Panel ---
    setupClickOutsideClose(panel, button, themeToggle);

    // add most recent section
    const mostRecent = filtered[0];

    // Debug log
    debugLog('Most recent contributor:', {
      name: mostRecent.name,
      role: mostRecent.role,
      type: mostRecent.type,
      date: mostRecent.date
    });

    const mostRecentSection = document.createElement('div');
    mostRecentSection.className = 'mxm-most-recent';

    const roleKey = mostRecent.role.toLowerCase();
    const isSpecialist = roleKey === 'specialist';
    const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
    const iconHTML = iconSrc.startsWith('http') ? `<img class="mxm-role-icon" src="${iconSrc}" draggable="false" oncontextmenu="return false">` : `<span class="mxm-role-icon">${iconSrc}</span>`;
    const keyExact = mostRecent.name.toLowerCase(), keyInit = normalizeName(mostRecent.name);
    const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
    const firstPerm = matchRows[0]?.permission;
    const lock = lockDisplay[firstPerm] ? `<span class="mxm-lock-icon" title="${lockDisplay[firstPerm][1]}">${lockDisplay[firstPerm][0]}</span>` : '';

    const overwriteStatus = firstPerm === 'no' ?
      '<span style="color: #ff4444;">Don\'t overwrite</span>' :
      firstPerm === 'yes' ?
        '<span style="color: #2ecc71;">Overwrites allowed</span>' :
        firstPerm === 'ask' ?
          '<span style="color: #ffbb00;">Ask first</span>' :
          '<span style="color: #888;">No overwrite info</span>';

    mostRecentSection.innerHTML = `
      <div style="font-size: 0.9em; color: var(--mxm-cv-text-secondary); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <i class="fas fa-clock" style="color: var(--mxm-cv-accent)"></i>
        Most recent
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="display: flex; align-items: center;">
            <strong style="color: var(--mxm-cv-accent);">${firstPerm ? lock : ''}${iconHTML}${mostRecent.name}</strong>
            ${isSpecialist && matchRows.length ? '<i class="fas fa-chevron-down mxm-dropdown-toggle"></i>' : ''}
          </div>
          <div style="font-size: 0.9em; color: var(--mxm-cv-text-secondary);">${mostRecent.type.replace(/_/g, ' ')}</div>
        </div>
        <div style="text-align: right;">
          ${overwriteStatus}
          <div style="font-size: 0.8em; color: var(--mxm-cv-text-secondary);">${mostRecent.date.toLocaleDateString()}</div>
        </div>
      </div>
    `;

    if (matchRows.length && isSpecialist) {
      const dropdown = renderDropdown(matchRows);
      const toggleBtn = mostRecentSection.querySelector('.mxm-dropdown-toggle');
      toggleBtn.onclick = () => {
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
        toggleBtn.classList.toggle('rotated', !isOpen);
      };
      mostRecentSection.appendChild(dropdown);
    }

    panel.appendChild(mostRecentSection);

    const latest = filtered[0]?.name;
    let currentMonth = null;
    let entriesInCurrentMonth = 0;
    let displayedCount = 0;
    const BATCH_SIZE = 20;

    // Function to render a single contributor entry
    const renderContributorEntry = ({ name, role, type, date }) => {
      // Debug log
      debugLog('Rendering contributor entry:', { name, role, type, date });

      const roleKey = role.toLowerCase();
      const isSpecialist = roleKey === 'specialist';
      const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
      const iconHTML = iconSrc.startsWith('http') ? `<img class="mxm-role-icon" src="${iconSrc}" draggable="false" oncontextmenu="return false">` : `<span class="mxm-role-icon">${iconSrc}</span>`;
      const keyExact = name.toLowerCase(), keyInit = normalizeName(name);
      const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
      const firstPerm = matchRows[0]?.permission;

      const entry = document.createElement('div');
      entry.className = 'mxm-fade-in mxm-contributor-entry';

      const mainLine = document.createElement('div');
      mainLine.style = 'display:flex; justify-content:space-between; align-items:center;';

      const nameBlock = document.createElement('div');
      nameBlock.innerHTML = `<strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; color: var(--mxm-cv-text);">${iconHTML}${name}</strong>`;

      const metaLine = document.createElement('div');
      metaLine.className = 'mxm-text-secondary';
      metaLine.style = 'font-size: 13px; margin-top: 2px;';
      metaLine.textContent = type.replace(/_/g, ' ');

      const timeBlock = document.createElement('div');
      timeBlock.className = 'mxm-text-secondary';
      timeBlock.style = 'font-size: 0.8em; text-align: right;';
      timeBlock.innerHTML = `${date.toLocaleDateString()}<br><span style="opacity: 0.6;">${date.toLocaleTimeString()}</span>`;

      const toggleBtn = document.createElement('span');
      toggleBtn.className = 'mxm-dropdown-toggle';
      toggleBtn.innerHTML = isSpecialist && matchRows.length ? '<i class="fas fa-chevron-down"></i>' : '';

      const nameRow = document.createElement('div');
      nameRow.style = 'display: flex; align-items: center;';
      nameRow.appendChild(nameBlock);
      if (toggleBtn.innerHTML) nameRow.appendChild(toggleBtn);

      const leftColumn = document.createElement('div');
      leftColumn.appendChild(nameRow);
      leftColumn.appendChild(metaLine);

      mainLine.appendChild(leftColumn);
      mainLine.appendChild(timeBlock);
      entry.appendChild(mainLine);

      if (matchRows.length && isSpecialist) {
        const dropdown = renderDropdown(matchRows);
        toggleBtn.onclick = () => {
          const isOpen = dropdown.style.display === 'block';
          dropdown.style.display = isOpen ? 'none' : 'block';
          toggleBtn.classList.toggle('rotated', !isOpen);
        };
        entry.appendChild(dropdown);
      }

      return entry;
    };

    // Function to load more contributors
    const loadMoreContributors = () => {
      const startIndex = displayedCount;
      const endIndex = Math.min(startIndex + BATCH_SIZE, filtered.length);

      for (let i = startIndex; i < endIndex; i++) {
        const contributor = filtered[i];

        // Add month header if it's a new month
        const monthYear = contributor.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (monthYear !== currentMonth) {
          currentMonth = monthYear;
          entriesInCurrentMonth = 0;
          const monthHeader = document.createElement('div');
          monthHeader.className = 'mxm-month-header';
          monthHeader.textContent = monthYear;
          panel.appendChild(monthHeader);
        }

        const entry = renderContributorEntry(contributor);
        panel.appendChild(entry);
        displayedCount++;
        entriesInCurrentMonth++;
      }

      // Update or remove the "Load More" button
      if (displayedCount < filtered.length) {
        if (!loadMoreBtn.parentNode) {
          panel.appendChild(loadMoreBtn);
        }
        loadMoreBtn.textContent = `Load More (${filtered.length - displayedCount} remaining)`;
      } else if (loadMoreBtn.parentNode) {
        loadMoreBtn.parentNode.removeChild(loadMoreBtn);
      }
    };

    // Create the "Load More" button
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'mxm-load-more';
    loadMoreBtn.onclick = loadMoreContributors;

    // Load the first batch
    loadMoreContributors();


  };

  const showMessage = (msg, color = '#aaa') => {
    // determine icon and color based on message content
    let icon, borderColor;

    if (msg.includes('❌')) {
      icon = '<i class="fas fa-exclamation-circle" style="color: #ff4444; font-size: 24px;"></i>';
      borderColor = '#ff4444';
    } else if (msg.includes('⚠️')) {
      icon = '<i class="fas fa-exclamation-triangle" style="color: #ffbb00; font-size: 24px;"></i>';
      borderColor = '#ffbb00';
    } else {
      icon = '<i class="fas fa-info-circle" style="color: #4EA9FF; font-size: 24px;"></i>';
      borderColor = '#4EA9FF';
    }

    // clean message (remove emojis)
    const cleanMsg = msg.replace(/[❌⚠️]/, '').trim();

    // Create technical info
    const technicalInfo = {
      'Track ID': lastTaskId || 'Not available',
      'Lyrics URL': button.dataset.lyricsUrl || 'Not available',
      'Current Page': window.location.href,
      'Contributors Found': currentPageContributors.length,
      'Permission Data': Object.keys(permissionData).length + ' entries loaded',
      'Last Fetch': lastLyricsUrl ? new Date().toLocaleTimeString() : 'Never',
      'User Agent': navigator.userAgent.substring(0, 50) + '...',
      'Script Version': '5.2.1',
      'Debug Mode': debugMode ? 'Enabled' : 'Disabled',
      'Theme': isDark ? 'Dark' : 'Light',
      'Panel Display': panel.style.display === 'block' ? 'Visible' : 'Hidden',
      'Button Display': button.style.display === 'block' ? 'Visible' : 'Hidden',
      'Page Load Time': new Date().toLocaleTimeString(),
      'URL Parameters': location.search || 'None',
      'Referrer': document.referrer || 'None',
      'Viewport Size': `${window.innerWidth}x${window.innerHeight}`,
      'Screen Size': `${screen.width}x${screen.height}`,
      'Language': navigator.language || 'Unknown',
      'Online Status': navigator.onLine ? 'Online' : 'Offline',
      'Cookie Enabled': navigator.cookieEnabled ? 'Yes' : 'No',
      'Do Not Track': navigator.doNotTrack || 'Not set',
      'Memory Usage': performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)}MB used / ${Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)}MB total` : 'Not available',
      'Time Origin': new Date(performance.timeOrigin).toLocaleTimeString()
    };

    // Create next steps based on message content
    let nextSteps = '';
    if (msg.includes('No contributor data found')) {
      nextSteps = `
        <div class="mxm-info-card" style="border-left-color: ${borderColor};">
          <div class="mxm-info-header">
            <i class="fas fa-lightbulb" style="color: ${borderColor};"></i>
            Next Steps
          </div>
          <ul class="mxm-info-list mxm-info-body">
            <li>If this is a new track, you can safely proceed with your work</li>
            <li>Manually check the <a href="${button.dataset.lyricsUrl || '#'}" target="_blank" style="color: ${borderColor}; text-decoration: none;">song page</a> before continuing</li>
            <li>Contact Bryce M. on Slack if you believe this is an error</li>
          </ul>
        </div>
      `;
    } else if (msg.includes('/tool')) {
      nextSteps = `
        <div class="mxm-info-card" style="border-left-color: ${borderColor};">
          <div class="mxm-info-header">
            <i class="fas fa-external-link-alt" style="color: ${borderColor};"></i>
            Action Required
          </div>
          <div class="mxm-info-body">
            Navigate to a track's studio page (URL contains <code>/tool</code>) to view contributors.
          </div>
        </div>
      `;
    } else if (msg.includes('track info tab')) {
      nextSteps = `
        <div class="mxm-info-card" style="border-left-color: ${borderColor};">
          <div class="mxm-info-header">
            <i class="fas fa-info-circle" style="color: ${borderColor};"></i>
            Required Action
          </div>
          <div class="mxm-info-body">
            Open the track info tab first to load contributor data for this song.
          </div>
        </div>
      `;
    } else if (msg.includes('Failed to load')) {
      nextSteps = `
        <div class="mxm-info-card" style="border-left-color: ${borderColor};">
          <div class="mxm-info-header">
            <i class="fas fa-tools" style="color: ${borderColor};"></i>
            Troubleshooting
          </div>
          <ul class="mxm-info-list mxm-info-body">
            <li>If the song displays "Unfortunately we're not authorized
                to show these lyrics..." when logged out, the script cannot fetch the lyrics</li>
            <li>If this is a new song, there may be no contributors yet, and you can safely continue working</li>
            <li>Refresh the page and try again</li>
            <li>Check your internet connection</li>
            <li>Contact Bryce on Slack if the issue persists</li>
          </ul>
        </div>
      `;
    }

    // Create technical info dropdown
    const technicalInfoHtml = `
      <div style="margin-top: 12px;">
        <button id="mxm-tech-toggle" style="
          background: var(--mxm-cv-bg);
          border: 1px solid var(--mxm-cv-border);
          border-radius: 6px;
          padding: 8px 12px;
          color: var(--mxm-cv-text-secondary);
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          text-align: left;
          transition: all 0.2s ease;
        ">
          <i class="fas fa-code" style="color: var(--mxm-cv-accent);"></i>
          Technical Information
          <i class="fas fa-chevron-down" style="margin-left: auto; transition: transform 0.2s ease;"></i>
        </button>
        <div id="mxm-tech-content" style="
          display: none;
          margin-top: 8px;
          padding: 12px;
          background: var(--mxm-cv-hover);
          border-radius: 6px;
          border: 1px solid var(--mxm-cv-border);
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 11px;
          line-height: 1.4;
          color: var(--mxm-cv-text-secondary);
          max-height: 200px;
          overflow-y: auto;
        ">
          ${Object.entries(technicalInfo).map(([key, value]) =>
      `<div style="margin-bottom: 4px;"><span style="color: var(--mxm-cv-accent);">${key}:</span> ${value}</div>`
    ).join('')}
        </div>
      </div>
    `;

    panel.innerHTML = `
      <div class="mxm-fade-in" style="
        color: var(--mxm-cv-text);
        text-align: left;
        padding: 20px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      ">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          ${icon}
          <div style="
            font-size: 16px;
            font-weight: 600;
            color: var(--mxm-cv-text);
          ">${cleanMsg}</div>
        </div>
        ${nextSteps}
        ${technicalInfoHtml}
      </div>`;

    // Add dropdown functionality
    setTimeout(() => {
      const toggleBtn = document.getElementById('mxm-tech-toggle');
      const content = document.getElementById('mxm-tech-content');
      const chevron = toggleBtn?.querySelector('.fa-chevron-down');

      if (toggleBtn && content) {
        toggleBtn.onclick = () => {
          const isOpen = content.style.display === 'block';
          content.style.display = isOpen ? 'none' : 'block';
          if (chevron) {
            chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
          }
        };

        // Hover effects
        toggleBtn.onmouseenter = () => {
          toggleBtn.style.background = 'var(--mxm-cv-hover)';
        };
        toggleBtn.onmouseleave = () => {
          toggleBtn.style.background = 'var(--mxm-cv-bg)';
        };
      }
    }, 100);

    renderHeaderControls(panel);
    panel.style.display = 'block';
    setupClickOutsideClose(panel, button, themeToggle);
  };

  // debounced fetch function to wait for page stability
  // Must be defined before the observer that uses it.
  const debouncedFetchContributorData = (lyricsUrl, delay = 500) => {
    const fetchKey = lyricsUrl;

    // Clear existing timer for this URL
    if (fetchDebounceTimers.has(fetchKey)) {
      clearTimeout(fetchDebounceTimers.get(fetchKey));
    }

    // Set new timer
    const timer = setTimeout(() => {
      fetchDebounceTimers.delete(fetchKey);
      fetchContributorData(lyricsUrl).then(contributors => {
        if (contributors) {
          currentPageContributors = contributors;

          // Auto-refresh panel if it's already open
          if (panel.style.display === 'block') {
            debugLog('Panel is open, auto-refreshing with new contributors');
            renderContributors(contributors, true);
          }
        }
      }).catch(err => {
        debugError(err, { url: lyricsUrl, context: 'debouncedFetchContributorData' });
      });
    }, delay);

    fetchDebounceTimers.set(fetchKey, timer);
    debugLog('Debounced fetch scheduled:', { url: lyricsUrl, delay: delay });
  };

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        // try to get lyrics url from page url first
        const trackId = new URLSearchParams(location.search).get('commontrack_id');

        // Only log if we found a track ID and it's different from the last one
        if (trackId && trackId !== lastTaskId) {
          debugLog('Page changed:', {
            pathname: location.pathname,
            search: location.search,
            trackId,
            referrer: document.referrer,
            hasToolMode: location.search.includes('mode=edit')
          });

          // Reset data when page changes
          currentPageContributors = [];
          hasAcknowledgedWarning = false;
          debugLog('Page changed, resetting contributor data');

          // try to get artist id from page
          const artistIdMatch = document.querySelector('a[href*="/artist/"]')?.href?.match(/\/artist\/(\d+)/);
          const artistId = artistIdMatch ? artistIdMatch[1] : '54823687'; // fallback to default if not found

          // Extract artist name from referrer URL if available
          let artistName;
          try {
            if (document.referrer && document.referrer.includes('musixmatch.com/lyrics/')) {
              const referrerUrl = new URL(document.referrer);
              artistName = referrerUrl.pathname.split('/lyrics/')[1]?.split('/')[0];
            }
          } catch (error) {
            debugLog('Error parsing referrer URL:', error);
          }

          debugLog('URL Info:', {
            artistId,
            artistName,
            trackId,
            referrer: document.referrer,
            referrerPath: document.referrer ? new URL(document.referrer).pathname : null
          });

          // Construct lyrics URL based on available information
          let lyricsUrl;
          if (artistName && document.referrer.includes('musixmatch.com/lyrics/')) {
            // Use artist name for public pages
            lyricsUrl = `https://www.musixmatch.com/lyrics/${artistName}/${trackId}`;
            debugLog('Using public lyrics URL with artist name');
          } else {
            // Use artist ID for studio pages
            lyricsUrl = `https://www.musixmatch.com/lyrics/${artistId}/${trackId}`;
            debugLog('Using studio lyrics URL with artist ID');
          }

          button.dataset.lyricsUrl = lyricsUrl;
          lastTaskId = trackId;
          button.style.display = 'block';

          // Fetch contributor data with debounce to ensure page is stable
          debouncedFetchContributorData(lyricsUrl, 500);
          return;
        }

        // fallback to looking for lyrics link
        const a = node.querySelector?.('a[href*="/lyrics/"]');
        if (a) {
          const href = a.getAttribute('href');
          // support all url patterns including beta site
          if (/^\/\/www\.musixmatch\.com\/lyrics\/\d+\/\d+$/.test(href) ||
            /^\/\/curators-beta\.musixmatch\.com\/lyrics\/\d+\/\d+$/.test(href) ||
            /^\/lyrics\/\d+\/\d+$/.test(href) ||
            /^\/\/com-beta\.musixmatch\.com\/lyrics\/\d+\/\d+$/.test(href)) {
            const url = href.startsWith('//') ? `https:${href}` : `https://curators-beta.musixmatch.com${href}`;
            const newTaskId = new URLSearchParams(location.search).get('commontrack_id');

            // Only log if we found a new task ID
            if (newTaskId && newTaskId !== lastTaskId) {
              debugLog('Found lyrics link:', {
                href: a.getAttribute('href'),
                text: a.textContent,
                newTaskId
              });

              // Reset data when page changes
              currentPageContributors = [];
              hasAcknowledgedWarning = false;
              debugLog('Page changed, resetting contributor data');

              button.dataset.lyricsUrl = url;
              lastTaskId = newTaskId;
              button.style.display = 'block';

              // Fetch contributor data with debounce to ensure page is stable
              debouncedFetchContributorData(url, 500);
            }
          }
        }
      }
    }
  });

  // Start observing the document
  observer.observe(document.body, { childList: true, subtree: true });
  debugLog('Initial observer setup complete', {
    url: window.location.href,
    pathname: location.pathname,
    search: location.search,
    referrer: document.referrer
  });

  // Add new function to fetch contributor data with retry logic
  let fetchContributorData = (lyricsUrl, retryCount = 0, maxRetries = 3) => {
    const fetchKey = lyricsUrl;

    // Prevent duplicate simultaneous fetches for the same URL
    if (pendingFetches.has(fetchKey)) {
      debugLog('Fetch already in progress for URL, returning existing promise:', lyricsUrl);
      return pendingFetches.get(fetchKey);
    }
    const startTime = Date.now();
    debugLog('Fetching contributor data:', {
      url: lyricsUrl,
      retryAttempt: retryCount,
      maxRetries: maxRetries,
      timestamp: new Date().toISOString(),
      referrer: document.referrer,
      currentPage: window.location.href
    });
    debugState.lastAction = 'fetchContributorData';
    debugState.actionCount++;

    // Extract song info from URL
    const songInfo = {
      url: lyricsUrl,
      artistId: lyricsUrl.split('/lyrics/')[1]?.split('/')[0],
      trackId: lyricsUrl.split('/lyrics/')[1]?.split('/')[1],
      timestamp: new Date().toISOString(),
      isPublicUrl: lyricsUrl.includes('www.musixmatch.com'),
      isStudioUrl: lyricsUrl.includes('curators-beta.musixmatch.com')
    };
    debugLog('Song Info:', songInfo);

    // Create the fetch promise
    const fetchPromise = Promise.all([
      fetchPermissionData(),
      new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: lyricsUrl,
          onload: res => {
            try {
              const text = res.responseText;

              // Check if response is valid (not empty and contains expected data)
              if (!text || text.length === 0) {
                throw new Error('Empty response from server');
              }

              // Extract song metadata
              const songTitleMatch = text.match(/"name":"([^"]+)"/);
              const artistNameMatch = text.match(/"artistName":"([^"]+)"/);
              const songMetadata = {
                title: songTitleMatch ? songTitleMatch[1] : 'Unknown',
                artist: artistNameMatch ? artistNameMatch[1] : 'Unknown',
                url: lyricsUrl,
                responseLength: text.length,
                hasContributors: text.includes('"name":"') && text.includes('"role":"')
              };
              debugLog('Song Metadata:', songMetadata);

              // Log raw contributor data
              const rawContributorData = text.match(/"name":"(.*?)","role":"(.*?)","contributionType":"(.*?)","date":"(.*?)"/g);
              debugLog('Raw Contributor Data:', {
                matches: rawContributorData ? rawContributorData.map(match => {
                  const [_, name, role, type, date] = match.match(/"name":"(.*?)","role":"(.*?)","contributionType":"(.*?)","date":"(.*?)"/);
                  return { name, role, type, date };
                }) : [],
                totalMatches: rawContributorData ? rawContributorData.length : 0
              });

              const regex = /"name":"([^"]+)","role":"([^"]+)","contributionType":"([^"]+)","date":"([^"]+)"/g;
              const newContributors = [];
              let match;
              while ((match = regex.exec(text)) !== null) {
                const [_, name, role, type, date] = match;
                if (name.includes("@") || name.toLowerCase().includes("freelance") || role === "mxm") continue;
                // Replace "lyrics_missing" with "lyrics_sent" in the type
                const displayType = type === "lyrics_missing" ? "lyrics_sent" : type;
                newContributors.push({ name, role, type: displayType, date: new Date(date) });
              }
              newContributors.sort((a, b) => b.date - a.date);

              // Log detailed scraping results
              debugLog('Scraping Results:', {
                song: songMetadata,
                contributors: newContributors.map(c => ({
                  name: c.name,
                  role: c.role,
                  type: c.type,
                  date: c.date.toISOString()
                })),
                totalContributors: newContributors.length,
                timestamp: new Date().toISOString(),
                url: lyricsUrl,
                responseStatus: res.status,
                responseType: res.responseType
              });

              debugPerformance('Contributor data fetch', startTime);
              resolve(newContributors);
            } catch (error) {
              debugError(error, {
                responseText: res.responseText?.substring(0, 500), // Limit log size
                songInfo,
                url: lyricsUrl,
                responseStatus: res.status,
                responseType: res.responseType,
                retryCount: retryCount
              });
              reject(error);
            }
          },
          onerror: (error) => {
            debugError(error, {
              url: lyricsUrl,
              songInfo,
              errorType: error.type,
              errorStatus: error.status,
              retryCount: retryCount
            });
            reject(error);
          }
        });
      })
    ]).then(([permissions, newContributors]) => {
      // Remove from pending fetches on success
      pendingFetches.delete(fetchKey);

      currentPageContributors = newContributors;
      lastLyricsUrl = lyricsUrl;

      // Log final results with permissions
      debugLog('Final Results:', {
        song: {
          url: lyricsUrl,
          title: newContributors[0]?.name || 'Unknown',
          timestamp: new Date().toISOString()
        },
        contributors: newContributors.map(c => {
          const keyExact = c.name.toLowerCase();
          const keyInit = normalizeName(c.name);
          const matchRows = permissions[keyExact] || permissions[keyInit] || [];

          // Debug log for permission matching
          debugLog('Permission matching:', {
            originalName: c.name,
            keyExact,
            keyInit,
            matchFound: matchRows.length > 0,
            matchType: keyExact in permissions ? 'exact' : keyInit in permissions ? 'initials' : 'none'
          });

          return {
            name: c.name,
            role: c.role,
            type: c.type,
            date: c.date.toISOString(),
            permission: matchRows[0]?.permission || 'unknown',
            language: matchRows[0]?.language || 'unknown'
          };
        }),
        totalContributors: newContributors.length,
        permissionsFound: Object.keys(permissions).length,
        url: lyricsUrl,
        fetchDuration: Date.now() - startTime,
        retryCount: retryCount
      });

      debugPerformance('Total contributor data processing', startTime);
      return newContributors;
    }).catch((error) => {
      // Remove from pending fetches on error
      pendingFetches.delete(fetchKey);

      // Retry logic with exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
        debugLog(`Fetch failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries}):`, {
          url: lyricsUrl,
          error: error.message || error,
          delay: delay
        });

        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(fetchContributorData(lyricsUrl, retryCount + 1, maxRetries));
          }, delay);
        });
      }

      // All retries exhausted
      debugError(error, {
        url: lyricsUrl,
        lastLyricsUrl,
        currentContributors: currentPageContributors,
        songInfo,
        fetchDuration: Date.now() - startTime,
        retryCount: retryCount,
        maxRetries: maxRetries
      });
      showMessage('⚠️ Failed to load contributor data after multiple attempts.', 'orange');
      return null;
    });

    // Store the promise to prevent duplicates
    pendingFetches.set(fetchKey, fetchPromise);
    return fetchPromise;
  };

  // Helper to handle click outside to close panel
  const setupClickOutsideClose = (panel, button, themeToggle) => {
    // Remove existing listener if any (to avoid duplicates)
    if (panel._clickOutsideHandler) {
      document.removeEventListener('click', panel._clickOutsideHandler);
    }

    const clickOutsideHandler = (e) => {
      // If panel is hidden, do nothing
      if (panel.style.display === 'none') return;

      // If click is NOT inside panel AND NOT inside the main button AND NOT inside theme toggle
      if (!panel.contains(e.target) && !button.contains(e.target) && (!themeToggle || !themeToggle.contains(e.target))) {
        panel.style.display = 'none';
      }
    };

    // Store reference to remove later if needed
    panel._clickOutsideHandler = clickOutsideHandler;
    // Add new listener (using capture phase to catch all clicks?) -  bubble is fine
    // need to make sure this doesn't fire immediately if this render was triggered by a click
    setTimeout(() => {
      document.addEventListener('click', clickOutsideHandler);
    }, 100);
  };

  // Helper for rendering header controls (Close, Theme, Copy)
  const renderHeaderControls = (panel) => {
    // Check if controls already exist to avoid duplication
    if (panel.querySelector('.mxm-header-controls')) return;

    const controls = document.createElement('div');
    controls.className = 'mxm-header-controls';
    controls.style = 'position: absolute; top: 12px; right: 12px; display: flex; align-items: center; gap: 8px; z-index: 100000;';

    // Move existing themeToggle to controls if it's attached elsewhere
    if (themeToggle.parentNode && themeToggle.parentNode !== controls) {
      themeToggle.parentNode.removeChild(themeToggle);
    }
    // Reset positioning for flexbox
    themeToggle.style.position = 'static';
    themeToggle.style.margin = '0';
    themeToggle.style.width = '24px';
    themeToggle.style.height = '24px';
    themeToggle.style.fontSize = '14px';
    controls.appendChild(themeToggle);

    // Copy Abstract Button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.className = 'mxm-btn-icon';
    copyBtn.title = 'Copy abstrack';
    copyBtn.style = 'font-size: 14px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;';
    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(lastTaskId || '');
        const popup = document.createElement('div');
        popup.textContent = 'Copied!';
        popup.style = `
          position: absolute;
          background: var(--mxm-cv-bg);
          color: var(--mxm-cv-text);
          border: 1px solid var(--mxm-cv-border);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 12px;
          box-shadow: 0 2px 8px var(--mxm-cv-shadow);
          opacity: 1;
          z-index: 100002;
          pointer-events: none;
          white-space: nowrap;
          top: 36px;
          right: 30px;
          animation: mxm-fade-in 0.2s ease-out;
        `;

        panel.appendChild(popup);

        setTimeout(() => popup.remove(), 1500);
      } catch (err) { console.error(err); }
    };
    controls.appendChild(copyBtn);

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.className = 'mxm-btn-icon';
    closeBtn.title = 'Close';
    closeBtn.style = 'font-size: 16px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;';
    closeBtn.onclick = () => panel.style.display = 'none';
    controls.appendChild(closeBtn);

    panel.appendChild(controls);
  };

  button.onclick = async () => {
    const lyricsURL = button.dataset.lyricsUrl;
    const currentTaskId = new URLSearchParams(window.location.search).get('commontrack_id');
    if (!location.pathname.startsWith('/tool')) {
      showMessage(`❌ Contributors only available on <code>/tool</code> pages.`, 'red');
      renderHeaderControls(panel);
      return;
    }
    if (!lyricsURL || currentTaskId !== lastTaskId) {
      showMessage(`⚠️ Please open the track info tab first to load contributor data for this song. - NOTE: If you see this error message, you encountered an extremely rare bug! Please report it to Bryce ASAP. Thx :)!`);
      renderHeaderControls(panel);
      return;
    }

    // Always show the panel first with animation
    panel.style.display = 'block';
    panel.classList.remove('mxm-fade-in');
    void panel.offsetWidth; // trigger reflow
    panel.classList.add('mxm-fade-in');

    panel.innerHTML = ''; // Clear panel
    renderHeaderControls(panel);

    // If we don't have data yet, show loading and fetch it
    if (currentPageContributors.length === 0) {
      // show loading state with new animation
      const loadingContent = document.createElement('div');
      loadingContent.innerHTML = `<strong style="font-size: 1.3em;">Contributors</strong><br><br>
        <div class="mxm-fade-in" style="display:flex; align-items:center; gap:12px; font-size: 14px; color: var(--mxm-cv-text-secondary);">
          <div class="mxm-loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
          Loading contributors...
        </div>`;
      panel.appendChild(loadingContent);

      // Try to fetch the data
      const contributors = await fetchContributorData(lyricsURL);
      if (contributors) {

        renderContributors(contributors, false);
      }
      return;
    }

    // If we have data, render it immediately
    renderContributors(currentPageContributors, false);
  };

  // Move menuItems definition to top-level scope so it's accessible in the event handler
  const menuItems = (menu, event, button) => [
    { text: '🌐 Visit Website', url: 'https://bryyce19.github.io/mxm-contribs/' },
    { text: '📚 Documentation', url: 'https://bryyce19.github.io/mxm-contribs/guide' },
    {
      text: debugMode ? '🔴 Disable Debug Mode' : '🟢 Enable Debug Mode', action: () => {
        debugMode = !debugMode;
        debugLog('Debug mode', debugMode ? 'enabled' : 'disabled');
        // Just close the menu; label will update next time menu is opened
      }
    },
    {
      text: '🙋‍♂️ Set My Name', action: () => {
        const currentName = localStorage.getItem('mxmMyName') || '';
        const name = prompt('Enter your Musixmatch name as it appears on the permission to overwrite spreadsheet:\n(Type REMOVE to clear your name)', currentName);
        if (name === null) return; // Cancelled
        if (!name.trim() || name.trim().toLowerCase() === 'remove') {
          localStorage.removeItem('mxmMyName');
          alert('Your name has been removed.');
        } else {
          localStorage.setItem('mxmMyName', name.trim());
          alert('Your name has been saved!');
        }
      }
    },
    {
      text: '📏 Reset Panel Size', action: () => {
        panel.style.width = '360px';
        localStorage.removeItem('mxmPanelWidth');
      }
    },

  ];

  // add context menu to button
  button.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'mxm-context-menu mxm-fade-in';
    menu.setAttribute('data-mxm-theme', isDark ? 'dark' : 'light');

    // calculate if menu should appear to the left
    const menuWidth = 200; // approximate width of menu
    const shouldShowLeft = e.clientX + menuWidth > window.innerWidth;

    // Calculate vertical position to prevent cutoff at bottom
    const menuHeight = 44 * menuItems(menu, e, button).length; // estimate 44px per item
    let top = e.clientY;
    if (top + menuHeight > window.innerHeight) {
      top = window.innerHeight - menuHeight - 10; // 10px margin from bottom
      if (top < 0) top = 10; // 10px margin from top if too high
    }

    // Set dynamic position
    menu.style.top = `${top}px`;
    menu.style.left = `${shouldShowLeft ? (e.clientX - menuWidth) : e.clientX}px`;

    menuItems(menu, e, button).forEach(item => {
      const div = document.createElement('div');
      div.className = 'mxm-context-item';
      div.textContent = item.text;

      div.onclick = (ev) => {
        if (item.url) {
          window.open(item.url, '_blank');
        } else if (item.action) {
          item.action(ev);
        }
        if (menu.parentNode) {
          document.body.removeChild(menu);
        }
      };
      menu.appendChild(div);
    });

    document.body.appendChild(menu);

    const closeMenu = (e) => {
      if (!menu.contains(e.target) && menu.parentNode) {
        document.body.removeChild(menu);
        document.removeEventListener('click', closeMenu);
      }
    };

    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  });

  // add overwrite confirmation popup
  const createOverwritePopup = (contributorName, permission) => {
    // Debug log the popup creation
    debugLog('Creating overwrite popup:', {
      contributorName,
      permission,
      keyExact: contributorName.toLowerCase(),
      keyInit: normalizeName(contributorName)
    });

    const popup = document.createElement('div');
    popup.className = 'mxm-popup';

    // Remove inline style injection as we use global STYLES now

    // get contributor details
    const keyExact = contributorName.toLowerCase();
    const keyInit = normalizeName(contributorName);
    const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
    // icon logic replaced by below

    let iconHTML;
    if (permission === 'no') {
      iconHTML = '<i class="fas fa-ban mxm-popup-icon" style="color: #ff4444; font-size: 42px;"></i>';
    } else if (permission === 'ask') {
      iconHTML = '<i class="fas fa-hand-paper mxm-popup-icon" style="color: #ffbb00; font-size: 42px;"></i>';
    } else {
      iconHTML = '<i class="fas fa-exclamation-circle mxm-popup-icon" style="color: #2ecc71; font-size: 42px;"></i>';
    }

    // Group entries by language
    const languageGroups = {};
    matchRows.forEach(row => {
      if (row.language) {
        if (!languageGroups[row.language]) {
          languageGroups[row.language] = [];
        }
        languageGroups[row.language].push(row);
      }
    });

    // Create language sections
    // Create language sections using Contact Card style
    const languageSections = Object.entries(languageGroups).map(([language, entries], index) => {
      const notes = entries.map(entry => entry.note).filter(Boolean);
      const uniqueNotes = [...new Set(notes)];

      return `
        <div class="mxm-contact-row">
          <div class="mxm-contact-icon"><i class="fas fa-language"></i></div>
          <div class="mxm-contact-content">
            <span class="mxm-contact-label">Language</span>
            <span class="mxm-contact-value">${language}</span>
          </div>
        </div>
        
        ${uniqueNotes.length > 0 ? `
          <div class="mxm-contact-row">
            <div class="mxm-contact-icon"><i class="fas fa-sticky-note"></i></div>
            <div class="mxm-contact-content">
              <span class="mxm-contact-label">Note</span>
              ${uniqueNotes.map(note => `<div style="margin-bottom:4px;">${note}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        ${index < Object.keys(languageGroups).length - 1 ? '<div style="height:1px; background:var(--mxm-cv-border); margin: 8px 0 12px 0;"></div>' : ''}
      `;
    }).join('');

    // Get the first entry for links
    const firstEntry = matchRows[0] || {};

    // Icons 
    let icon;
    if (permission === 'no') {
      icon = '🔒';
    } else if (permission === 'ask') {
      icon = '🙋‍♂️';
    } else if (permission === 'yes') {
      icon = '🔓';
    } else {
      icon = '❓';
    }

    popup.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center;">
        <div class="mxm-popup-emoji" style="font-size: 42px; line-height: 1; margin-bottom: 2px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.15));">${icon}</div>
        <div style="font-size: 20px; font-weight: 700; color: var(--mxm-cv-text); letter-spacing: -0.5px;">Overwrite Warning</div>
        <div style="color: var(--mxm-cv-text-secondary); line-height: 1.5; font-size: 14px; max-width: 90%;">
          <strong style="color: var(--mxm-cv-text); font-weight: 600;">${contributorName}</strong> ${permission === 'ask' ? 'requests to be asked before overwriting' : 'does not allow overwrites'}.
        </div>
        ${matchRows.length > 0 ? `
          <div class="mxm-popup-info">
            ${languageSections}
            ${(firstEntry.musixmatch_link || firstEntry.slack_link) ? `
              <div class="mxm-contact-row">
                <div class="mxm-contact-icon"><i class="fas fa-address-book"></i></div>
                <div class="mxm-contact-content">
                  <span class="mxm-contact-label">Contact</span>
                  <div style="display: flex; gap: 12px;">
                    ${firstEntry.musixmatch_link ? `
                      <a href="${firstEntry.musixmatch_link}" target="_blank" class="mxm-link" style="display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 500; text-decoration: none; margin: 0;">
                        <i class="fas fa-user-circle"></i> Profile
                      </a>
                    ` : ''}
                    ${firstEntry.slack_link ? `
                      <a href="${firstEntry.slack_link}" target="_blank" class="mxm-link" style="display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 500; text-decoration: none; margin: 0;">
                        <i class="fab fa-slack"></i> Slack
                      </a>
                    ` : ''}
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
        <div style="display: flex; gap: 12px; margin-top: 8px; width: 100%;">
          <button id="mxm-cancel-overwrite" class="mxm-popup-btn mxm-popup-btn-secondary" style="flex: 1;">
            Cancel
          </button>
          <button id="mxm-confirm-overwrite" class="mxm-popup-btn mxm-popup-btn-primary" style="flex: 1;">
            Proceed Anyway
          </button>
        </div>
        <div style="margin-top: 12px; color: #ff4444; font-size: 12px; line-height: 1.4; text-align: center;">
          <i class="fas fa-exclamation-triangle" style="margin-right: 4px;"></i>
          Overwriting lyrics without permission is against Musixmatch guidelines and may result in demotion from your current rank.
        </div>
      </div>
    `;

    // Note: Theme attribute is not set here, must be set by caller or via applyTheme logic
    return popup;
  };

  // use Capture Phase Event Delegation ... thank you, Mangezi :-)
  let isObserverActive = false;

  const interceptSaveButton = () => {
    const startTime = Date.now();
    if (isObserverActive) {
      debugLog('Button observer already active, skipping...');
      return;
    }

    console.log('[MXM Interceptor] Starting global save button interceptor (Capture Phase)...');
    debugLog('Starting global save button interceptor (Capture Phase)...');
    debugState.lastAction = 'interceptSaveButton';
    debugState.actionCount++;

    // List of Send button texts in various languages (using Set for O(1) lookup) - ** note to self: review later 
    const sendButtonTexts = new Set([
      'إرسال',      // Arabic
      'পাঠাও',      // Assamese
      'পাঠান',      // Bengali
      'Ipadala',    // Bikol
      'Enviar',     // Brazilian Portuguese
      'Изпрати',    // Bulgarian
      'Ipadala',    // Cebuano
      '发送',       // Chinese
      'Pošalji',    // Croatian
      'Odeslat',    // Czech
      'Send',       // Danish/English
      'Versturen',  // Dutch
      'Lähetä',     // Finnish
      'Envoyer',    // French
      'Senden',     // German
      'Στείλε',     // Greek
      'Voye',       // Haitian Creole
      'भेजें',      // Haryanvi/Hindi
      'Aika',       // Hausa
      'שלח',        // Hebrew
      'Küldés',     // Hungarian
      'Ziga',       // Igbo
      'Kirim',      // Indonesian/Javanese/Sundanese
      'Invia',      // Italian
      '送信',       // Japanese
      '보내기',     // Korean
      'Tinda',      // Lingála
      'Hantar',     // Malay
      'അയയ്ക്കുക',  // Malayalam
      'पाठवा',      // Marathi
      'पठाउनुहोस्', // Nepali
      'Sende',      // Norwegian
      'ପଠାନ୍ତୁ',    // Odia
      'ارسال',      // Persian
      'ਭੇਜੋ',       // Punjabi
      'Wyślij',     // Polish
      'Enviar',     // Portuguese/Spanish
      'Trimite',    // Romanian
      'Отправить',  // Russian
      'प्रेषय',     // Sanskrit
      'Tumira',     // Shona
      'Odoslať',    // Slovak
      'Skicka',     // Swedish
      'Ipadala',    // Tagalog
      'அனுப்பு',    // Tamil
      'పంపండి',     // Telugu
      'ส่ง',        // Thai
      'Rhumela',    // Tsonga/Venda
      'Gönder',     // Turkish
      'Надіслати',  // Ukrainian
      'بھیجیں',     // Urdu
      'Gửi',        // Vietnamese
      'Ránṣẹ́',     // Yoruba
      'Thumela'     // Xhosa/Zulu
    ]);

    // add a single listener to the document in the capture phase
    // This runs before Musixmatchs own event listeners
    // The 'true' parameter enables capture phase !!!!
    document.addEventListener('click', (e) => {
      const clickStartTime = Date.now();
      const isUserClick = e.isTrusted; // true for user clicks, false for programmatic

      // Critical: Only reset flag for user-initiated clicks
      // Programmatic clicks (after "Proceed Anyway") should use the existing flag value (i think this is correct, review)
      if (isUserClick) {
        hasAcknowledgedWarning = false;
      }

      // 1. Check if the clicked element (or its parent) looks like a button
      const targetBtn = e.target.closest('div[role="button"], button, [tabindex="0"]');
      if (!targetBtn) return;

      // 2. Check if the button text is "Send" (in any language)
      const btnText = (targetBtn.textContent || '').trim();
      if (!sendButtonTexts.has(btnText)) return;

      console.log('[MXM Interceptor] Intercepted click on "Send" button:', {
        text: btnText,
        isUserClick,
        hasAcknowledgedWarning
      });
      debugLog('Intercepted click on "Send" button:', { text: btnText, isUserClick });
      debugState.lastAction = 'sendButtonClick';
      debugState.actionCount++;

      // 3. Get contributor data (already fetched by main script)
      const currentContributor = currentPageContributors[0];
      if (!currentContributor) {
        console.log('[MXM Interceptor] No contributor data loaded, allowing save');
        debugLog('No contributor data loaded, allowing save');
        return;
      }

      // 4. Check permissions
      const keyExact = currentContributor.name.toLowerCase();
      const keyInit = normalizeName(currentContributor.name);
      const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
      const permission = matchRows[0]?.permission;

      debugLog('Contributor permission check:', {
        originalName: currentContributor.name,
        keyExact,
        keyInit,
        permission,
        matchType: keyExact in permissionData ? 'exact' : keyInit in permissionData ? 'initials' : 'none',
        matchRowsFound: matchRows.length
      });

      // Skip if user is the contributor
      const myName = (localStorage.getItem('mxmMyName') || '').trim().toLowerCase();
      if (myName && currentContributor.name.trim().toLowerCase() === myName) {
        console.log('[MXM Interceptor] User is the contributor, allowing save');
        debugLog('User is the contributor, allowing save');
        return;
      }

      // 5. If warning needed, STOP the click
      if ((permission === 'ask' || permission === 'no') && !hasAcknowledgedWarning) {
        console.log('[MXM Interceptor] Blocking save to show warning popup for:', currentContributor.name);
        debugLog('Blocking save to show warning popup');

        // STOP everything immediately -  prevents Musixmatch from processing the click
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Show the popup
        const popup = createOverwritePopup(currentContributor.name, permission);
        popup.setAttribute('data-mxm-theme', isDark ? 'dark' : 'light'); // Apply theme!
        document.body.appendChild(popup);

        // Add backdrop
        const backdrop = document.createElement('div');
        backdrop.style = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 999999;
        `;
        document.body.appendChild(backdrop);

        // disable the save button  visually
        targetBtn.style.pointerEvents = 'none';
        targetBtn.style.opacity = '0.5';

        // Setup popup handlers
        const cleanup = () => {
          if (popup.parentNode) document.body.removeChild(popup);
          if (backdrop.parentNode) document.body.removeChild(backdrop);
          targetBtn.style.pointerEvents = 'auto';
          targetBtn.style.opacity = '1';
        };

        const cancelBtn = popup.querySelector('#mxm-cancel-overwrite');
        const confirmBtn = popup.querySelector('#mxm-confirm-overwrite');

        cancelBtn.onclick = () => {
          console.log('[MXM Interceptor] Overwrite cancelled');
          debugLog('Overwrite cancelled');
          debugState.lastAction = 'overwriteCancelled';
          debugState.actionCount++;
          cleanup();
          hasAcknowledgedWarning = false;
          debugPerformance('Overwrite cancellation', clickStartTime);
        };

        confirmBtn.onclick = () => {
          console.log('[MXM Interceptor] Overwrite confirmed, proceeding with save');
          debugLog('Overwrite confirmed');
          debugState.lastAction = 'overwriteConfirmed';
          debugState.actionCount++;
          cleanup();
          hasAcknowledgedWarning = true;

          // Re-trigger the click safely
          //  !!! set the flag so this handler won't block it again
          setTimeout(() => {
            targetBtn.click();
            // Reset flag after a delay next user click will show popup again
            setTimeout(() => {
              hasAcknowledgedWarning = false;
            }, 500);
          }, 100);
          debugPerformance('Immediate overwrite confirmation + submission', clickStartTime);
        };
      } else {
        // If we get here, either permission is allowed OR user already confirmed
        console.log('[MXM Interceptor] Save allowed (permission ok or warning acknowledged)');
        debugLog('Save allowed (permission ok or warning acknowledged)');
        hasAcknowledgedWarning = false; // Reset for next time
        debugPerformance('Save without restrictions', clickStartTime);
      }
    }, true); // <--- 'true' enables Capture Phase (Crucial!)

    isObserverActive = true;
    console.log('[MXM Interceptor] Capture phase listener active - no CSS selectors needed!');
    debugLog('Capture phase listener active');
    debugPerformance('Save button interceptor setup', startTime);
  };

  // wait for page to be ready before starting observer
  const waitForPageReady = () => {
    return new Promise((resolve) => {
      console.log('[MXM Interceptor] waitForPageReady: Starting page readiness check');
      console.log('[MXM Interceptor] waitForPageReady: Current pathname:', location.pathname);
      debugLog('waitForPageReady: Starting page readiness check');
      debugLog('waitForPageReady: Current pathname:', location.pathname);

      // check if we're on a tool page
      if (!location.pathname.startsWith('/tool')) {
        console.log('[MXM Interceptor] Not on a tool page, skipping button observer');
        debugLog('Not on a tool page, skipping button observer');
        resolve();
        return;
      }

      console.log('[MXM Interceptor] On tool page, checking for page readiness...');
      debugLog('On tool page, checking for page readiness...');
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds max wait

      // check for loading indicators
      const checkLoading = () => {
        attempts++;
        const loadingIndicators = document.querySelectorAll('.css-175oi2r[style*="opacity: 0"]');
        if (attempts % 10 === 0 || attempts === 1) {
          console.log(`[MXM Interceptor] Page readiness check attempt ${attempts}/${maxAttempts}: Found ${loadingIndicators.length} loading indicators`);
        }
        debugLog(`Page readiness check attempt ${attempts}/${maxAttempts}: Found ${loadingIndicators.length} loading indicators`);

        if (loadingIndicators.length === 0 || attempts >= maxAttempts) {
          if (attempts >= maxAttempts) {
            console.log('[MXM Interceptor] Page readiness check timed out, proceeding anyway');
            debugLog('Page readiness check timed out, proceeding anyway');
          } else {
            console.log('[MXM Interceptor] Page appears to be loaded');
            debugLog('Page appears to be loaded');
          }
          resolve();
          return;
        }
        debugLog('Page still loading, waiting...');
        setTimeout(checkLoading, 500);
      };

      // start checking
      checkLoading();
    });
  };

  // start intercepting save button after page is ready
  console.log('[MXM Interceptor] Setting up save button interceptor initialization...');
  debugLog('Setting up save button interceptor initialization...');

  // Always start the interceptor, but also wait for page ready for optimal timing
  // This ensures it works even if waitForPageReady fails
  const startInterceptor = () => {
    try {
      console.log('[MXM Interceptor] Starting interceptor...');
      interceptSaveButton();
    } catch (error) {
      console.error('[MXM Interceptor] Error starting interceptor:', error);
      // Retry after a delay
      setTimeout(() => {
        console.log('[MXM Interceptor] Retrying interceptor start...');
        try {
          interceptSaveButton();
        } catch (retryError) {
          console.error('[MXM Interceptor] Retry failed:', retryError);
        }
      }, 2000);
    }
  };

  // Start immediately (for pages that are already loaded)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log('[MXM Interceptor] Document already ready, starting interceptor immediately...');
    startInterceptor();
  }

  // Also wait for page ready for optimal timing
  waitForPageReady().then(() => {
    console.log('[MXM Interceptor] Page ready, ensuring interceptor is active...');
    debugLog('Page ready, calling interceptSaveButton...');
    startInterceptor();
  }).catch((error) => {
    console.error('[MXM Interceptor] Error in waitForPageReady:', error);
    debugLog('Error in waitForPageReady:', error);
    // Try anyway after a short delay
    setTimeout(() => {
      console.log('[MXM Interceptor] Attempting to start interceptor despite error...');
      debugLog('Attempting to start interceptor despite error...');
      startInterceptor();
    }, 1000);
  });

  // Function to create and inject the Contributor Data card into the assistant menu
  const createContributorDataCard = () => {
    let retryCount = 0;
    const maxRetries = 30; // Try for up to 30 seconds

    // Helper to find the assistant menu in both Old and Beta UIs
    const getAssistantMenu = () => {
      // 1. Try Old UI selector
      const oldMenu = document.querySelector('[class*="r-e6wx2c"][class*="r-24i33s"]');
      if (oldMenu) return oldMenu;

      // 2. Try New Beta UI logic
      // Find the "Assistant" label and traverse up to find the container that holds the content
      const assistantLabels = Array.from(document.querySelectorAll('div[dir="auto"]'))
        .filter(el => el.textContent.trim() === 'Assistant');

      for (const label of assistantLabels) {
        let current = label;
        // Traverse up max 10 levels to find the common container
        for (let i = 0; i < 10; i++) {
          if (!current || !current.parentElement) break;
          current = current.parentElement;
          // The container in the new UI typically contains the scrollable content area (r-150rngu)
          if (current.querySelector('[class*="r-150rngu"]')) {
            return current;
          }
        }
      }
      return null;
    };

    // Wait for the assistant menu to be available
    const checkForAssistantMenu = () => {
      if (retryCount >= maxRetries) {
        debugLog('Gave up trying to find assistant menu after ' + maxRetries + ' attempts');
        return;
      }

      retryCount++;

      // Only try on tool pages where the assistant menu exists
      if (!location.pathname.startsWith('/tool')) {
        debugLog('Not on a tool page, skipping contributor data card');
        return;
      }

      const assistantMenu = getAssistantMenu();

      if (!assistantMenu) {
        if (retryCount % 5 === 0) {
          debugLog('Still looking for assistant menu (attempt ' + retryCount + '/' + maxRetries + ')');
        }
        setTimeout(checkForAssistantMenu, 1000);
        return;
      }

      debugLog('Found assistant menu on attempt ' + retryCount);

      // Check if we've already added the card
      if (assistantMenu.querySelector('.mxm-contributor-data-card') ||
        document.querySelector('.mxm-contributor-data-card')) {
        debugLog('Contributor Data card already exists, skipping');
        return;
      }

      // Get the current contributor data
      const currentContributor = currentPageContributors[0];

      // Get permission data for the current contributor
      let matchRows = [];
      let firstPerm = null;
      if (currentContributor) {
        const keyExact = currentContributor.name.toLowerCase();
        const keyInit = normalizeName(currentContributor.name);
        matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
        firstPerm = matchRows[0]?.permission;
      }

      // Group entries by language (like the popup does)
      const languageGroups = {};
      if (matchRows.length > 0) {
        matchRows.forEach(row => {
          if (row.language) {
            if (!languageGroups[row.language]) {
              languageGroups[row.language] = [];
            }
            languageGroups[row.language].push(row);
          }
        });
      }

      // Custom styling for Bryce M.
      const isBryce = currentContributor && (currentContributor.name === 'Bryce M.' || currentContributor.name.trim() === 'Bryce M.');

      // CSS for custom animation
      if (isBryce && !document.getElementById('mxm-bryce-style')) {
        const style = document.createElement('style');
        style.id = 'mxm-bryce-style';
        style.textContent = `
          @keyframes mxm-snow-1 {
            0% { background-position: 0px 0px, 0px 0px; }
            100% { background-position: 100px 600px, 150px 650px; }
          }
          @keyframes mxm-snow-2 {
            0% { background-position: 0px 0px, 0px 0px; }
            100% { background-position: -100px 600px, -50px 600px; }
          }
          @keyframes mxm-snow-3 {
            0% { background-position: 0px 0px; }
            100% { background-position: 40px 600px; }
          }
          .mxm-bryce-card {
             box-shadow: 0 0 15px rgba(255, 255, 255, 0.15); /* Fuzzy border glow */
             border-radius: 16px; /*  rounded corners match */
          }
        `;
        document.head.appendChild(style);
      }

      // polished card that matches Musixmatch assistant card styling
      // The r-* classes provide: background, border, border-radius, padding, box-shadow
      const cardHTML = `
        <div class="r-1ifxtd0 mxm-contributor-data-card">
          <div class="r-1otgn73 r-13awgt0" style="cursor: inherit;">
            <div class="r-za8utv r-1867qdf r-3pj75a r-95jzfe r-1j8onyl r-1kribmz r-d045u9 ${isBryce ? 'mxm-bryce-card' : ''}" style="
              padding-bottom: 16px;
              border: ${isBryce ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid var(--mxm-backgroundSecondary)'};
              margin-top: 10px;
              ${isBryce ? 'background: #1b1b1b;' : ''}
              position: relative;
              overflow: hidden;
            ">
              ${isBryce ? `
                <!-- Layer 1: Small, slow, drift right -->
                <div style="
                  position: absolute;
                  top: -100%; left: -50%; width: 200%; height: 300%;
                  background-image: 
                    radial-gradient(2px 2px at 20px 30px, rgba(255,255,255,0.7), rgba(0,0,0,0)),
                    radial-gradient(2px 2px at 150px 240px, rgba(255,255,255,0.7), rgba(0,0,0,0));
                  background-size: 300px 300px;
                  animation: mxm-snow-1 20s linear infinite;
                  opacity: 0.5;
                  filter: blur(1px);
                  pointer-events: none;
                  z-index: 0;
                  transform: rotate(10deg);
                "></div>
                <!-- Layer 2: Medium, medium speed, drift left -->
                <div style="
                  position: absolute;
                  top: -100%; left: -50%; width: 200%; height: 300%;
                  background-image: 
                     radial-gradient(3px 3px at 50px 80px, rgba(255,255,255,0.8), rgba(0,0,0,0)),
                     radial-gradient(3px 3px at 220px 180px, rgba(255,255,255,0.8), rgba(0,0,0,0));
                  background-size: 300px 300px;
                  animation: mxm-snow-2 15s linear infinite;
                  opacity: 0.6;
                  filter: blur(1.5px);
                  pointer-events: none;
                  z-index: 0;
                  transform: rotate(-5deg);
                "></div>
                 <!-- Layer 3: Large, fast, slight drift -->
                <div style="
                  position: absolute;
                  top: -100%; left: -50%; width: 200%; height: 300%;
                  background-image: 
                     radial-gradient(4px 4px at 100px 100px, rgba(255,255,255,0.6), rgba(0,0,0,0));
                  background-size: 300px 300px;
                  animation: mxm-snow-3 10s linear infinite;
                  opacity: 0.4;
                  filter: blur(2px);
                  pointer-events: none;
                  z-index: 0;
                "></div>
              ` : ''}

              <!-- Header - Only this uses Musixmatch font -->
              <div class="r-18u37iz r-1ifxtd0" style="position: relative; z-index: 1;">
                <div class="r-13awgt0 r-18u37iz r-1wtj0ep">
                  <div dir="auto" class="css-146c3p1 r-fdjqy7 r-1grxjyw r-adyw6z r-135wba7" style="color: var(--mxm-contentPrimary); font-weight: 600; font-size: 20px; font-family: gordita-bold, sans-serif; display: flex; align-items: center; gap: 8px;"><i class="fas fa-users" style="color: #FC542E; font-size: 20px;"></i><span>Latest Contributor</span></div>
                </div>
              </div>
              
              <!-- Content Area -->
              <div class="r-13awgt0 r-1ifxtd0" style="position: relative; z-index: 1;">
                ${currentContributor ? `
                  <!-- Contributor Info -->
                  <div style="padding-top: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--mxm-backgroundTertiary);">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      ${(() => {
            const roleKey = currentContributor.role.toLowerCase();
            const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
            const iconHTML = iconSrc.startsWith('http') ? `<img style="width: 18px; height: 18px; border-radius: 4px;" src="${iconSrc}" draggable="false" oncontextmenu="return false">` : `<span style="font-size: 18px;">${iconSrc}</span>`;
            return iconHTML;
          })()}
                      <div style="
                        color: ${isBryce ? '#ffffff' : 'var(--mxm-contentPrimary)'};
                        font-weight: 700;
                        font-size: 15px;
                        font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                      ">
                        ${currentContributor.name}
                        ${isBryce ? `
                          <!-- dev Icon -->
                          <div title="Developer" style="display: inline-flex; align-items: center;">
                            <svg viewBox="2.3 2 19.39 20" style="width: 16px; height: 16px; margin-left: 3px; vertical-align: middle; filter: drop-shadow(0 0 2.5px rgba(255, 255, 255, 1)); color: #ffffff;">
                              <path fill="currentColor" d="m16.06 13.09l5.63 5.59l-3.32 3.28l-5.59-5.59v-.92l2.36-2.36h.92m.91-2.53L16 9.6l-4.79 4.8v1.97L5.58 22L2.3 18.68l5.59-5.59h1.97l.78-.78L6.8 8.46H5.5L2.69 5.62L5.31 3l2.8 2.8v1.31L12 10.95l2.66-2.66l-.96-1.01L15 5.97h-2.66l-.65-.65L15 2l.66.66v2.66L16.97 4l3.28 3.28c1.09 1.1 1.09 2.89 0 3.98l-1.97-2.01l-1.31 1.31Z"></path>
                            </svg>
                          </div>
                        ` : ''}
                      </div>
                    </div>
                    <div style="
                      color: var(--mxm-contentTertiary);
                      font-size: 13px;
                      margin-left: 26px;
                      font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    ">${currentContributor.role}</div>
                  </div>

                  <!-- Languages - Show all languages with permissions like the popup -->
                  ${Object.keys(languageGroups).length > 0 ? `
                    ${Object.entries(languageGroups).map(([language, entries], index, array) => {
            const firstEntry = entries[0];
            const langPermission = firstEntry.permission;
            const notes = entries.map(entry => entry.note).filter(Boolean);
            const uniqueNotes = [...new Set(notes)];

            return `
                        <div style="
                          padding-top: ${index === 0 ? '16px' : '16px'};
                          padding-bottom: ${index === array.length - 1 ? '0' : '16px'};
                          border-bottom: ${index === array.length - 1 ? 'none' : '1px solid var(--mxm-backgroundTertiary)'};
                        ">
                          <!-- Language Name -->
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                            <div style="color: var(--mxm-contentSecondary); font-size: 13px;">Language:</div>
                            <div style="
                              color: var(--mxm-contentPrimary);
                              font-size: 13px;
                              font-weight: 500;
                            ">${language}</div>
                          </div>
                          
                          <!-- Permission for this language -->
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                            <div style="color: var(--mxm-contentSecondary); font-size: 13px;">Permission:</div>
                            ${langPermission ? `
                              <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 14px;">${lockDisplay[langPermission] ? lockDisplay[langPermission][0] : '🔒'}</span>
                                <span style="
                                  color: ${langPermission === 'no' ? '#ff4444' : langPermission === 'ask' ? '#ffbb00' : '#2ecc71'};
                                  font-weight: 500;
                                  font-size: 13px;
                                ">${lockDisplay[langPermission] ? lockDisplay[langPermission][1] : 'Unknown'}</span>
                              </div>
                            ` : `
                              <span style="color: var(--mxm-contentTertiary); font-size: 13px;">🔒 No data</span>
                            `}
                          </div>
                          
                          <!-- Note for this language -->
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                            <div style="color: var(--mxm-contentSecondary); font-size: 13px;">Note:</div>
                            ${uniqueNotes.length > 0 ? `
                              <div style="text-align: right; max-width: 60%;">
                                ${uniqueNotes.map(note => `
                                  <div style="
                                    color: var(--mxm-contentPrimary);
                                    font-size: 13px;
                                    line-height: 1.5;
                                    word-wrap: break-word;
                                    margin-bottom: ${uniqueNotes.indexOf(note) < uniqueNotes.length - 1 ? '8px' : '0'};
                                  ">${note}</div>
                                `).join('')}
                              </div>
                            ` : `
                              <div style="color: var(--mxm-contentTertiary); font-size: 13px;">—</div>
                            `}
                          </div>
                        </div>
                      `;
          }).join('')}
                  ` : `
                    <!-- No overwrite info message -->
                    <div style="
                      padding-top: 16px;
                      padding-bottom: 16px;
                      text-align: center;
                      font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    ">
                      <div style="
                        color: var(--mxm-contentTertiary);
                        font-size: 13px;
                        font-style: italic;
                      ">No overwrite info; proceed with caution</div>
                    </div>
                  `}

                  <!-- Action Buttons -->
                  ${(matchRows[0]?.musixmatch_link || matchRows[0]?.slack_link) ? `
                    <div style="display: flex; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--mxm-backgroundTertiary);">
                      ${matchRows[0]?.musixmatch_link ? `
                        <a href="${matchRows[0].musixmatch_link}" target="_blank" style="
                          display: flex;
                          align-items: center;
                          gap: 6px;
                          padding: 6px 10px;
                          text-decoration: none;
                          color: var(--mxm-contentPrimary);
                          font-size: 13px;
                          font-weight: 500;
                          font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                          border-radius: 6px;
                          transition: background 0.2s ease;
                        " onmouseover="this.style.background='var(--mxm-backgroundHover)'" onmouseout="this.style.background='transparent'">
                          <i class="fas fa-user-circle" style="color: #FC542E; font-size: 14px;"></i>
                          Profile
                        </a>
                      ` : ''}
                      ${matchRows[0]?.slack_link ? `
                        <a href="${matchRows[0].slack_link}" target="_blank" style="
                          display: flex;
                          align-items: center;
                          gap: 6px;
                          padding: 6px 10px;
                          text-decoration: none;
                          color: var(--mxm-contentPrimary);
                          font-size: 13px;
                          font-weight: 500;
                          font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                          border-radius: 6px;
                          transition: background 0.2s ease;
                        " onmouseover="this.style.background='var(--mxm-backgroundHover)'" onmouseout="this.style.background='transparent'">
                          <i class="fab fa-slack" style="color: #FC542E; font-size: 14px;"></i>
                          Slack
                        </a>
                      ` : ''}
                    </div>
                  ` : ''}
                ` : `
                  <!-- Error message when no contributors found -->
                  <div class="r-13awgt0 r-1ifxtd0" style="padding-top: 16px;">
                    <div dir="auto" class="css-146c3p1 r-fdjqy7 r-1inkyih r-135wba7" style="
                      color: var(--mxm-contentPrimary);
                      font-size: 13px;
                      font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    ">⚠️ Couldn't find any contributors. <strong>Click the contributor viewer button for more detailed information.</strong>
                    </div>
                  </div>
                `}
              </div>
            </div>
          </div>
        </div>
      `;

      // Find the assistant menu content area using r-* classes (css-* classes are dynamic)
      const assistantContent = assistantMenu.querySelector('[class*="r-150rngu"][class*="r-eqz5dr"]');
      if (!assistantContent) {
        debugLog('ERROR: Could not find assistant content area');
        setTimeout(checkForAssistantMenu, 1000);
        return;
      }

      // Find the assistant header using r-* classes
      // In new UI, this might be slightly different, so we try the old selector first
      const assistantHeader = assistantContent.querySelector('[class*="r-16y2uox"][class*="r-1q142lx"]');

      // Create a wrapper div for the card
      const cardWrapper = document.createElement('div');
      cardWrapper.innerHTML = cardHTML;
      cardWrapper.className = 'mxm-contributor-data-wrapper';

      // Insert the card
      if (assistantHeader && assistantHeader.parentNode) {
        // Old UI / matched header: Insert after header
        try {
          assistantHeader.parentNode.insertBefore(cardWrapper, assistantHeader.nextSibling);
          debugLog('Contributor Data card successfully added to assistant menu (after header)');
        } catch (e) {
          debugLog('ERROR: Failed to insert card after header:', e);
          setTimeout(checkForAssistantMenu, 1000);
        }
      } else {
        // Fallback: Prepend to content area (works for New UI if header selector doesn't match)
        try {
          assistantContent.insertBefore(cardWrapper, assistantContent.firstChild);
          debugLog('Contributor Data card successfully added to assistant menu (prepended to content)');
        } catch (e) {
          debugLog('ERROR: Failed to prepend card to content:', e);
          setTimeout(checkForAssistantMenu, 1000);
        }
      }
    };

    // Start checking for the assistant menu
    checkForAssistantMenu();

    // Also watch for the assistant menu to appear dynamically
    const observer = new MutationObserver((mutations) => {
      const assistantMenu = getAssistantMenu();
      if (assistantMenu && !assistantMenu.querySelector('.mxm-contributor-data-card') &&
        !document.querySelector('.mxm-contributor-data-card')) {
        const currentContributor = currentPageContributors[0];
        if (currentContributor) {
          debugLog('Assistant menu appeared, attempting to add card');
          checkForAssistantMenu();
        }
      }
    });

    // Observe the document body for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Clean up observer after a reasonable time
    setTimeout(() => {
      observer.disconnect();
    }, 60000); // Stop observing after 60 seconds
  };

  // Function to update the contributor data card when data changes
  const updateContributorDataCard = () => {
    const card = document.querySelector('.mxm-contributor-data-card');
    if (!card) return;

    const currentContributor = currentPageContributors[0];
    if (!currentContributor) {
      // Show empty state if card exists
      const bodyDiv = card.querySelector('.r-115tad6');
      if (bodyDiv) {
        bodyDiv.innerHTML = `
          <div class="r-13awgt0 r-1ifxtd0" style="padding-top: 16px;">
            <div dir="auto" class="css-146c3p1 r-fdjqy7 r-1inkyih r-135wba7" style="
              color: var(--mxm-contentPrimary);
              font-size: 13px;
              font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
            ">⚠️ Couldn't find any contributors. <strong>Click the contributor viewer button for more detailed information.</strong>
            </div>
          </div>
        `;
      }
      return;
    }

    // Update the card content
    const keyExact = currentContributor.name.toLowerCase();
    const keyInit = normalizeName(currentContributor.name);
    const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
    const firstPerm = matchRows[0]?.permission;

    // Update contributor name and details
    const nameElement = card.querySelector('div[style*="font-weight: 500"]');
    if (nameElement) {
      nameElement.textContent = currentContributor.name;
    }

    const roleElement = card.querySelector('div[style*="font-size: 12px"]');
    if (roleElement) {
      roleElement.textContent = `${currentContributor.role} • ${currentContributor.type.replace(/_/g, ' ')}`;
    }

    // Update permission display
    const permissionElement = card.querySelector('span[style*="color:"]');
    if (permissionElement && firstPerm) {
      permissionElement.textContent = lockDisplay[firstPerm] ? lockDisplay[firstPerm][1] : 'Unknown permission';
      permissionElement.style.color = firstPerm === 'no' ? '#ff4444' : firstPerm === 'ask' ? '#ffbb00' : '#2ecc71';
    }

    debugLog('Contributor Data card updated');
  };

  // Create the contributor data card when the page loads
  setTimeout(() => {
    createContributorDataCard();
  }, 2000);

  // Update the card when contributor data changes
  // Only wrap the function once to avoid reassignment errors
  if (!fetchContributorData._mxmWrapped) {
    const originalFetchContributorData = fetchContributorData;
    fetchContributorData = async (lyricsUrl) => {
      const result = await originalFetchContributorData(lyricsUrl);
      if (result) {
        setTimeout(() => {
          // Try to update existing card
          updateContributorDataCard();
          // If card doesn't exist, try to create it
          if (!document.querySelector('.mxm-contributor-data-card')) {
            debugLog('Card not found after data fetch, attempting to create it');
            createContributorDataCard();
          }
        }, 500);
      }
      return result;
    };
    fetchContributorData._mxmWrapped = true;
  }

  // Ensure the contributors panel is always scrollable, even if the main page disables scrolling
  panel.style.overflowY = 'auto';
  panel.style.pointerEvents = 'auto';
  panel.style.zIndex = '9999999'; // keep above most overlays

  // Add a style element to force scrollability
  const forceScrollStyle = document.createElement('style');
  forceScrollStyle.textContent = `
    .mxm-panel {
      overflow-y: auto !important;
      pointer-events: auto !important;
      z-index: 9999999 !important;
      position: fixed !important;
    }
  `;
  document.head.appendChild(forceScrollStyle);

  // --- Force scrollability even when page is locked by a modal ---
  // Mouse wheel support
  panel.addEventListener('wheel', function (e) {
    // Only scroll the panel, not the page
    if (panel.scrollHeight > panel.clientHeight) {
      e.stopPropagation();
      // Allow scrolling up/down
      const prevScroll = panel.scrollTop;
      panel.scrollTop += e.deltaY;
      // Prevent page scroll if panel can scroll further
      if ((e.deltaY < 0 && prevScroll > 0) || (e.deltaY > 0 && prevScroll + panel.clientHeight < panel.scrollHeight)) {
        e.preventDefault();
      }
    }
  }, { passive: false });

  // Touch support for mobile
  let lastY = null;
  panel.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      lastY = e.touches[0].clientY;
    }
  });
  panel.addEventListener('touchmove', function (e) {
    if (e.touches.length === 1 && lastY !== null) {
      const newY = e.touches[0].clientY;
      const deltaY = lastY - newY;
      const prevScroll = panel.scrollTop;
      panel.scrollTop += deltaY;
      lastY = newY;
      // Prevent page scroll if panel can scroll further
      if ((deltaY < 0 && prevScroll > 0) || (deltaY > 0 && prevScroll + panel.clientHeight < panel.scrollHeight)) {
        e.preventDefault();
      }
    }
  }, { passive: false });
  panel.addEventListener('touchend', function () { lastY = null; });
})();