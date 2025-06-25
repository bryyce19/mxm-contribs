// ==UserScript==
// @name         Musixmatch Staff Indicator
// @author       Bryce
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  DO NOT INSTALL THIS YET 
// @match        https://www.musixmatch.com/profile/*
// @grant        none
// ==/UserScript==


(function() {
    'use strict';

    // fetch specialist list from Google Sheet via opensheet
    const SPECIALIST_URL = 'https://opensheet.elk.sh/1p_8KtGQG1F4ztIy_yGKGIo-T6Le_d5HmXuMERAhBIZM/AllSpecAccounts';
    let specialistList = [];
    let lastProfileName = null;
    let lastUrl = location.href;
    let observer = null;

    // icon
    const fa = document.createElement('link');
    fa.rel = 'stylesheet';
    fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(fa);

    function handleProfileName(nameEl) {
        const profileName = nameEl.textContent.trim().toLowerCase();
        if (profileName === lastProfileName) return; // already handled
        lastProfileName = profileName;

        if (!specialistList.includes(profileName)) {
            // Find the Specialist label
            const labelEl = Array.from(document.querySelectorAll('div.css-146c3p1'))
                .find(el => el.textContent.trim().toLowerCase() === 'specialist');
            if (labelEl && labelEl.parentElement) {
                labelEl.innerHTML = '<i class="fas fa-user-shield" style="margin-right:4px"></i>Staff';
                labelEl.setAttribute('lang', 'en');
                labelEl.classList.add('notranslate');
                labelEl.parentElement.setAttribute('lang', 'en');
                labelEl.parentElement.classList.add('notranslate');
                labelEl.style.color = '#7a4d00';
                labelEl.style.fontWeight = '600';
                labelEl.style.letterSpacing = '0.5px';
                labelEl.parentElement.style.backgroundColor = '#ffecb3';
                labelEl.parentElement.style.borderRadius = '6px';
                labelEl.parentElement.style.boxShadow = '0 1px 4px rgba(0,0,0,0.07)';
                labelEl.parentElement.title = 'This user is not on the Specialist list and therefore is flagged as an internal Staff member.';
                labelEl.setAttribute('data-translate', 'no');
                labelEl.parentElement.setAttribute('data-translate', 'no');
                labelEl.style.cursor = 'help';
            }
        }
    }

    function observeProfileHeader() {
        if (observer) observer.disconnect();
        const target = document.querySelector('main') || document.body;
        if (!target) return;

        observer = new MutationObserver(() => {
            const nameEl = document.querySelector('[data-testid="profile-header-username"], .profile-header-username, h1');
            if (nameEl) handleProfileName(nameEl);
        });

        observer.observe(target, { childList: true, subtree: true });
    }

    function checkUrlAndUpdate() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastProfileName = null; // reset so we re-handle
            setTimeout(() => {
                observeProfileHeader();
                const nameEl = document.querySelector('[data-testid="profile-header-username"], .profile-header-username, h1');
                if (nameEl) handleProfileName(nameEl);
            }, 100); // slight delay for DOM update
        }
    }

    // fetch the specialist list, then start observers
    fetch(SPECIALIST_URL)
        .then(r => r.json())
        .then(data => {
            specialistList = (data || [])
                .map(row => (row.name || '').trim().toLowerCase())
                .filter(Boolean);
            observeProfileHeader();
            // Also run once in case the profile is already loaded
            const nameEl = document.querySelector('[data-testid="profile-header-username"], .profile-header-username, h1');
            if (nameEl) handleProfileName(nameEl);
            // Watch for URL changes (SPA navigation)
            setInterval(checkUrlAndUpdate, 300);
        })
        .catch(() => {
            // fallback: no staff badge if fetch fails
        });
})();
