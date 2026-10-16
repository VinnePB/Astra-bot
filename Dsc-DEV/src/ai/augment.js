// ai/augment.js
// Makes extra TRAINING phrases out of the ones in ai/corpus.js, so people who
// type "vc sabe o q é o daily", "how do u level up" or "como funcioan o rank"
// are still understood. Pure JavaScript with no dependencies, and fully
// deterministic (same corpus -> same extra phrases), so every build trains the
// same model. Used only by ai/train.js; the bot never runs this at runtime.

// Small seeded random generator (mulberry32) so results are repeatable.
function rngFrom(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Whole-word chat shorthand, per language.
const SLANG = {
    pt: [
        [/\bvocê\b/g, 'vc'], [/\bvoce\b/g, 'vc'], [/\bpor que\b/g, 'pq'], [/\bporque\b/g, 'pq'],
        [/\bo que\b/g, 'oq'], [/\bque\b/g, 'q'], [/\bnão\b/g, 'n'], [/\btambém\b/g, 'tb'],
        [/\btudo\b/g, 'td'], [/\bpara\b/g, 'pra'], [/\bobrigado\b/g, 'vlw'], [/\bestá\b/g, 'tá'],
        [/\bestou\b/g, 'tô'], [/\bcomo\b/g, 'cm'], [/\bquando\b/g, 'qnd'], [/\bmuito\b/g, 'mt'],
    ],
    en: [
        [/\byou\b/g, 'u'], [/\byour\b/g, 'ur'], [/\bare\b/g, 'r'], [/\bplease\b/g, 'pls'],
        [/\bthanks\b/g, 'thx'], [/\bwhat is\b/g, 'whats'], [/\bwhat's\b/g, 'whats'], [/\bi am\b/g, 'im'],
        [/\bdo not\b/g, 'dont'], [/\bcan't\b/g, 'cant'], [/\bdon't\b/g, 'dont'], [/\bhow do i\b/g, 'how do i'],
        [/\bto\b/g, '2'], [/\bwant to\b/g, 'wanna'], [/\bgoing to\b/g, 'gonna'],
    ],
};

function slangVariant(text, locale, rng) {
    let out = text;
    let changed = false;
    for (const [re, rep] of SLANG[locale] || []) {
        // each applicable shorthand has a coin flip, so variants differ
        if (re.test(out) && rng() < 0.6) { out = out.replace(re, rep); changed = true; }
        re.lastIndex = 0;
    }
    if (locale === 'pt') {
        const plain = stripAccents(out);
        if (plain !== out) { out = plain; changed = true; }
    }
    return changed ? out : null;
}

// Typos on one word of 5+ letters: drop a letter, swap two neighbors, or
// double a letter. Never touches "/commands" or `backticked` words.
function typoVariant(text, rng) {
    const words = text.split(' ');
    const idx = words.map((w, i) => (/^[a-zà-ú]{5,}$/i.test(w) ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return null;
    const i = idx[Math.floor(rng() * idx.length)];
    const w = words[i];
    const pos = 1 + Math.floor(rng() * (w.length - 2)); // never the first or last letter
    const kind = Math.floor(rng() * 3);
    let nw;
    if (kind === 0) nw = w.slice(0, pos) + w.slice(pos + 1);
    else if (kind === 1) nw = w.slice(0, pos) + w[pos + 1] + w[pos] + w.slice(pos + 2);
    else nw = w.slice(0, pos) + w[pos] + w.slice(pos);
    if (nw === w) return null;
    words[i] = nw;
    return words.join(' ');
}

// Up to 2 extra phrases per original: one "chat slang / no accents", one typo.
function augmentUtterance(text, locale) {
    if (text.length < 10 || /\//.test(text)) return [];
    const rng = rngFrom(locale + ':' + text);
    const out = [];
    const a = slangVariant(text, locale, rng);
    if (a) out.push(a);
    const b = typoVariant(a && rng() < 0.5 ? a : text, rng);
    if (b) out.push(b);
    return out;
}

// Returns [{ locale, text, intent }] of extra training docs. Skips any phrase
// that already exists as an original (in ANY intent) or was already produced,
// so augmentation can never make two intents fight over the same text.
function augmentCorpus(corpus, locales) {
    const seen = new Set();
    for (const data of Object.values(corpus)) {
        for (const l of locales) for (const u of data.utterances[l] || []) seen.add(`${l}|${u.toLowerCase()}`);
    }
    const extra = [];
    for (const [intent, data] of Object.entries(corpus)) {
        for (const locale of locales) {
            for (const u of data.utterances[locale] || []) {
                for (const v of augmentUtterance(u, locale)) {
                    const key = `${locale}|${v.toLowerCase()}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    extra.push({ locale, text: v, intent });
                }
            }
        }
    }
    return extra;
}

module.exports = { augmentCorpus, augmentUtterance };