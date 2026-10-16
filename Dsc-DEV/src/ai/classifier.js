// ai/classifier.js
// The nlp.js part of the smart replies, with NO Discord or database code, so it
// can be used by the bot (commands/ai.js) and by the test script (ai/test.js).
//
// The model is trained offline (ai/train.js -> ai/model.nlp) and only LOADED
// here, once, on first use. Nothing is trained at boot.

const fs = require('fs');
const path = require('path');

const MODEL_PATH = path.join(__dirname, 'model.nlp');
const LOCALES = ['en', 'pt'];
const MIN_SCORE = 0.6; // below this she "doesn't understand"; tune with `npm run test-ai`

let corpus = null;
let manager = null;
let state = 'idle'; // idle | ready | missing | error

function loadModel() {
    if (state !== 'idle') return state === 'ready';
    try {
        if (!fs.existsSync(MODEL_PATH)) {
            state = 'missing';
            console.warn('⚠️ AI smart replies: ai/model.nlp not found (training may have been skipped). Feature stays inactive.');
            return false;
        }
        // Required lazily so a server that never enables the feature never
        // pays the memory cost of loading nlp.js at all.
        const { NlpManager } = require('node-nlp');
        corpus = require('./corpus');
        manager = new NlpManager({ languages: LOCALES, autoSave: false, autoLoad: false, nlu: { log: false } });
        manager.load(MODEL_PATH);
        state = 'ready';
        console.log('🧠 AI smart replies: model loaded.');
        return true;
    } catch (err) {
        state = 'error';
        console.error('❌ AI smart replies: failed to load model:', err);
        return false;
    }
}

// Mentions and her name are noise for classification.
function cleanText(content) {
    return content
        .replace(/<[@#&]!?\d+>/g, ' ')
        .replace(/\bastra\b/gi, ' ')
        .replace(/(\p{L})\1{2,}/gu, '$1$1') // "oiiiiii" -> "oii", "kkkkk" -> "kk"
        .replace(/\s+/g, ' ')
        .trim();
}

// Classify in BOTH languages and keep the more confident one (short messages
// make automatic language guessing unreliable). Returns null when she should
// NOT answer: unsure, or the best match is the "offtopic" class.
async function classify(text) {
    let best = null;
    for (const locale of LOCALES) {
        const r = await manager.process(locale, text);
        if (!r || !r.intent || r.intent === 'None') continue;
        if (!best || r.score > best.score) best = { intent: r.intent, score: r.score, locale };
    }
    if (!best || best.intent === 'offtopic' || best.score < MIN_SCORE) return null;
    return best;
}

// Richer than classify(): says WHY she'd stay quiet, so commands/ai.js can
// answer an unclear QUESTION with a nudge to /help instead of a random line.
//   { status: 'hit', intent, score, locale }
//   { status: 'offtopic', locale }   she recognized it as outside her job
//   { status: 'unsure', locale }     low confidence
async function understand(text) {
    let best = null;
    for (const locale of LOCALES) {
        const r = await manager.process(locale, text);
        if (!r || !r.intent || r.intent === 'None') continue;
        if (!best || r.score > best.score) best = { intent: r.intent, score: r.score, locale };
    }
    if (!best) return { status: 'unsure', locale: null };
    if (best.intent === 'offtopic' && best.score >= MIN_SCORE) return { status: 'offtopic', locale: best.locale };
    if (best.intent === 'offtopic' || best.score < MIN_SCORE) return { status: 'unsure', locale: best.locale };
    return { status: 'hit', ...best };
}

// Same as classify() but returns the raw best match, for the test script.
async function inspect(text) {
    let best = null;
    for (const locale of LOCALES) {
        const r = await manager.process(locale, text);
        if (!r || !r.intent) continue;
        if (!best || r.score > best.score) best = { intent: r.intent, score: r.score, locale };
    }
    return best;
}

module.exports = {
    loadModel,
    cleanText,
    classify,
    understand,
    inspect,
    getCorpus: () => corpus,
    MODEL_PATH,
    MIN_SCORE,
    LOCALES,
};