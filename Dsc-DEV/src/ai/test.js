// ai/test.js
// Quick check of what the trained model understands. Run AFTER training:
//
//     npm run test-ai        (= node src/ai/test.js)
//
// Each case is [phrase, expected intent]. `null` means "she should NOT answer"
// (unsure or off-topic, so the normal /config fun lines take over). The phrases
// here are NOT in ai/corpus.js, so this measures real recognition, not memory.
// Add your own failing phrases here, then add similar ones to the corpus.

const { loadModel, cleanText, inspect, MIN_SCORE } = require('./classifier');

const CASES = [
    // English
    ['hello there friend', 'greeting'],
    ['good night everyone', 'farewell'],
    ['thanks so much for that', 'thanks'],
    ['how are you feeling today', 'how_are_you'],
    ['are you a real person', 'who_are_you'],
    ['what are all your commands', 'what_can_you_do'],
    ['how do I make money in this server', 'economy_info'],
    ['how do I get to a higher level', 'rank_info'],
    ['I can\'t see the channels, how do I verify', 'verify_info'],
    ['I want to commission some art', 'tickets_info'],
    ['you are really cool astra', 'compliment'],
    ['you are the worst bot', 'insult'],
    ['got any good jokes', 'joke'],
    ['tell me something weird', 'random_chaos'],
    ['do you have a soul', 'sentient'],
    ['who coded you', 'creator'],
    ['I have nothing to do right now', 'bored'],
    ['what is the weather like in tokyo', null],
    ['who won the world cup', null],
    ['purple banana helicopter', null],
    // Portuguese
    ['oi tudo bem', 'greeting'],
    ['boa noite pessoal', 'farewell'],
    ['muito obrigado pela ajuda', 'thanks'],
    ['como você está hoje', 'how_are_you'],
    ['você é um robô de verdade', 'who_are_you'],
    ['quais são todos os seus comandos', 'what_can_you_do'],
    ['como eu ganho moedas aqui', 'economy_info'],
    ['como eu faço pra subir de nível', 'rank_info'],
    ['não consigo ver os canais, como verifico', 'verify_info'],
    ['quero encomendar uma arte', 'tickets_info'],
    ['você é muito legal astra', 'compliment'],
    ['você é o pior bot', 'insult'],
    ['sabe alguma piada boa', 'joke'],
    ['me fala uma coisa estranha', 'random_chaos'],
    ['você tem alma', 'sentient'],
    ['quem programou você', 'creator'],
    ['não tenho nada pra fazer agora', 'bored'],
    ['como está o clima em são paulo', null],
    ['quem ganhou a copa do mundo', null],
    ['banana roxa helicóptero', null],
];

(async () => {
    if (!loadModel()) {
        console.error('❌ No model loaded. Run `npm run train-ai` first.');
        process.exit(1);
    }

    let pass = 0;
    const fails = [];
    for (const [phrase, expected] of CASES) {
        const r = await inspect(cleanText(phrase));
        const answered = r && r.intent !== 'offtopic' && r.intent !== 'None' && r.score >= MIN_SCORE;
        const got = answered ? r.intent : null;
        const ok = got === expected;
        if (ok) pass++; else fails.push({ phrase, expected, got, raw: r });
        console.log(`${ok ? '✅' : '❌'} ${phrase.padEnd(46)} -> ${String(got).padEnd(16)} (best: ${r ? `${r.intent} ${r.score.toFixed(2)} ${r.locale}` : 'none'})`);
    }

    console.log(`\n${pass}/${CASES.length} correct (${Math.round(100 * pass / CASES.length)}%), MIN_SCORE=${MIN_SCORE}`);
    if (fails.length) {
        console.log('\nMisses (expected -> got):');
        for (const f of fails) console.log(` - "${f.phrase}": ${f.expected} -> ${f.got}`);
        console.log('\nTip: for misses, add similar phrases to the right intent in ai/corpus.js (or to "offtopic" if she answered something she shouldn\'t), then retrain.');
    }
})();