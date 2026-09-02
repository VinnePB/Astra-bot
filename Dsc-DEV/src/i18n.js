const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['en', 'pt-br'];
const DEFAULT_LANGUAGE = 'en';

const cache = {};

function loadLocale(lang) {
    if (cache[lang]) return cache[lang];
    const filePath = path.join(__dirname, 'locales', `${lang}.json`);
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        cache[lang] = data;
        return data;
    } catch (err) {
        console.error(`❌ Failed to load locale "${lang}":`, err.message);
        return {};
    }
}

// Normalizes anything that might come in (Discord locale codes, casing,
// undefined) down to one of our two supported keys.
function normalizeLanguage(lang) {
    if (!lang) return DEFAULT_LANGUAGE;
    const lower = lang.toLowerCase();
    if (lower === 'pt-br' || lower === 'pt_br' || lower === 'pt') return 'pt-br';
    return SUPPORTED_LANGUAGES.includes(lower) ? lower : DEFAULT_LANGUAGE;
}

// t('pt-br', 'verify.welcome', { user: '<@123>' }) -> interpolated string.
// Falls back to English, then to the raw key itself, so a missing
// translation never crashes a reply — it just shows in English instead.
function t(lang, key, vars = {}) {
    const normalized = normalizeLanguage(lang);
    const locale = loadLocale(normalized);
    let template = locale[key];

    if (template === undefined && normalized !== DEFAULT_LANGUAGE) {
        template = loadLocale(DEFAULT_LANGUAGE)[key];
    }
    if (template === undefined) return key;

    return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? vars[name] : `{${name}}`));
}

module.exports = { t, normalizeLanguage, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };