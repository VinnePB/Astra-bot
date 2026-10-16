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

// ---- Language detection -------------------------------------------------
// nlp.js scores a sentence in EVERY language model, and the Portuguese model
// happily gives a high score to English text, so "pick the best score" answered
// English questions in Portuguese. Instead: guess the language from common
// words first, then classify only in that language. If the guess is a tie (very
// short or mixed messages), both models run and the server's own language gets a
// small head start.
const EN_WORDS = new Set(['the','is','are','was','what','whats','how','do','does','did','can','could','you','u','ur','your','yours','i','im','my','to','it','this','that','these','those','where','why','who','when','which','of','in','for','on','with','and','or','not','dont','cant','have','has','get','use','work','works','help','thanks','thx','please','pls','hello','hey','hi','there','joke','jokes','something','anything','night','morning','weather','bored','real','soul','here','about','tell','show','make','want','wanna','need','know','am','be','been','will','would','should','any','some','all','if','so','just','us','we','they','he','she','his','her','its','at','from','by','than','then','too','very','really','good','bad','new','old','much','many','more','most']);
const PT_WORDS = new Set(['o','os','as','um','uma','uns','de','do','da','dos','das','em','no','na','nos','nas','que','q','oq','como','cm','onde','por','pq','porque','quem','qual','quais','quando','eu','voce','vc','tu','meu','minha','meus','minhas','te','se','nao','tb','tambem','e','ta','to','pra','para','com','faz','fazer','funciona','quero','posso','pode','tem','tenho','oi','ola','obrigado','obrigada','vlw','bom','boa','tudo','bem','mais','muito','mt','sao','esta','estou','ser','foi','isso','esse','essa','aqui','ali','la','ai','mim','ele','ela','nosso','nossa','seu','sua','vai','vou','pelo','pela','sobre','ainda','so','ja','sim','algum','alguma','todo','toda','tudo','dia','uso','usar','ver','ganho','ganhar','conta','piada','fala','diz','manda','algo','coisa','dorme','dormir','vcs','mano','cara','brincadeira','entediada','entediado','alma','noite','manha','tarde']);
// Words that exist in both languages tell us nothing.
for (const w of [...EN_WORDS]) if (PT_WORDS.has(w)) { EN_WORDS.delete(w); PT_WORDS.delete(w); }

function detectLocale(text) {
    const lower = String(text || '').toLowerCase();
    const plain = lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const words = plain.match(/[a-z']+/g) || [];
    let en = 0, pt = 0;
    for (const w of words) {
        const k = w.replace(/'/g, '');
        if (EN_WORDS.has(k)) en++;
        if (PT_WORDS.has(k)) pt++;
    }
    pt += (lower.match(/[ãõçáéíóúâêô]/g) || []).length; // accents are a strong Portuguese signal
    if (en > pt) return 'en';
    if (pt > en) return 'pt';
    return null;
}

// Best raw match for a message, honoring the language rules above.
// fallbackLocale: the server's own language ('en' | 'pt'), used on ties.
async function bestMatch(text, fallbackLocale = 'en') {
    const detected = detectLocale(text);
    const locales = detected ? [detected] : LOCALES;
    let best = null;
    for (const locale of locales) {
        const r = await manager.process(locale, text);
        if (!r || !r.intent || r.intent === 'None') continue;
        const score = r.score + (!detected && locale === fallbackLocale ? 0.05 : 0);
        if (!best || score > best.score) best = { intent: r.intent, score, locale };
    }
    return { best, locale: detected || fallbackLocale };
}

// Richer than a plain yes/no, so commands/ai.js can answer an unclear QUESTION
// with a nudge to /help instead of a random line.
//   { status: 'hit', intent, score, locale }
//   { status: 'offtopic', locale }   she recognized it as outside her job
//   { status: 'unsure', locale }     low confidence
async function understand(text, fallbackLocale = 'en') {
    const { best, locale } = await bestMatch(text, fallbackLocale);
    if (!best) return { status: 'unsure', locale };
    if (best.intent === 'offtopic' && best.score >= MIN_SCORE) return { status: 'offtopic', locale: best.locale };
    if (best.intent === 'offtopic' || best.score < MIN_SCORE) return { status: 'unsure', locale: best.locale };
    return { status: 'hit', ...best };
}

// Raw best match, for the test script.
async function inspect(text, fallbackLocale = 'en') {
    return (await bestMatch(text, fallbackLocale)).best;
}

module.exports = {
    loadModel,
    cleanText,
    understand,
    detectLocale,
    inspect,
    getCorpus: () => corpus,
    MODEL_PATH,
    MIN_SCORE,
    LOCALES,
};