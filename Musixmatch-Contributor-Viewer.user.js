// ==UserScript==
// @name         Musixmatch-Contributor-Viewer
// @author       Bryce
// @namespace    http://tampermonkey.net/
// @version      5.4.1
// @description  Fixed a critical bug where the overwrite popup would either not appear when clicking the save button or would appear infinitely when clicking "Proceed". Improved reliability of the save button interceptor.
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
            if (!data[key]) data[key] = [];
            data[key].push({
              permission: (row.permission || '').toLowerCase(),
              note: row.note || '',
              language: row.language || '',
              musixmatch_link: row.musixmatch_link,
              slack_link: row.slack_link
            });
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
  
    const fontAwesome = document.createElement('link');
    fontAwesome.rel = 'stylesheet';
    fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(fontAwesome);
  
    const style = document.createElement('style');
    style.textContent = `
    .mxm-panel::-webkit-scrollbar { width: 6px; }
    .mxm-panel::-webkit-scrollbar-thumb { background-color: ${isDark ? '#444' : '#ddd'}; border-radius: 8px; }
    .mxm-panel::-webkit-scrollbar-track { background-color: transparent; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes rotateIn { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }
      .fade-in { animation: fadeIn 0.4s ease-in-out; }
    .loading-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .loading-dots span {
      width: 6px;
      height: 6px;
      background: ${isDark ? '#FC542E' : '#ff6b4a'};
      border-radius: 50%;
      animation: bounce 0.6s infinite;
    }
    .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
      .dropdown-content {
        margin-top: 6px;
        padding: 6px 10px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        font-size: 13px;
        color: inherit;
        display: none;
      }
      .theme-toggle {
        position: absolute;
        top: 10px;
        right: 34px;
        cursor: pointer;
        font-size: 14px;
        background: transparent;
        border: none;
        z-index: 100000;
      }
      .role-icon {
        width: 16px;
        height: 16px;
        vertical-align: middle;
        margin-right: 5px;
        border-radius: 3px;
      }
      .lock-icon {
        font-size: 14px;
        margin-right: 4px;
        vertical-align: middle;
      }
      .mxm-link {
        color: white;
        text-decoration: none;
        font-size: 16px;
        margin-right: 10px;
        transition: color 0.2s ease;
      }
      .mxm-link:hover {
        color: #4EA9FF;
      }
      .dropdown-toggle-btn {
        margin-left: 8px;
        font-size: 13px;
        cursor: pointer;
        color: #aaa;
        transition: transform 0.3s ease;
      }
      .dropdown-toggle-btn.rotated {
        transform: rotate(180deg);
      }
      .jump-buttons {
        position: fixed;
        right: 30px;
        bottom: 160px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 2147483647;
      }
      .jump-buttons button {
        background: #FC542E;
        color: white;
        border: none;
        border-radius: 6px;
        width: 34px;
        height: 34px;
        font-size: 18px;
        cursor: pointer;
        opacity: 0.4;
        transition: all 0.2s ease;
      }
      .jump-buttons button:hover {
        transform: scale(1.1);
        opacity: 1;
      }
      
      /* Make the panel itself resizable on the left edge */
      .mxm-panel.resizable-left {
        cursor: ew-resize;
      }
    `;
    document.head.appendChild(style);
  
    // Get saved panel width or use default
    const savedWidth = localStorage.getItem('mxmPanelWidth');
    const panelWidth = savedWidth ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(savedWidth))) : 360;
    
    const panel = document.createElement('div');
    panel.className = 'mxm-panel';
    panel.style = `
      position: fixed;
      top: 100px;
      right: 20px;
      width: ${panelWidth}px;
      max-height: 70vh;
      overflow-y: auto;
      background: #1e1e1e;
      color: white;
      font-family: 'Helvetica Neue', sans-serif;
      font-size: 14px;
      border: 1px solid #444;
      border-radius: 10px;
      padding: 1.2em;
      box-shadow: 0 8px 16px rgba(0,0,0,0.4);
      display: none;
      z-index: 9999999;
    `;
    document.body.appendChild(panel);
    

  
    const jumpButtons = document.createElement('div');
    jumpButtons.className = 'jump-buttons';
    const upBtn = document.createElement('button');
    const downBtn = document.createElement('button');
    upBtn.textContent = '⬆';
    downBtn.textContent = '⬇';
    upBtn.onclick = () => panel.scrollBy({ top: -200, behavior: 'smooth' });
    downBtn.onclick = () => panel.scrollBy({ top: 200, behavior: 'smooth' });
    jumpButtons.append(upBtn, downBtn);
    document.body.appendChild(jumpButtons);
    jumpButtons.style.display = 'none';
  
    const button = document.createElement('button');
    button.innerHTML = '👥';
    button.title = 'View Contributors';
    button.style = `
      position: fixed;
    bottom: 80px;
      right: 20px;
    width: 40px;
    height: 40px;
    background-color: ${isDark ? '#2a2a2a' : '#f4f4f4'};
    color: ${isDark ? '#ffffff' : '#111111'};
    font-size: 18px;
    border: 1px solid ${isDark ? '#444' : '#ddd'};
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      cursor: pointer;
      z-index: 99999;
      display: none;
    transition: all 0.2s ease;
  `;
  button.onmouseenter = () => {
    button.style.transform = 'scale(1.05)';
    button.style.background = isDark ? '#333' : '#e8e8e8';
  };
  button.onmouseleave = () => {
    button.style.transform = 'scale(1)';
    button.style.background = isDark ? '#2a2a2a' : '#f4f4f4';
  };
    document.body.appendChild(button);
  
    const themeToggle = document.createElement('button');
    themeToggle.textContent = '🌗';
    themeToggle.className = 'theme-toggle';
  
    const updateTheme = () => {
      isDark = !isDark;
    // Save theme preference
    localStorage.setItem('mxmTheme', isDark ? 'dark' : 'light');
    debugLog('Theme updated:', { isDark, saved: localStorage.getItem('mxmTheme') });

      panel.style.background = isDark ? '#1e1e1e' : '#ffffff';
      panel.style.color = isDark ? '#ffffff' : '#111111';
    panel.querySelectorAll('select').forEach(sel => {
      sel.style.background = isDark ? '#2a2a2a' : '#f4f4f4';
      sel.style.color = isDark ? '#ffffff' : '#111111';
      sel.style.border = '1px solid #aaa';
    });
    const closeX = panel.querySelector('span[style*="top: 10px"][style*="right"]');
    if (closeX) closeX.style.color = isDark ? '#fff' : '#222';
    panel.querySelectorAll('.contributor-entry strong').forEach(s => {
      s.style.color = isDark ? '#ffffff' : '#111111';
    });

    // update most recent box styling
    const mostRecentBox = panel.querySelector('div[style*="border-radius: 8px"]');
    if (mostRecentBox) {
      mostRecentBox.style.background = isDark ? '#2a2a2a' : '#ffffff';
      mostRecentBox.style.border = `1px solid ${isDark ? '#444' : '#ddd'}`;
    }

    // update contact icons
    panel.querySelectorAll('.mxm-link').forEach(link => {
      link.style.color = isDark ? 'white' : '#111';
    });

    // update scrollbar
    style.textContent = style.textContent.replace(
      /background-color: #[0-9a-fA-F]{3,6}/,
      `background-color: ${isDark ? '#444' : '#ddd'}`
    );
    


    // Update button styles without changing display property
    const buttonStyles = {
      backgroundColor: isDark ? '#2a2a2a' : '#f4f4f4',
      color: isDark ? '#ffffff' : '#111111',
      border: `1px solid ${isDark ? '#444' : '#ddd'}`
    };
    Object.assign(button.style, buttonStyles);
  };

  // Apply initial theme
  const applyTheme = () => {
    debugLog('Applying initial theme:', { isDark, saved: localStorage.getItem('mxmTheme') });
    panel.style.background = isDark ? '#1e1e1e' : '#ffffff';
    panel.style.color = isDark ? '#ffffff' : '#111111';
    
    // Update button styles without changing display property
    const buttonStyles = {
      backgroundColor: isDark ? '#2a2a2a' : '#f4f4f4',
      color: isDark ? '#ffffff' : '#111111',
      border: `1px solid ${isDark ? '#444' : '#ddd'}`
    };
    Object.assign(button.style, buttonStyles);
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
  panel.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);

    themeToggle.onclick = updateTheme;
  
    const renderDropdown = (entries = []) => {
      const el = document.createElement('div');
      el.className = 'dropdown-content fade-in';
      entries.forEach((entry, i) => {
        const [icon, label] = lockDisplay[entry.permission] || ['🔒', '—'];
        el.innerHTML += `
          <div><b>Language:</b> ${entry.language || '—'}</div>
          <div><b>Permission:</b> ${label}</div>
          <div><b>Note:</b> ${entry.note || '—'}</div>
          <div style="margin-top:6px;">
          ${entry.musixmatch_link ? `<a href="${entry.musixmatch_link}" target="_blank" class="mxm-link" style="color: ${isDark ? 'white' : '#111'}"><i class="fas fa-user-circle"></i></a>` : ''}
          ${entry.slack_link ? `<a href="${entry.slack_link}" target="_blank" class="mxm-link" style="color: ${isDark ? 'white' : '#111'}"><i class="fab fa-slack"></i></a>` : ''}
          </div>
          ${i < entries.length - 1 ? '<hr style="border-color:#333;">' : ''}
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

        //  auto-refresh indicator if this is an auto-refresh -- needs styling update
        const titleText = isAutoRefresh ? 
          '<strong style="font-size: 1.3em; display:block; margin-bottom: 12px;">Contributors <span id="mxm-refresh-indicator" style="font-size: 0.8em; color: #FC542E; font-weight: normal;">refreshing...</span></strong>' :
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
  
        const closeX = document.createElement('span');
        closeX.textContent = '✖';
        closeX.style = `position: absolute; top: 10px; right: 12px; cursor: pointer; font-size: 16px; color: ${isDark ? '#fff' : '#222'};`;
        closeX.onclick = () => panel.style.display = 'none';
        panel.appendChild(closeX);
        panel.appendChild(themeToggle);
        
        // --- add copy track id button ---
        const copyTrackIdBtn = document.createElement('button');
        copyTrackIdBtn.textContent = '📋'; // unicode clipboard emoji
        copyTrackIdBtn.title = 'Copy abstract'; // default browser tooltip
        copyTrackIdBtn.setAttribute('aria-label', 'Copy abstract');
        copyTrackIdBtn.style = `
          position: absolute;
          top: 10px;
          right: 64px;
          background: transparent;
          border: none;
          color: ${isDark ? '#fff' : '#222'};
          font-size: 14px;
          cursor: pointer;
          z-index: 100001;
          padding: 0 2px;
          height: 24px;
          width: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        `;
        // ensure themeToggle matches for alignment and font size
        themeToggle.style.fontSize = '14px';
        themeToggle.style.height = '24px';
        themeToggle.style.width = '24px';
        themeToggle.style.display = 'flex';
        themeToggle.style.alignItems = 'center';
        themeToggle.style.justifyContent = 'center';
        themeToggle.style.top = '10px';
        
        copyTrackIdBtn.onclick = async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(lastTaskId || '');
            // create custom floating popup
            const popup = document.createElement('div');
            popup.textContent = 'Copied Abstrack!';
            popup.style = `
              position: absolute;
              background: ${isDark ? '#222' : '#eee'};
              color: ${isDark ? '#fff' : '#111'};
              border-radius: 4px;
              padding: 2px 8px;
              font-size: 12px;
              box-shadow: 0 1px 4px rgba(0,0,0,0.10);
              opacity: 0.97;
              z-index: 100002;
              pointer-events: none;
              transition: opacity 0.2s;
              white-space: nowrap;
            `;
            copyTrackIdBtn.parentNode.appendChild(popup);
            // position popup centered below the button
            const btnRect = copyTrackIdBtn.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            const popupLeft = btnRect.left - panelRect.left + (btnRect.width - popup.offsetWidth) / 2;
            popup.style.left = Math.max(0, popupLeft) + 'px';
            popup.style.top = (btnRect.bottom - panelRect.top + 2) + 'px';
            setTimeout(() => {
              if (popup.parentNode) popup.parentNode.removeChild(popup);
            }, 1500);
          } catch (err) {
            // optionally handle error
          }
        };
        panel.appendChild(copyTrackIdBtn);
        // --- end copy track id button ---

    // add most recent section
    const mostRecent = filtered[0];
    
    // Debug log the most recent contributor
    debugLog('Most recent contributor:', {
      name: mostRecent.name,
      role: mostRecent.role,
      type: mostRecent.type,
      date: mostRecent.date
    });
    
    const mostRecentSection = document.createElement('div');
    mostRecentSection.style = `
      background: ${isDark ? '#2a2a2a' : '#ffffff'};
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
      border: 1px solid ${isDark ? '#444' : '#ddd'};
    `;

    const roleKey = mostRecent.role.toLowerCase();
    const isSpecialist = roleKey === 'specialist';
    const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
    const iconHTML = iconSrc.startsWith('http') ? `<img class="role-icon" src="${iconSrc}" draggable="false" oncontextmenu="return false">` : `${iconSrc} `;
    const keyExact = mostRecent.name.toLowerCase(), keyInit = normalizeName(mostRecent.name);
    const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
    const firstPerm = matchRows[0]?.permission;
    const lock = lockDisplay[firstPerm] ? `<span class="lock-icon" title="${lockDisplay[firstPerm][1]}">${lockDisplay[firstPerm][0]}</span>` : '';

    const overwriteStatus = firstPerm === 'no' ?
      '<span style="color: #ff4444;">Don\'t overwrite</span>' :
      firstPerm === 'yes' ?
      '<span style="color: #2ecc71;">Overwrites allowed</span>' :
      firstPerm === 'ask' ?
      '<span style="color: #ffbb00;">Ask first</span>' :
      '<span style="color: #888;">No overwrite info</span>';

    mostRecentSection.innerHTML = `
      <div style="font-size: 0.9em; color: #888; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <i class="fas fa-clock" style="color: ${isDark ? '#FC542E' : '#ff6b4a'}"></i>
        Most recent
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="display: flex; align-items: center;">
            <strong style="color: #FC542E;">${firstPerm ? lock : ''}${iconHTML}${mostRecent.name}</strong>
            ${isSpecialist && matchRows.length ? '<i class="fas fa-chevron-down dropdown-toggle-btn" style="cursor: pointer; font-size: 12px; color: #888;"></i>' : ''}
          </div>
          <div style="font-size: 0.9em; color: #888;">${mostRecent.type.replace(/_/g, ' ')}</div>
        </div>
        <div style="text-align: right;">
          ${overwriteStatus}
          <div style="font-size: 0.8em; color: #888;">${mostRecent.date.toLocaleDateString()}</div>
        </div>
      </div>
    `;

    if (matchRows.length && isSpecialist) {
      const dropdown = renderDropdown(matchRows);
      dropdown.style.display = 'none';
      const toggleBtn = mostRecentSection.querySelector('.dropdown-toggle-btn');
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
          // Debug log the contributor entry being rendered
          debugLog('Rendering contributor entry:', { name, role, type, date });
          
          const roleKey = role.toLowerCase();
          const isSpecialist = roleKey === 'specialist';
          const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
      const iconHTML = iconSrc.startsWith('http') ? `<img class="role-icon" src="${iconSrc}" draggable="false" oncontextmenu="return false">` : `${iconSrc} `;
          const keyExact = name.toLowerCase(), keyInit = normalizeName(name);
          const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
          const firstPerm = matchRows[0]?.permission;
      const color = isDark ? '#ffffff' : '#111111';
  
          const entry = document.createElement('div');
          entry.className = 'fade-in contributor-entry';
          entry.style = 'margin-bottom: 12px; padding: 6px 4px;';
  
          const mainLine = document.createElement('div');
          mainLine.style = 'display:flex; justify-content:space-between; align-items:center;';
  
          const nameBlock = document.createElement('div');
      nameBlock.innerHTML = `<strong style="color:${color}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${iconHTML}${name}</strong>`;
  
          const metaLine = document.createElement('div');
      metaLine.style = 'color: #888; font-size: 13px; margin-top: 2px;';
          metaLine.textContent = type.replace(/_/g, ' ');
  
          const timeBlock = document.createElement('div');
          timeBlock.style = 'font-size: 0.8em; color: #888; text-align: right;';
          timeBlock.innerHTML = `${date.toLocaleDateString()}<br><span style="opacity: 0.6;">${date.toLocaleTimeString()}</span>`;
  
          const toggleBtn = document.createElement('span');
          toggleBtn.className = 'dropdown-toggle-btn';
          toggleBtn.innerHTML = isSpecialist && matchRows.length ? '<i class="fas fa-chevron-down"></i>' : '';
      toggleBtn.style = 'color: #888;';
  
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
          monthHeader.style = `
            color: ${isDark ? '#aaa' : '#666'};
            font-size: 1em;
            font-weight: 600;
            margin: 20px 0 12px 0;
            padding: 4px 0;
            border-bottom: 1px solid ${isDark ? '#333' : '#eee'};
            letter-spacing: 0.5px;
          `;
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
    loadMoreBtn.style = `
      width: 100%;
      padding: 10px;
      margin-top: 16px;
      background: ${isDark ? '#2a2a2a' : '#f4f4f4'};
      border: 1px solid ${isDark ? '#444' : '#ddd'};
      border-radius: 8px;
      color: ${isDark ? '#fff' : '#111'};
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s ease;
    `;
    loadMoreBtn.onmouseover = () => {
      loadMoreBtn.style.background = isDark ? '#333' : '#e8e8e8';
    };
    loadMoreBtn.onmouseout = () => {
      loadMoreBtn.style.background = isDark ? '#2a2a2a' : '#f4f4f4';
    };
    loadMoreBtn.onclick = loadMoreContributors;

    // Load the first batch
    loadMoreContributors();
  
        panel.appendChild(jumpButtons);
        jumpButtons.style.display = 'flex';
    };
  
    const showMessage = (msg, color = '#aaa') => {
    // determine icon and color based on message content
    let icon, borderColor, bgColor;
    
    if (msg.includes('❌')) {
      icon = '<i class="fas fa-exclamation-circle" style="color: #ff4444; font-size: 24px;"></i>';
      borderColor = '#ff4444';
      bgColor = isDark ? '#2a2a2a' : '#f8f8f8';
    } else if (msg.includes('⚠️')) {
      icon = '<i class="fas fa-exclamation-triangle" style="color: #ffbb00; font-size: 24px;"></i>';
      borderColor = '#ffbb00';
      bgColor = isDark ? '#2a2a2a' : '#f8f8f8';
    } else {
      icon = '<i class="fas fa-info-circle" style="color: #4EA9FF; font-size: 24px;"></i>';
      borderColor = '#4EA9FF';
      bgColor = isDark ? '#2a2a2a' : '#f8f8f8';
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
        <div style="margin-top: 16px; padding: 12px; background: ${bgColor}; border-radius: 8px; border-left: 3px solid ${borderColor};">
          <div style="font-weight: 600; color: ${isDark ? '#fff' : '#000'}; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <i class="fas fa-lightbulb" style="color: ${borderColor};"></i>
            Next Steps
          </div>
          <ul style="margin: 0; padding-left: 16px; color: ${isDark ? '#ccc' : '#555'}; font-size: 13px; line-height: 1.4;">
            <li>If this is a new track, you can safely proceed with your work</li>
            <li>Manually check the <a href="${button.dataset.lyricsUrl || '#'}" target="_blank" style="color: ${borderColor}; text-decoration: none;">song page</a> before continuing</li>
            <li>Contact Bryce M. on Slack if you believe this is an error</li>
          </ul>
        </div>
      `;
    } else if (msg.includes('/tool')) {
      nextSteps = `
        <div style="margin-top: 16px; padding: 12px; background: ${bgColor}; border-radius: 8px; border-left: 3px solid ${borderColor};">
          <div style="font-weight: 600; color: ${isDark ? '#fff' : '#000'}; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <i class="fas fa-external-link-alt" style="color: ${borderColor};"></i>
            Action Required
          </div>
          <div style="color: ${isDark ? '#ccc' : '#555'}; font-size: 13px; line-height: 1.4;">
            Navigate to a track's studio page (URL contains <code>/tool</code>) to view contributors.
          </div>
        </div>
      `;
    } else if (msg.includes('track info tab')) {
      nextSteps = `
        <div style="margin-top: 16px; padding: 12px; background: ${bgColor}; border-radius: 8px; border-left: 3px solid ${borderColor};">
          <div style="font-weight: 600; color: ${isDark ? '#fff' : '#000'}; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <i class="fas fa-info-circle" style="color: ${borderColor};"></i>
            Required Action
          </div>
          <div style="color: ${isDark ? '#ccc' : '#555'}; font-size: 13px; line-height: 1.4;">
            Open the track info tab first to load contributor data for this song.
          </div>
        </div>
      `;
    } else if (msg.includes('Failed to load')) {
      nextSteps = `
        <div style="margin-top: 16px; padding: 12px; background: ${bgColor}; border-radius: 8px; border-left: 3px solid ${borderColor};">
          <div style="font-weight: 600; color: ${isDark ? '#fff' : '#000'}; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <i class="fas fa-tools" style="color: ${borderColor};"></i>
            Troubleshooting
          </div>
          <ul style="margin: 0; padding-left: 16px; color: ${isDark ? '#ccc' : '#555'}; font-size: 13px; line-height: 1.4;">
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
          background: ${isDark ? '#333' : '#f0f0f0'};
          border: 1px solid ${isDark ? '#555' : '#ddd'};
          border-radius: 6px;
          padding: 8px 12px;
          color: ${isDark ? '#ccc' : '#666'};
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          text-align: left;
          transition: all 0.2s ease;
        ">
          <i class="fas fa-code" style="color: #FC542E;"></i>
          Technical Information
          <i class="fas fa-chevron-down" style="margin-left: auto; transition: transform 0.2s ease;"></i>
        </button>
        <div id="mxm-tech-content" style="
          display: none;
          margin-top: 8px;
          padding: 12px;
          background: ${isDark ? '#1a1a1a' : '#fafafa'};
          border-radius: 6px;
          border: 1px solid ${isDark ? '#333' : '#eee'};
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 11px;
          line-height: 1.4;
          color: ${isDark ? '#ccc' : '#666'};
          max-height: 200px;
          overflow-y: auto;
        ">
          ${Object.entries(technicalInfo).map(([key, value]) => 
            `<div style="margin-bottom: 4px;"><span style="color: #FC542E;">${key}:</span> ${value}</div>`
          ).join('')}
        </div>
      </div>
    `;

    panel.innerHTML = `
      <div class="fade-in" style="
        color: ${isDark ? color : '#111'};
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
            color: ${isDark ? '#fff' : '#000'};
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
          toggleBtn.style.background = isDark ? '#444' : '#e8e8e8';
        };
        toggleBtn.onmouseleave = () => {
          toggleBtn.style.background = isDark ? '#333' : '#f0f0f0';
        };
      }
    }, 100);

    const closeX = document.createElement('span');
    closeX.textContent = '✖';
    closeX.className = 'mxm-close-button';
    closeX.style = `position: absolute; top: 10px; right: 12px; cursor: pointer; font-size: 16px; color: ${isDark ? '#fff' : '#222'};`;
    closeX.onclick = () => panel.style.display = 'none';
    panel.appendChild(closeX);
    panel.appendChild(themeToggle);
    panel.style.display = 'block';
    jumpButtons.style.display = 'none';
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

          // Fetch contributor data immediately
          fetchContributorData(lyricsUrl).then(contributors => {
            if (contributors) {
              currentPageContributors = contributors;
              
              // Auto-refresh panel if it's already open
              if (panel.style.display === 'block') {
                debugLog('Panel is open, auto-refreshing with new contributors');
                renderContributors(contributors, true);
              }
            }
          });
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

              // Fetch contributor data immediately
              fetchContributorData(url).then(contributors => {
                if (contributors) {
                  currentPageContributors = contributors;
                  
                  // Auto-refresh panel if it's already open
                  if (panel.style.display === 'block') {
                    debugLog('Panel is open, auto-refreshing with new contributors');
                    renderContributors(contributors);
                  }
                }
              });
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

  // Add new function to fetch contributor data
  let fetchContributorData = (lyricsUrl) => {
    const startTime = Date.now();
    debugLog('Fetching contributor data:', {
      url: lyricsUrl,
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

    // start both requests in parallel
    return Promise.all([
      fetchPermissionData(),
      new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: lyricsUrl,
          onload: res => {
            try {
            const text = res.responseText;
              
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
                responseText: res.responseText,
                songInfo,
                url: lyricsUrl,
                responseStatus: res.status,
                responseType: res.responseType
              });
              reject(error);
            }
          },
          onerror: (error) => {
            debugError(error, { 
              url: lyricsUrl,
              songInfo,
              errorType: error.type,
              errorStatus: error.status
            });
            reject(error);
          }
        });
      })
    ]).then(([permissions, newContributors]) => {
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
        fetchDuration: Date.now() - startTime
      });

      debugPerformance('Total contributor data processing', startTime);
      return newContributors;
    }).catch((error) => {
      debugError(error, {
        url: lyricsUrl,
        lastLyricsUrl,
        currentContributors: currentPageContributors,
        songInfo,
        fetchDuration: Date.now() - startTime
      });
      showMessage('⚠️ Failed to load contributor data.', 'orange');
      return null;
    });
  };

  button.onclick = async () => {
    const lyricsURL = button.dataset.lyricsUrl;
    const currentTaskId = new URLSearchParams(window.location.search).get('commontrack_id');
    if (!location.pathname.startsWith('/tool')) {
      showMessage(`❌ Contributors only available on <code>/tool</code> pages.`, 'red');
      return;
    }
    if (!lyricsURL || currentTaskId !== lastTaskId) {
      showMessage(`⚠️ Please open the track info tab first to load contributor data for this song.`);
      return;
    }

    // Always show the panel first
    panel.style.display = 'block';

    // Add close button and theme toggle immediately
    const closeX = document.createElement('span');
    closeX.textContent = '✖';
    closeX.style = `position: absolute; top: 10px; right: 12px; cursor: pointer; font-size: 16px; color: ${isDark ? '#fff' : '#222'};`;
    closeX.onclick = () => panel.style.display = 'none';
    panel.innerHTML = ''; // Clear panel
    panel.appendChild(closeX);
    panel.appendChild(themeToggle);

    // If we don't have data yet, show loading and fetch it
    if (currentPageContributors.length === 0) {
      // show loading state with new animation
      const loadingContent = document.createElement('div');
      loadingContent.innerHTML = `<strong style="font-size: 1.3em;">Contributors</strong><br><br>
        <div class="fade-in" style="display:flex; align-items:center; gap:12px; font-size: 14px; color: #aaa;">
          <div class="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
          Loading contributors
        </div>`;
      panel.appendChild(loadingContent);

      // --- add copy track id button to loading state ---
      const copyTrackIdBtn = document.createElement('button');
      copyTrackIdBtn.textContent = '📋'; // unicode clipboard emoji
      copyTrackIdBtn.title = 'Copy abstract'; // default browser tooltip
      copyTrackIdBtn.setAttribute('aria-label', 'Copy abstract');
      copyTrackIdBtn.style = `
        position: absolute;
        top: 10px;
        right: 64px;
        background: transparent;
        border: none;
        color: ${isDark ? '#fff' : '#222'};
        font-size: 14px;
        cursor: pointer;
        z-index: 100001;
        padding: 0 2px;
        height: 24px;
        width: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      // ensure themeToggle matches for alignment and font size
      themeToggle.style.fontSize = '14px';
      themeToggle.style.height = '24px';
      themeToggle.style.width = '24px';
      themeToggle.style.display = 'flex';
      themeToggle.style.alignItems = 'center';
      themeToggle.style.justifyContent = 'center';
      themeToggle.style.top = '10px';
      
      copyTrackIdBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(lastTaskId || '');
          // create custom floating popup
          const popup = document.createElement('div');
          popup.textContent = 'Copied Abstrack!';
          popup.style = `
            position: absolute;
            background: ${isDark ? '#222' : '#eee'};
            color: ${isDark ? '#fff' : '#111'};
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 12px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.10);
            opacity: 0.97;
            z-index: 100002;
            pointer-events: none;
            transition: opacity 0.2s;
            white-space: nowrap;
          `;
          copyTrackIdBtn.parentNode.appendChild(popup);
          // position popup centered below the button
          const btnRect = copyTrackIdBtn.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          const popupLeft = btnRect.left - panelRect.left + (btnRect.width - popup.offsetWidth) / 2;
          popup.style.left = Math.max(0, popupLeft) + 'px';
          popup.style.top = (btnRect.bottom - panelRect.top + 2) + 'px';
          setTimeout(() => {
            if (popup.parentNode) popup.parentNode.removeChild(popup);
          }, 1500);
        } catch (err) {
          // optionally handle error
        }
      };
      panel.appendChild(copyTrackIdBtn);
      // --- end copy track id button for loading state ---

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
    { text: debugMode ? '🔴 Disable Debug Mode' : '🟢 Enable Debug Mode', action: () => {
      debugMode = !debugMode;
      debugLog('Debug mode', debugMode ? 'enabled' : 'disabled');
      // Just close the menu; label will update next time menu is opened
    }},
    { text: '🙋‍♂️ Set My Name', action: () => {
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
    }},
    { text: '📏 Reset Panel Size', action: () => {
      panel.style.width = '360px';
      localStorage.removeItem('mxmPanelWidth');
    }},

  ];

  // add context menu to button
  button.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const menu = document.createElement('div');

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

    menu.style = `
      position: fixed;
      top: ${top}px;
      left: ${shouldShowLeft ? (e.clientX - menuWidth) : e.clientX}px;
      background: ${isDark ? '#2a2a2a' : '#ffffff'};
      border: 1px solid ${isDark ? '#444' : '#ddd'};
      border-radius: 8px;
      padding: 6px 0;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      min-width: 180px;
    `;
    menuItems(menu, e, button).forEach(item => {
      const div = document.createElement('div');
      div.style = `
        padding: 8px 16px;
        cursor: pointer;
        color: ${isDark ? '#ffffff' : '#111111'};
        font-size: 13px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      div.textContent = item.text;
      div.onmouseover = () => {
        div.style.background = isDark ? '#333' : '#f4f4f4';
        div.style.transform = 'translateX(2px)';
      };
      div.onmouseout = () => {
        div.style.background = 'transparent';
        div.style.transform = 'translateX(0)';
      };
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
    popup.style = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${isDark ? '#1e1e1e' : '#ffffff'};
      border: 1px solid ${isDark ? '#444' : '#ddd'};
      border-radius: 12px;
      padding: 28px;
      z-index: 1000000;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      max-width: 420px;
      width: 90%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      animation: popupFadeIn 0.3s ease-out;
    `;

    // Add keyframes for popup animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes popupFadeIn {
        from { opacity: 0; transform: translate(-50%, -48%); }
        to { opacity: 1; transform: translate(-50%, -50%); }
      }
      @keyframes iconPulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
      .mxm-popup-icon {
        animation: iconPulse 2s infinite;
      }
      .mxm-popup-link {
        position: relative;
        transition: all 0.2s ease;
      }
      .mxm-popup-link:hover {
        transform: translateY(-1px);
      }
      .mxm-popup-link:hover::after {
        content: '';
        position: absolute;
        bottom: -2px;
        left: 0;
        width: 100%;
        height: 1px;
        background: #FC542E;
        transform: scaleX(1);
        transition: transform 0.2s ease;
      }
      .mxm-popup-link:hover::after {
        transform: scaleX(1);
      }
      .mxm-popup-button {
        transition: all 0.2s ease;
      }
      .mxm-popup-button:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .mxm-popup-button:active {
        transform: translateY(0);
      }
      .mxm-popup-section {
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid ${isDark ? '#333' : '#eee'};
      }
      .mxm-popup-section:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }
    `;
    document.head.appendChild(style);

    // get contributor details
    const keyExact = contributorName.toLowerCase();
    const keyInit = normalizeName(contributorName);
    const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
    const [icon, message] = lockDisplay[permission] || ['🔒', 'This contributor does not allow overwrites'];

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
    const languageSections = Object.entries(languageGroups).map(([language, entries], index, array) => {
      const notes = entries.map(entry => entry.note).filter(Boolean);
      const uniqueNotes = [...new Set(notes)];

      return `
        <div class="mxm-popup-section" style="
          margin-bottom: ${index === array.length - 1 ? '0' : '16px'};
          padding-bottom: ${index === array.length - 1 ? '0' : '16px'};
          border-bottom: ${index === array.length - 1 ? 'none' : `1px solid ${isDark ? '#333' : '#eee'}`};
        ">
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
          ">
            <i class="fas fa-language" style="color: #FC542E; font-size: 16px;"></i>
            <span style="
              color: ${isDark ? '#fff' : '#111'};
              font-weight: 500;
              font-size: 15px;
            ">${language}</span>
          </div>
          <div style="
            color: ${isDark ? '#aaa' : '#666'};
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 12px;
          ">
            ${uniqueNotes.length > 0 ? uniqueNotes.map(note => `
              <div style="
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 8px;
              ">
                <i class="fas fa-info-circle" style="color: #FC542E; font-size: 16px; margin-top: 2px;"></i>
                ${note}
              </div>
            `).join('') : `
              <div style="
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 8px;
                color: ${isDark ? '#666' : '#999'};
              ">
                <i class="fas fa-info-circle" style="color: #FC542E; font-size: 16px; margin-top: 2px;"></i>
                User has not added any notes.
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');

    // Get the first entry for links
    const firstEntry = matchRows[0] || {};

    popup.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        text-align: center;
      ">
        <div style="
          font-size: 42px;
          margin-bottom: 4px;
          color: ${permission === 'no' ? '#ff4444' : permission === 'ask' ? '#ffbb00' : '#2ecc71'};
        " class="mxm-popup-icon">${icon}</div>
        <div style="
          font-size: 24px;
          font-weight: 600;
          color: ${isDark ? '#fff' : '#111'};
          margin-bottom: 4px;
          letter-spacing: -0.5px;
        ">Overwrite Warning</div>
        <div style="
          color: ${isDark ? '#aaa' : '#666'};
          line-height: 1.6;
          margin-bottom: 8px;
          font-size: 15px;
        ">
          <strong style="color: ${isDark ? '#fff' : '#111'}; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; max-width: 100%; display: inline-block;">${contributorName}</strong> ${permission === 'ask' ? 'requests to be asked before overwriting' : 'does not allow overwrites'}.
          Are you sure you want to proceed?
        </div>
        ${matchRows.length > 0 ? `
          <div style="
            background: ${isDark ? '#2a2a2a' : '#f8f8f8'};
            border-radius: 12px;
            padding: 20px;
            width: 100%;
            text-align: left;
            margin-bottom: 8px;
            border: 1px solid ${isDark ? '#333' : '#eee'};
          ">
            ${languageSections}
            ${(firstEntry.musixmatch_link || firstEntry.slack_link) ? `
              <div style="
                display: flex;
                gap: 16px;
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid ${isDark ? '#333' : '#eee'};
              ">
                ${firstEntry.musixmatch_link ? `
                  <a href="${firstEntry.musixmatch_link}" target="_blank" class="mxm-popup-link" style="
                    color: ${isDark ? '#fff' : '#111'};
                    text-decoration: none;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 500;
                  ">
                    <i class="fas fa-user-circle" style="color: #FC542E; font-size: 18px;"></i>
                    Profile
                  </a>
                ` : ''}
                ${firstEntry.slack_link ? `
                  <a href="${firstEntry.slack_link}" target="_blank" class="mxm-popup-link" style="
                    color: ${isDark ? '#fff' : '#111'};
                    text-decoration: none;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 500;
                  ">
                    <i class="fab fa-slack" style="color: #FC542E; font-size: 18px;"></i>
                    Slack
                  </a>
                ` : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
        <div style="
          display: flex;
          gap: 12px;
          margin-top: 8px;
        ">
          <button id="mxm-cancel-overwrite" class="mxm-popup-button" style="
            padding: 12px 24px;
            border: 1px solid ${isDark ? '#444' : '#ddd'};
            border-radius: 8px;
            background: ${isDark ? '#2a2a2a' : '#f4f4f4'};
            color: ${isDark ? '#fff' : '#111'};
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            min-width: 120px;
          ">Cancel</button>
          <button id="mxm-confirm-overwrite" class="mxm-popup-button" style="
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            background: #FC542E;
            color: white;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            min-width: 120px;
          ">Proceed Anyway</button>
        </div>
        <div style="
          margin-top: 12px;
          color: ${isDark ? '#ff4444' : '#cc0000'};
          font-size: 12px;
          line-height: 1.4;
          text-align: center;
        ">
          <i class="fas fa-exclamation-triangle" style="margin-right: 4px;"></i>
          Overwriting lyrics without permission is against Musixmatch guidelines and may result in demotion from your current rank.
        </div>
      </div>
    `;

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
        
        popup.querySelector('#mxm-cancel-overwrite').onclick = () => {
          console.log('[MXM Interceptor] Overwrite cancelled');
          debugLog('Overwrite cancelled');
          debugState.lastAction = 'overwriteCancelled';
          debugState.actionCount++;
          cleanup();
          hasAcknowledgedWarning = false;
          debugPerformance('Overwrite cancellation', clickStartTime);
        };
        
        popup.querySelector('#mxm-confirm-overwrite').onclick = () => {
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
      
      // Find assistant menu using r-* classes (css-* classes are dynamic)
      const assistantMenu = document.querySelector('[class*="r-e6wx2c"][class*="r-24i33s"]');
      
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

      // polished card that matches Musixmatch assistant card styling
      // The r-* classes provide: background, border, border-radius, padding, box-shadow
      const cardHTML = `
        <div class="r-1ifxtd0 mxm-contributor-data-card">
          <div class="r-1otgn73 r-13awgt0" style="cursor: default;">
            <div class="r-za8utv r-1867qdf r-3pj75a r-95jzfe r-1j8onyl r-1kribmz r-d045u9" style="padding-bottom: 16px; border: 2px solid var(--mxm-backgroundSecondary);">
              <!-- Header - Only this uses Musixmatch font -->
              <div class="r-18u37iz r-1ifxtd0">
                <div class="r-13awgt0 r-18u37iz r-1wtj0ep">
                  <div dir="auto" class="css-146c3p1 r-fdjqy7 r-1grxjyw r-adyw6z r-135wba7" style="color: var(--mxm-contentPrimary); font-weight: 600; font-size: 20px; font-family: gordita-bold, sans-serif; display: flex; align-items: center; gap: 8px;"><i class="fas fa-users" style="color: #FC542E; font-size: 20px;"></i><span>Latest Contributor</span></div>
                </div>
              </div>
              
              <!-- Content Area -->
              <div class="r-13awgt0 r-1ifxtd0">
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
                        color: var(--mxm-contentPrimary);
                        font-weight: 500;
                        font-size: 15px;
                        font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                      ">${currentContributor.name}</div>
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
      const assistantHeader = assistantContent.querySelector('[class*="r-16y2uox"][class*="r-1q142lx"]');
      if (!assistantHeader) {
        debugLog('ERROR: Could not find assistant header');
        setTimeout(checkForAssistantMenu, 1000);
        return;
      }
      
      // Create a wrapper div for the card
      const cardWrapper = document.createElement('div');
      cardWrapper.innerHTML = cardHTML;
      cardWrapper.className = 'mxm-contributor-data-wrapper';
      
      // Insert the card after the header
      // The header is inside the content area, so we insert after it
      if (assistantHeader.parentNode) {
        try {
          assistantHeader.parentNode.insertBefore(cardWrapper, assistantHeader.nextSibling);
          debugLog('✓ Contributor Data card successfully added to assistant menu');
        } catch (e) {
          debugLog('ERROR: Failed to insert card:', e);
          setTimeout(checkForAssistantMenu, 1000);
        }
      } else {
        debugLog('ERROR: Assistant header has no parent node');
        setTimeout(checkForAssistantMenu, 1000);
      }
    };

    // Start checking for the assistant menu
    checkForAssistantMenu();
    
    // Also watch for the assistant menu to appear dynamically
    const observer = new MutationObserver((mutations) => {
      const assistantMenu = document.querySelector('[class*="r-e6wx2c"][class*="r-24i33s"]');
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
      card.style.display = 'none';
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
  panel.addEventListener('wheel', function(e) {
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
  panel.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      lastY = e.touches[0].clientY;
    }
  });
  panel.addEventListener('touchmove', function(e) {
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
  panel.addEventListener('touchend', function() { lastY = null; });
})();