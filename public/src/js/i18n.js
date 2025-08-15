(function() {
    const I18N_STORAGE_KEY = 'lang';
    const DEFAULT_LANG = 'en';
    let currentLang = null;
    let translations = {};

    function detectBrowserLang() {
        try {
            const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
            if (navLang.startsWith('zh')) return 'zh';
            return DEFAULT_LANG;
        } catch (e) {
            return DEFAULT_LANG;
        }
    }

    function getInitialLang() {
        const stored = localStorage.getItem(I18N_STORAGE_KEY);
        return stored || detectBrowserLang();
    }

    function getLocalesBasePath() {
        // Assets are referenced relatively from the HTML files (e.g., public/index.html)
        // Other assets like css/js use paths like "src/..." so locales sit at "locales/..."
        return 'locales/';
    }

    async function loadTranslations(lang) {
        const base = getLocalesBasePath();
        const url = base + lang + '.json';
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed to load ' + url);
            return await res.json();
        } catch (e) {
            if (lang !== DEFAULT_LANG) {
                const fallbackUrl = base + DEFAULT_LANG + '.json';
                const res = await fetch(fallbackUrl, { cache: 'no-store' });
                if (!res.ok) throw new Error('Failed to load fallback ' + fallbackUrl);
                return await res.json();
            }
            throw e;
        }
    }

    function resolveKey(key) {
        const parts = key.split('.');
        let node = translations;
        for (const part of parts) {
            if (!node || typeof node !== 'object') return key;
            node = node[part];
        }
        if (typeof node === 'string') return node;
        return key;
    }

    function translateElement(el) {
        if (!el) return;
        const key = el.getAttribute('data-i18n');
        if (key) {
            const text = resolveKey(key);
            // Prefer textContent to avoid injecting HTML
            el.textContent = text;
        }
        const attrMap = el.getAttribute('data-i18n-attr');
        if (attrMap) {
            // Format: "placeholder:login.email|title:foo.bar"
            attrMap.split('|').forEach(pair => {
                const [attr, attrKey] = pair.split(':').map(s => s && s.trim());
                if (attr && attrKey) {
                    const val = resolveKey(attrKey);
                    try { el.setAttribute(attr, val); } catch (e) {}
                }
            });
        }
    }

    function applyTranslations(root) {
        const scope = root || document;
        const elements = scope.querySelectorAll('[data-i18n], [data-i18n-attr]');
        elements.forEach(translateElement);
    }

    async function setLanguage(lang) {
        currentLang = lang;
        localStorage.setItem(I18N_STORAGE_KEY, lang);
        translations = await loadTranslations(lang);
        applyTranslations(document);
    }

    function createLanguageSwitcher() {
        const container = document.createElement('span');
        container.style.cssText = 'margin-left:8px;';
        const label = document.createElement('label');
        try {
            // Use translated label if available
            label.textContent = (resolveKey('common.language') || 'Language') + ':';
        } catch (e) {
            label.textContent = 'Language:';
        }
        label.style.cssText = 'margin-right:4px; font-size:12px; color:#666;';
        const select = document.createElement('select');
        select.style.cssText = 'font-size:12px; padding:2px;';
        const optEn = document.createElement('option'); optEn.value = 'en'; optEn.textContent = 'EN';
        const optZh = document.createElement('option'); optZh.value = 'zh'; optZh.textContent = '中文';
        select.appendChild(optEn);
        select.appendChild(optZh);
        select.value = currentLang || getInitialLang();
        select.addEventListener('change', async function() { await setLanguage(this.value); });
        container.appendChild(label);
        container.appendChild(select);
        return container;
    }

    async function init() {
        const lang = getInitialLang();
        currentLang = lang;
        translations = await loadTranslations(lang);
        applyTranslations(document);
    }

    window.i18n = {
        get lang() { return currentLang; },
        setLanguage,
        applyTranslations,
        translateElement,
        createLanguageSwitcher
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();


