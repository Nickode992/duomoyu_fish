(function() {
    const I18N_STORAGE_KEY = 'lang';
    const DEFAULT_LANG = 'en';
    let currentLang = null;
    let translations = {};
    let i18nReadyResolve = null;
    const i18nReadyPromise = new Promise((resolve) => { i18nReadyResolve = resolve; });
    let i18nIsReady = false;

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
        // If current page is inside /public, locales live at ./locales/
        // If current page is project root (e.g., /index.html), locales live at ./public/locales/
        try {
            const path = (window.location && window.location.pathname) || '';
            const inPublic = path.includes('/public/') || path.endsWith('/public') || path.startsWith('/public');
            return inPublic ? 'locales/' : 'public/locales/';
        } catch (e) {
            return 'locales/';
        }
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
        if (!i18nIsReady && i18nReadyResolve) {
            i18nIsReady = true;
            try { document.dispatchEvent(new Event('i18n-ready')); } catch (e) {}
            i18nReadyResolve();
            i18nReadyResolve = null;
        }
    }

    function createLanguageSwitcher() {
        const button = document.createElement('button');
        button.style.cssText = 'font-size:12px; padding:2px 6px; border:1px solid #999; background:#f5f5f5; cursor:pointer; border-radius:3px;';
        const refreshText = () => { button.textContent = (currentLang === 'zh') ? 'EN' : '中文'; };
        refreshText();
        button.addEventListener('click', async function() {
            const next = (currentLang === 'zh') ? 'en' : 'zh';
            await setLanguage(next);
            refreshText();
        });
        return button;
    }

    async function init() {
        const lang = getInitialLang();
        currentLang = lang;
        translations = await loadTranslations(lang);
        applyTranslations(document);
        if (!i18nIsReady && i18nReadyResolve) {
            i18nIsReady = true;
            try { document.dispatchEvent(new Event('i18n-ready')); } catch (e) {}
            i18nReadyResolve();
            i18nReadyResolve = null;
        }
    }

    window.i18n = {
        get lang() { return currentLang; },
        t: (key) => resolveKey(key),
        setLanguage,
        applyTranslations,
        translateElement,
        createLanguageSwitcher,
        get isReady() { return i18nIsReady; },
        readyPromise: i18nReadyPromise
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();


