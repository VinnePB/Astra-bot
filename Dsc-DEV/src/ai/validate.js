// ai/validate.js
// Sanity checks for ai/corpus.js. Used by train.js (so a typo in the corpus
// stops training with a clear message) and runnable on its own:
//     node src/ai/validate.js     (no node-nlp needed)

const corpus = require('./corpus');

const LOCALES = ['en', 'pt'];
const PLACEHOLDERS = new Set(['currency', 'economy_note', 'leveling_note', 'verify_channel', 'rules_channel', 'ticket_channel']);
const NO_ANSWER_INTENTS = new Set(['offtopic']);

function validateCorpus(data = corpus) {
    const problems = [];
    const seen = new Map(); // utterance (lowercased, per locale) -> intent

    for (const [intent, entry] of Object.entries(data)) {
        for (const locale of LOCALES) {
            const utterances = entry.utterances?.[locale] || [];
            const answers = entry.answers?.[locale] || [];

            if (utterances.length < 8) problems.push(`${intent}/${locale}: only ${utterances.length} utterances (need at least 8)`);
            if (!NO_ANSWER_INTENTS.has(intent) && answers.length === 0) problems.push(`${intent}/${locale}: no answers`);
            if (NO_ANSWER_INTENTS.has(intent) && answers.length > 0) problems.push(`${intent}/${locale}: should have no answers`);

            for (const u of utterances) {
                const key = `${locale}:${u.toLowerCase().trim()}`;
                if (seen.has(key) && seen.get(key) !== intent) {
                    problems.push(`${locale}: "${u}" appears in both "${seen.get(key)}" and "${intent}"`);
                }
                seen.set(key, intent);
            }

            for (const a of answers) {
                if (a.length > 1900) problems.push(`${intent}/${locale}: an answer is over 1900 characters`);
                for (const m of a.matchAll(/\{(\w+)\}/g)) {
                    if (!PLACEHOLDERS.has(m[1])) problems.push(`${intent}/${locale}: unknown placeholder {${m[1]}}`);
                }
            }
        }
    }
    return problems;
}

module.exports = { validateCorpus, LOCALES, PLACEHOLDERS };

if (require.main === module) {
    const problems = validateCorpus();
    if (problems.length) {
        console.error('❌ Corpus problems:\n - ' + problems.join('\n - '));
        process.exit(1);
    }
    console.log(`✅ Corpus OK (${Object.keys(corpus).length} intents)`);
}