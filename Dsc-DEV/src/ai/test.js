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
    ['do you have a real soul inside', 'sentient'],
    ['who built you originally', 'creator'],
    ['I have nothing to do right now', 'bored'],
    ['what is the weather like in tokyo', null],
    ['who won the world cup', null],
    ['purple banana helicopter', null],
    ['what does the rank command show', 'cmd_rank'],
    ['how do I check how many coins I have', 'cmd_balance'],
    ['where can I see the list of commands', 'cmd_help'],
    ['how do I browse the artists', 'cmd_artists'],
    ['how do I configure this bot as an admin', 'admin_setup'],
    ['how do I enable levels on my server', 'admin_toggles'],
    ['what does that command even do', 'command_generic'],
    ['is my chat sent to some ai company', 'ai_info'],
    ['how does the daily thing work', 'daily_info'],
    ['how do I send coins to my friend', 'pay_info'],
    ['do levels give me roles', 'level_roles_info'],
    ['how can I close the ticket I opened', 'close_ticket'],
    ['where are the server rules', 'rules_info'],
    ['why did you remove what I wrote', 'message_deleted'],
    ['do you ever go to sleep at night', 'sleep'],
    ['i had a really bad day', 'sad'],
    // typos and chat slang
    ['hellooo thare', 'greeting'],
    ['how do u level up', 'rank_info'],
    ['wat can u do', 'what_can_you_do'],
    ['how do i verfy', 'verify_info'],
    ['whats the daily thing', 'daily_info'],
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
    ['quero pedir uma ilustração pra alguém', 'tickets_info'],
    ['você é muito legal astra', 'compliment'],
    ['você é o pior bot', 'insult'],
    ['sabe alguma piada boa', 'joke'],
    ['me fala uma coisa estranha', 'random_chaos'],
    ['você tem uma alma de verdade', 'sentient'],
    ['quem programou você', 'creator'],
    ['não tenho nada pra fazer agora', 'bored'],
    ['como está o clima em são paulo', null],
    ['quem ganhou a copa do mundo', null],
    ['banana roxa helicóptero', null],
    ['o que o comando rank mostra', 'cmd_rank'],
    ['como eu vejo quantas moedas eu tenho', 'cmd_balance'],
    ['onde eu vejo a lista de comandos', 'cmd_help'],
    ['como eu consigo olhar os artistas daqui', 'cmd_artists'],
    ['como eu configuro esse bot sendo admin', 'admin_setup'],
    ['como eu ligo os níveis no meu servidor', 'admin_toggles'],
    ['o que aquele comando ali faz mesmo', 'command_generic'],
    ['minha conversa vai pra alguma empresa de ia', 'ai_info'],
    ['como é que funciona o daily', 'daily_info'],
    ['como eu mando moedas pro meu amigo', 'pay_info'],
    ['os níveis me dão cargos', 'level_roles_info'],
    ['como eu fecho meu ticket', 'close_ticket'],
    ['onde ficam as regras do servidor', 'rules_info'],
    ['por que apagaram o que eu escrevi', 'message_deleted'],
    ['você chega a dormir de noite', 'sleep'],
    ['tive um dia muito ruim', 'sad'],
    // erros de digitação e gírias
    ['oiii tudo bem com vc', 'greeting'],
    ['como q eu subo de nivel', 'rank_info'],
    ['oq vc faz', 'what_can_you_do'],
    ['como eu me verifco', 'verify_info'],
    ['oq é o daily', 'daily_info'],
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