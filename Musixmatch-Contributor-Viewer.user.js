// ==UserScript==
// @name         Musixmatch-Contributor-Viewer
// @author       Bryce
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Contributor viewer with filters, roles, scrolling, and info tab checks
// @match        https://curators.musixmatch.com/*
// @grant        GM_xmlhttpRequest
// @connect      musixmatch.com
// @updateURL    https://github.com/bryyce19/mxm-contribs/raw/refs/heads/main/Musixmatch-Contributor-Viewer.user.js
// @downloadURL  https://github.com/bryyce19/mxm-contribs/raw/refs/heads/main/Musixmatch-Contributor-Viewer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const roleIcons = {
        specialist: 'https://github.com/bryyce19/mxm-contribs/blob/main/spec1.png?raw=true',
        curator: 'https://github.com/bryyce19/mxm-contribs/blob/main/curator1.png?raw=true',
        fallback: 'https://github.com/bryyce19/mxm-contribs/blob/main/grad1.png?raw=true'
    };

    const emojiFallback = {
        editor: '✍️',
        admin: '🛡️'
    };

    let contributors = [];
    let lastLyricsUrl = '';
    let lastTaskId = '';
    let isDark = true;

    const style = document.createElement('style');
    style.textContent = `
        .mxm-panel::-webkit-scrollbar { width: 8px; }
        .mxm-panel::-webkit-scrollbar-thumb { background-color: #FC542E; border-radius: 8px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.4s ease-in-out; }
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
        .contributor-entry { transition: background 0.2s ease; }
        .contributor-entry:hover {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
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
    jumpButtons.style = `
        position: fixed;
        right: 30px;
        bottom: 160px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 2147483647;
    `;
    const upBtn = document.createElement('button');
    const downBtn = document.createElement('button');
    upBtn.textContent = '⬆️';
    downBtn.textContent = '⬇️';
    upBtn.onclick = () => panel.scrollBy({ top: -200, behavior: 'smooth' });
    downBtn.onclick = () => panel.scrollBy({ top: 200, behavior: 'smooth' });
    jumpButtons.appendChild(upBtn);
    jumpButtons.appendChild(downBtn);
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
    themeToggle.onclick = () => {
        isDark = !isDark;
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
            s.style.color = s.dataset.latest === 'true' ? '#FC542E' : (isDark ? '#ffffff' : '#111111');
        });
    };

    const showMessage = (message, color = '#aaa') => {
        panel.innerHTML = `
            <div class="fade-in" style="color:${color}; text-align:center; padding: 10px; position: relative;">
                <span style="position:absolute; top:10px; right:12px; cursor:pointer; font-size:16px;" onclick="document.querySelector('.mxm-panel').style.display='none'">✖</span>
                ${message}
            </div>
        `;
        panel.style.display = 'block';
        jumpButtons.style.display = 'none';
    };

    const renderContributors = (filter = '') => {
        panel.innerHTML = '<strong style="font-size: 1.3em;">Contributors</strong><br>';
        const closeX = document.createElement('span');
        closeX.textContent = '✖';
        closeX.style = `position: absolute; top: 10px; right: 12px; cursor: pointer; font-size: 16px; color: ${isDark ? '#fff' : '#222'};`;
        closeX.onclick = () => panel.style.display = 'none';
        panel.appendChild(closeX);
        panel.appendChild(themeToggle);

        const dropdown = document.createElement('select');
        dropdown.style = `
            margin: 10px 0;
            padding: 6px;
            width: 100%;
            background: ${isDark ? '#2a2a2a' : '#f4f4f4'};
            color: ${isDark ? '#ffffff' : '#111111'};
            border: 1px solid #aaa;
            border-radius: 4px;
        `;
        const types = [...new Set(contributors.map(c => c.type))].filter(t => t !== 'lyrics_missing');
        dropdown.innerHTML = `<option value="">🔎 Filter by edit type</option>` + types.map(t =>
            `<option value="${t}" ${filter === t ? 'selected' : ''}>${t.replace(/_/g, ' ')}</option>`
        ).join('');
        dropdown.onchange = () => renderContributors(dropdown.value);
        panel.appendChild(dropdown);

        const filtered = filter ? contributors.filter(c => c.type === filter) : contributors;
        const latest = filtered[0]?.name;

        if (filtered.length === 0) {
            showMessage(`⚠️ No contributor data found for this track.`);
            return;
        }

        for (const { name, role, type, date } of filtered) {
            const roleKey = role.toLowerCase();
            const iconSrc = roleIcons[roleKey] || emojiFallback[roleKey] || roleIcons.fallback;
            const iconHTML = iconSrc.startsWith('http')
                ? `<img class="role-icon" src="${iconSrc}">`
                : `${iconSrc} `;

            const div = document.createElement('div');
            div.className = 'contributor-entry fade-in';
            div.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
            const color = name === latest ? '#FC542E' : (isDark ? '#ffffff' : '#111111');
            div.innerHTML = `
                <div style="max-width: 75%;">
                    <strong data-latest="${name === latest}" style="color:${color};">${iconHTML}${name}</strong><br>
                    <span style="color: #888;">${type.replace(/_/g, ' ')}</span>
                </div>
                <div style="font-size: 0.8em; color: #888; text-align: right;">
                    ${date.toLocaleDateString()}<br><span style="opacity: 0.6;">${date.toLocaleTimeString()}</span>
                </div>
            `;
            panel.appendChild(div);
            const hr = document.createElement('hr');
            hr.style.borderColor = '#333';
            panel.appendChild(hr);
        }

        panel.appendChild(jumpButtons);
        jumpButtons.style.display = 'flex';
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

        panel.innerHTML = `
            <strong style="font-size: 1.3em;">Contributors</strong><br><br>
            <div class="fade-in" style="display:flex; align-items:center; gap:8px; font-size: 14px; color: #aaa;">
                <div style="width: 16px; height: 16px; border: 3px solid #444; border-top: 3px solid #FC542E; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                Loading contributors...
            </div>
        `;
        panel.appendChild(themeToggle);
        panel.style.display = 'block';

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
                renderContributors();
            },
            onerror: () => showMessage('⚠️ Failed to load contributor data.', 'orange')
        });
    };

    const observer = new MutationObserver((mutations) => {
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
