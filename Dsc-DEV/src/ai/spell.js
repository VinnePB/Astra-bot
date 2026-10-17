// ai/spell.js
// A tiny typo fixer for the smart replies. No dependencies, no model, runs in
// well under a millisecond per message.
//
// Why: the classifier is trained on typo variants, but it can never have seen
// every misspelling ("verfy", "levle", "funcioan"). This builds a vocabulary
// from the words already in ai/corpus.js and, when a word in the message is
// unknown but very close to a vocabulary word, swaps it. commands/ai.js (via
// classifier.js) only uses the fixed text as a SECOND chance when the first
// attempt wasn't confident, so it can never make a good match worse.
//
//     node src/ai/test-spell.js        (checks it, needs no node-nlp)

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Command and feature names that must always count as known words.
const EXTRA_VOCAB = ['rank', 'leaderboard', 'balance', 'richest', 'daily', 'artists', 'artist', 'tickets', 'ticket', 'config',
    'quickstart', 'about', 'help', 'verify', 'verified', 'verification', 'panel', 'dashboard', 'level', 'levels', 'economy',
    'commission', 'commissions', 'moderator', 'moderators', 'server'];

// Optimal-string-alignment distance (insert, delete, replace, swap neighbours),
// giving up early once it is certain to be above `max`.
function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const prev2 = new Array(b.length + 1);
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
        [prev, cur] = [cur, prev];
    }
    return prev[b.length];
}

// How many edits a word of this length may be away from a vocabulary word.
const maxEdits = (len) => (len >= 9 ? 2 : 1);
const MIN_LEN = 4; // shorter words are too ambiguous to guess

// corpus: ai/corpus.js. knownExtra: any iterable of plain words that are
// already fine (the language-detection word lists), so real words are not "fixed".
function buildSpeller(corpus, knownExtra = []) {
    const freq = new Map();
    const add = (w) => freq.set(w, (freq.get(w) || 0) + 1);
    for (const entry of Object.values(corpus)) {
        for (const list of Object.values(entry.utterances || {})) {
            for (const u of list) for (const w of strip(u.toLowerCase()).match(/\p{L}+/gu) || []) add(w);
        }
    }
    for (const w of EXTRA_VOCAB) add(w);
    const known = new Set([...freq.keys(), ...[...knownExtra].map((w) => strip(String(w).toLowerCase()))]);
    // Only words long enough, grouped by first letter, are candidates.
    const byFirst = new Map();
    for (const [w, n] of freq) {
        if (w.length < MIN_LEN) continue;
        if (!byFirst.has(w[0])) byFirst.set(w[0], []);
        byFirst.get(w[0]).push([w, n]);
    }

    function fixWord(word) {
        const plain = strip(word.toLowerCase());
        if (plain.length < MIN_LEN || known.has(plain)) return null;
        // "wants", "artistas": plural/inflection of a word we know is a real word.
        if (/(s|es)$/.test(plain) && (known.has(plain.replace(/es$/, '')) || known.has(plain.slice(0, -1)))) return null;
        const limit = maxEdits(plain.length);
        let best = null, bestD = limit + 1, tie = false;
        for (const [cand, n] of byFirst.get(plain[0]) || []) {
            const d = distance(plain, cand, limit);
            if (d > limit) continue;
            if (d < bestD || (d === bestD && n > best.n)) { best = { w: cand, n }; bestD = d; tie = false; }
            else if (d === bestD && n === best.n && cand !== best.w) tie = true;
        }
        return best && !tie ? best.w : null;
    }

    // Returns the text with unknown-but-close words replaced, or null when
    // nothing was changed.
    function fix(text) {
        let changed = false;
        const out = String(text).replace(/\p{L}+/gu, (word) => {
            const f = fixWord(word);
            if (f) { changed = true; return f; }
            return word;
        });
        return changed ? out : null;
    }

    return { fix, fixWord, vocabSize: known.size };
}

module.exports = { buildSpeller, distance };