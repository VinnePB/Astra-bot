// ai/train.js
// Offline trainer for Astra's experimental smart replies. Run it on your own
// computer or in Render's BUILD step, never at bot startup:
//
//     npm run train-ai        (= node src/ai/train.js)
//
// It validates ai/corpus.js, trains a small nlp.js classifier (English +
// Portuguese) and writes ai/model.nlp. The bot only LOADS that file at boot.

const { NlpManager } = require('node-nlp');
const corpus = require('./corpus');
const { validateCorpus, LOCALES } = require('./validate');
const { MODEL_PATH } = require('./classifier');

(async () => {
    const problems = validateCorpus(corpus);
    if (problems.length) {
        console.error('❌ Corpus problems, fix ai/corpus.js first:\n - ' + problems.join('\n - '));
        process.exit(1);
    }

    const manager = new NlpManager({
        languages: LOCALES,
        forceNER: false,
        autoSave: false,
        autoLoad: false,
        nlu: { log: false },
    });

    let docs = 0;
    for (const [intent, data] of Object.entries(corpus)) {
        for (const locale of LOCALES) {
            for (const utterance of data.utterances[locale] || []) {
                manager.addDocument(locale, utterance, intent);
                docs++;
            }
        }
    }

    console.log(`Training on ${docs} utterances across ${Object.keys(corpus).length} intents...`);
    await manager.train();
    manager.save(MODEL_PATH);
    console.log(`✅ Saved ${MODEL_PATH}`);
})().catch((err) => {
    console.error('❌ Training failed:', err);
    process.exit(1);
});