// ==UserScript==
// @name         Musixmatch-Contributor-Viewer
// @author       Bryce
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  Version 4.0.0 is released! You can now view users' overwrite permission, contact links and languages! 
// @match        https://curators.musixmatch.com/*
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
      specialist: 'https://github.com/bryyce19/mxm-contribs/blob/main/spec1.png?raw=true',
      curator: 'https://github.com/bryyce19/mxm-contribs/blob/main/curator1.png?raw=true',
      fallback: 'https://github.com/bryyce19/mxm-contribs/blob/main/grad1.png?raw=true'
    };
    const emojiFallback = { editor: '✍️', admin: '🛡' };
    const lockDisplay = {
      yes: ['🔓', 'Allows overwrites'],
      ask: ['🙋‍🔒', 'Ask before overwriting'],
      no: ['🔒', 'Does not allow overwrites'],
      staff: ['🛠️', 'Overwrite at your discretion'],
      'no / notify': ['🔒', 'Does not allow overwrites']
    };
    let contributors = [], lastLyricsUrl = '', lastTaskId = '', isDark = true, permissionData = {};
  
    const normalizeName = name => {
      const parts = name.trim().split(' ');
      return parts.length > 1 ? `${parts[0].toLowerCase()} ${parts[1][0].toLowerCase()}` : name.toLowerCase();
    };
  
    const fetchPermissionData = () => new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: SHEET_URL,
        onload: res => {
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
          resolve(data);
        }
      });
    });
  
    const fontAwesome = document.createElement('link');
    fontAwesome.rel = 'stylesheet';
    fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(fontAwesome);
  
    const style = document.createElement('style');
    style.textContent = `
      .mxm-panel::-webkit-scrollbar { width: 8px; }
      .mxm-panel::-webkit-scrollbar-thumb { background-color: #FC542E; border-radius: 8px; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes rotateIn { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }
      .fade-in { animation: fadeIn 0.4s ease-in-out; }
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
      top: 80px;
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
      padding: 1em;
      box-shadow: 0 8px 16px rgba(0,0,0,0.4);
      display: none;
      z-index: 999999;
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
      bottom: 100px;
      right: 20px;
      width: 44px;
      height: 44px;
      background-color: #FC542E;
      color: white;
      font-size: 20px;
      border: none;
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer;
      z-index: 99999;
      display: none;
      transition: transform 0.2s ease;
    `;
    button.onmouseenter = () => button.style.transform = 'scale(1.1)';
    button.onmouseleave = () => button.style.transform = 'scale(1)';
    document.body.appendChild(button);
  
    const themeToggle = document.createElement('button');
    themeToggle.textContent = '🌗';
    themeToggle.className = 'theme-toggle';
  
    const updateTheme = () => {
      isDark = !isDark;
      panel.style.background = isDark ? '#1e1e1e' : '#ffffff';
      panel.style.color = isDark ? '#ffffff' : '#111111';
      panel.querySelectorAll('strong').forEach(s => {
        s.style.color = s.dataset.latest === 'true' ? '#FC542E' : (isDark ? '#ffffff' : '#111111');
      });
      panel.querySelectorAll('.dropdown-content').forEach(drop => {
        drop.style.color = isDark ? '#ddd' : '#111';
      });
      panel.querySelectorAll('.mxm-link i').forEach(icon => {
        icon.style.color = isDark ? 'white' : 'black';
      });
      const closeX = panel.querySelector('.mxm-close-button');
      if (closeX) closeX.style.color = isDark ? '#fff' : '#222';
  
    };
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
            ${entry.musixmatch_link ? `<a href="${entry.musixmatch_link}" target="_blank" class="mxm-link"><i class="fas fa-user-circle"></i></a>` : ''}
            ${entry.slack_link ? `<a href="${entry.slack_link}" target="_blank" class="mxm-link"><i class="fab fa-slack"></i></a>` : ''}
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
        closeX.className = 'mxm-close-button';
        closeX.style = `position: absolute; top: 10px; right: 12px; cursor: pointer; font-size: 16px; color: ${isDark ? '#fff' : '#222'};`;
        closeX.onclick = () => panel.style.display = 'none';
        panel.appendChild(closeX);
        panel.appendChild(themeToggle);
  
        const latest = filtered[0]?.name;
  
        for (const { name, role, type, date } of filtered) {
          const roleKey = role.toLowerCase();
          const isSpecialist = roleKey === 'specialist';
          const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
          const iconHTML = iconSrc.startsWith('http') ? `<img class="role-icon" src="${iconSrc}">` : `${iconSrc} `;
          const keyExact = name.toLowerCase(), keyInit = normalizeName(name);
          const matchRows = permissionData[keyExact] || permissionData[keyInit] || [];
          const firstPerm = matchRows[0]?.permission;
          const lock = name === latest && lockDisplay[firstPerm]
          ? `<span class="lock-icon" title="${lockDisplay[firstPerm][1]}">${lockDisplay[firstPerm][0]}</span>`
          : '';
          const color = name === latest ? '#FC542E' : (isDark ? '#ffffff' : '#111111');
  
          const entry = document.createElement('div');
          entry.className = 'fade-in contributor-entry';
          entry.style = 'margin-bottom: 12px; padding: 6px 4px;';
  
          const mainLine = document.createElement('div');
          mainLine.style = 'display:flex; justify-content:space-between; align-items:center;';
  
          const nameBlock = document.createElement('div');
          nameBlock.innerHTML = `<strong data-latest="${name === latest}" style="color:${color};">${lock}${iconHTML}${name}</strong>`;
  
          const metaLine = document.createElement('div');
          metaLine.style = `color: ${isDark ? '#aaa' : '#222'}; font-size: 13px; margin-top: 2px;`;
          metaLine.textContent = type.replace(/_/g, ' ');
  
          const timeBlock = document.createElement('div');
          timeBlock.style = 'font-size: 0.8em; color: #888; text-align: right;';
          timeBlock.innerHTML = `${date.toLocaleDateString()}<br><span style="opacity: 0.6;">${date.toLocaleTimeString()}</span>`;
  
          const toggleBtn = document.createElement('span');
          toggleBtn.className = 'dropdown-toggle-btn';
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
  
          panel.appendChild(entry);
          panel.appendChild(Object.assign(document.createElement('hr'), { style: 'border-color: #333;' }));
        }
  
        panel.appendChild(jumpButtons);
        jumpButtons.style.display = 'flex';
    };
  
    const showMessage = (msg, color = '#aaa') => {
      panel.innerHTML = `<div class="fade-in" style="color:${isDark ? color : '#111'}; text-align:center; padding: 10px;">${msg}</div>`;
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
  
    button.onclick = () => {
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
  
      panel.innerHTML = `<strong style="font-size: 1.3em;">Contributors</strong><br><br>
        <div class="fade-in" style="display:flex; align-items:center; gap:8px; font-size: 14px; color: #aaa;">
          <div style="width: 16px; height: 16px; border: 3px solid #444; border-top: 3px solid #FC542E; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          Loading contributors...
        </div>`;
      panel.appendChild(themeToggle);
      panel.style.display = 'block';
  
      fetchPermissionData().then(data => {
        permissionData = data;
        GM_xmlhttpRequest({
          method: 'GET',
          url: lyricsURL,
          onload: res => {
            const text = res.responseText;
            const regex = /"name":"(.*?)","role":"(.*?)","contributionType":"(.*?)","date":"(.*?)"/g;
            contributors = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
              const [_, name, role, type, date] = match;
              if (name.includes("@") || name.toLowerCase().includes("freelance") || role === "mxm") continue;
              contributors.push({ name, role, type, date: new Date(date) });
            }
            contributors.sort((a, b) => b.date - a.date);
            lastLyricsUrl = lyricsURL;
            lastTaskId = currentTaskId;
            renderContributors(contributors);
          },
          onerror: () => showMessage('⚠️ Failed to load contributor data. There may be none.', 'orange')
        });
      });
    };
  
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          const a = node.querySelector?.('a[href*="/lyrics/"]');
          if (a) {
            const href = a.getAttribute('href');
            if (/^\/\/www\.musixmatch\.com\/lyrics\/\d+\/\d+$/.test(href)) {
              const url = `https:${href}`;
              button.dataset.lyricsUrl = url;
              lastTaskId = new URLSearchParams(location.search).get('commontrack_id');
              button.style.display = 'block';
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })();
