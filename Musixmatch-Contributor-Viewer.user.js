// ==UserScript==
// @name         Musixmatch-Contributor-Viewer
// @author       Bryce
// @namespace    http://tampermonkey.net/
// @version      5.0.0
// @description  Version 5.0.0 is here! New features include: Dark/Light persistence, beta studio support, redesigned error pages, improved contributor info display, enhanced overwrite protection with detailed permission warnings and detailed debugging.
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
      const parts = name.trim().split(' ');
      return parts.length > 1 ? `${parts[0].toLowerCase()} ${parts[1][0].toLowerCase()}` : name.toLowerCase();
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
    `;
    document.head.appendChild(style);
  
    const panel = document.createElement('div');
    panel.className = 'mxm-panel';
    panel.style = `
      position: fixed;
    top: 100px;
      right: 20px;
      width: 360px;
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
  
    const renderContributors = (filtered) => {
        if (!filtered || filtered.length === 0) {
            showMessage(`⚠️ No contributor data found for this track. This song may not have any contributors. Reach out to Bryce on Slack if you think this is an error.`);
            return;
        }

        panel.innerHTML = '<strong style="font-size: 1.3em; display:block; margin-bottom: 12px;">Contributors</strong>';
  
        const closeX = document.createElement('span');
        closeX.textContent = '✖';
        closeX.style = `position: absolute; top: 10px; right: 12px; cursor: pointer; font-size: 16px; color: ${isDark ? '#fff' : '#222'};`;
        closeX.onclick = () => panel.style.display = 'none';
        panel.appendChild(closeX);
        panel.appendChild(themeToggle);

    // add most recent section
    const mostRecent = filtered[0];
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
    const isError = msg.includes('❌') || msg.includes('⚠️');
    const icon = isError ?
      (msg.includes('❌') ?
        '<i class="fas fa-exclamation-circle" style="color: red; font-size: 24px; margin-bottom: 12px;"></i>' :
        '<i class="fas fa-exclamation-triangle" style="color: #ffbb00; font-size: 24px; margin-bottom: 12px;"></i>') :
      '<i class="fas fa-info-circle" style="color: #4EA9FF; font-size: 24px; margin-bottom: 12px;"></i>';

    // Log error details in debug mode
    if (debugMode && isError) {
      if (msg.includes('Contributors only available')) {
        debugLog('Error: User tried to access contributors on non-tool page');
        debugLog('Current pathname:', location.pathname);
      } else if (msg.includes('Please open the track info tab')) {
        debugLog('Error: Track info tab not opened');
        debugLog('Current lyrics URL:', button.dataset.lyricsUrl);
        debugLog('Current task ID:', lastTaskId);
        debugLog('URL task ID:', new URLSearchParams(location.search).get('commontrack_id'));
      } else if (msg.includes('Failed to load contributor data')) {
        debugLog('Error: Failed to fetch contributor data');
        debugLog('Last lyrics URL:', lastLyricsUrl);
        debugLog('Current contributors:', currentPageContributors);
      }
    }

    // replace default emoji -- easier than going 1 by 1 to relplace each w/ fa icon
    const cleanMsg = msg.replace(/[❌⚠️]/, '').trim();

    // subtitles
    let subtitle = '';
    if (msg.includes('/tool')) {
      subtitle = 'Please navigate to a track\'s studio page to view contributors.';
    } else if (msg.includes('track info tab')) {
      subtitle = 'The track info tab must be opened first to load contributor data.';
    } else if (msg.includes('Failed to load')) {
      subtitle = 'Opps! Something went wrong... Try refreshing the page or contaxcting Bryce M. on Slack if the issue persists!';
    }

    panel.innerHTML = `
      <div class="fade-in" style="
        color: ${isDark ? color : '#111'};
        text-align: center;
        padding: 24px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
      ">
        ${icon}
        <div style="
          font-size: 16px;
          font-weight: 500;
          margin-bottom: ${subtitle ? '8px' : '0'};
        ">${cleanMsg}</div>
        ${subtitle ? `<div style="
          font-size: 13px;
          color: ${isDark ? '#888' : '#666'};
          max-width: 280px;
          line-height: 1.4;
        ">${subtitle}</div>` : ''}
      </div>`;

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
  const fetchContributorData = (lyricsUrl) => {
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

            const regex = /"name":"(.*?)","role":"(.*?)","contributionType":"(.*?)","date":"(.*?)"/g;
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
      showMessage('⚠️ Failed to load contributor data. If this is a new track, you can safely ignore this warning.', 'orange');
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

      // Try to fetch the data
      const contributors = await fetchContributorData(lyricsURL);
      if (contributors) {
        renderContributors(contributors);
      }
      return;
    }

    // If we have data, render it immediately
    renderContributors(currentPageContributors);
  };

  // add context menu to button
  button.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const menu = document.createElement('div');

    // calculate if menu should appear to the left
    const menuWidth = 200; // approximate width of menu
    const shouldShowLeft = e.clientX + menuWidth > window.innerWidth;

    menu.style = `
      position: fixed;
      top: ${e.clientY}px;
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

    const menuItems = [
      { text: '🌐 Visit Website', url: 'https://bryyce19.github.io/mxm-contribs/' },
      { text: '📚 Documentation', url: 'https://bryyce19.github.io/mxm-contribs/guide' },
      { text: debugMode ? '🔴 Disable Debug Mode' : '🟢 Enable Debug Mode', action: () => {
        debugMode = !debugMode;
        debugLog('Debug mode', debugMode ? 'enabled' : 'disabled');
      }}
    ];

    menuItems.forEach(item => {
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
      div.onclick = () => {
        if (item.url) {
          window.open(item.url, '_blank');
        } else if (item.action) {
          item.action();
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

  // add save button interceptor
  let isObserverActive = false;
  const interceptSaveButton = () => {
    const startTime = Date.now();
    if (isObserverActive) {
      debugLog('Button observer already active, skipping...');
      return;
    }

    debugLog('Starting save button interceptor...');
    debugState.lastAction = 'interceptSaveButton';
    debugState.actionCount++;
  
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          // Look specifically for the Send button
          const sendButton = node.querySelector?.('.css-175oi2r[tabindex="0"] .css-146c3p1[style*="color: var(--mxm-contentPrimaryInverted)"]');
          if (sendButton && [
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
            'Send',       // Danish
            'Versturen',  // Dutch
            'Send',       // English
            'Lähetä',     // Finnish
            'Envoyer',    // French
            'Senden',     // German
            'Στείλε',     // Greek
            'Voye',       // Haitian Creole
            'भेजें',      // Haryanvi
            'Aika',       // Hausa
            'שלח',        // Hebrew
            'भेजें',      // Hindi
            'Küldés',     // Hungarian
            'Ziga',       // Igbo
            'Kirim',      // Indonesian
            'Invia',      // Italian
            '送信',       // Japanese
            'Kirim',      // Javanese
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
            'Enviar',     // Portuguese
            'Trimite',    // Romanian
            'Отправить',  // Russian
            'प्रेषय',     // Sanskrit
            'Tumira',     // Shona
            'Odoslať',    // Slovak <3
            'Enviar',     // Spanish
            'Kirim',      // Sundanese
            'Skicka',     // Swedish
            'Ipadala',    // Tagalog
            'அனுப்பு',    // Tamil
            'పంపండి',     // Telugu
            'ส่ง',        // Thai
            'Rhumela',    // Tsonga
            'Gönder',     // Turkish
            'Надіслати',  // Ukrainian
            'بھیجیں',     // Urdu
            'Rhumela',    // Venda
            'Gửi',        // Vietnamese
            'Ránṣẹ́',     // Yoruba
            'Thumela',    // Xhosa
            'Thumela'     // Zulu
          ].includes(sendButton.textContent?.trim())) {
            debugLog('Found Send button:', {
              text: sendButton.textContent,
              parent: sendButton.closest('.css-175oi2r[tabindex="0"]')?.className,
              timestamp: new Date().toISOString()
            });

            // get the parent button element
            const parentBtn = sendButton.closest('.css-175oi2r[tabindex="0"]');
            if (!parentBtn) {
              debugLog('Could not find parent button element');
              continue;
            }

            // check if we've already added the listener
            if (parentBtn.hasAttribute('data-mxm-intercepted')) {
              debugLog('Button already intercepted, skipping...');
              continue;
            }

            // mark as intercepted
            parentBtn.setAttribute('data-mxm-intercepted', 'true');
            debugLog('Adding click interceptor to Send button');

            // add our interceptor
            parentBtn.addEventListener('click', async (e) => {
              const clickStartTime = Date.now();
              debugLog('Send button clicked');
              debugState.lastAction = 'sendButtonClick';
              debugState.actionCount++;

              // get current contributor
              const currentContributor = currentPageContributors[0];
              debugLog('Current contributor:', currentContributor);

              if (!currentContributor) {
                debugLog('No contributor found, proceeding with save');
                return;
              }

              // get contributor's permission
              const keyExact = currentContributor.name.toLowerCase();
              const keyInit = normalizeName(currentContributor.name);
              const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
              const permission = matchRows[0]?.permission;
              debugLog('Contributor permission:', {
                name: currentContributor.name,
                permission,
                matchType: keyExact in permissionData ? 'exact' : keyInit in permissionData ? 'initials' : 'none'
              });

              // if permission is 'ask' or 'no' and user hasn't acknowledged warning
              if ((permission === 'ask' || permission === 'no') && !hasAcknowledgedWarning) {
                debugLog('Showing overwrite warning popup');
                e.preventDefault();
                e.stopPropagation();

                // Disable the save button
                parentBtn.style.pointerEvents = 'none';
                parentBtn.style.opacity = '0.5';

                const popup = createOverwritePopup(currentContributor.name, permission);
                document.body.appendChild(popup);

                // add backdrop
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

                // handle popup buttons
                popup.querySelector('#mxm-cancel-overwrite').onclick = () => {
                  debugLog('Overwrite cancelled');
                  debugState.lastAction = 'overwriteCancelled';
                  debugState.actionCount++;
                  document.body.removeChild(popup);
                  document.body.removeChild(backdrop);
                  // Re-enable the save button
                  parentBtn.style.pointerEvents = 'auto';
                  parentBtn.style.opacity = '1';
                  hasAcknowledgedWarning = false; // Reset flag on cancel
                  debugPerformance('Overwrite cancellation', clickStartTime);
                };

                popup.querySelector('#mxm-confirm-overwrite').onclick = () => {
                  debugLog('Overwrite confirmed');
                  debugState.lastAction = 'overwriteConfirmed';
                  debugState.actionCount++;
                  document.body.removeChild(popup);
                  document.body.removeChild(backdrop);
                  // Re-enable the save button
                  parentBtn.style.pointerEvents = 'auto';
                  parentBtn.style.opacity = '1';
                  hasAcknowledgedWarning = true; // Set flag when user confirms
                  debugPerformance('Overwrite confirmation', clickStartTime);
                };
              } else {
                debugLog('No overwrite restrictions or warning already acknowledged, proceeding with save');
                hasAcknowledgedWarning = false; // Reset flag after save
                debugPerformance('Save without restrictions', clickStartTime);
              }
            });
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    isObserverActive = true;
    debugPerformance('Save button interceptor setup', startTime);
  };

  // wait for page to be ready before starting observer
  const waitForPageReady = () => {
    return new Promise((resolve) => {
      // check if we're on a tool page
      if (!location.pathname.startsWith('/tool')) {
        debugLog('Not on a tool page, skipping button observer');
        resolve();
        return;
      }

      // check for loading indicators
      const checkLoading = () => {
        const loadingIndicators = document.querySelectorAll('.css-175oi2r[style*="opacity: 0"]');
        if (loadingIndicators.length === 0) {
          debugLog('Page appears to be loaded');
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
  waitForPageReady().then(() => {
    interceptSaveButton();
  })
})();
