// ai/test-banter.js: checks commands/banter.js with a fake database and fake
// messages. Needs no node-nlp, no Discord and no database:
//     node src/ai/test-banter.js

const path = require('path');
const dbPath = require.resolve(path.join(__dirname, '..', 'database'));
let settings = { mention_replies_enabled: true, language: 'en' };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [settings] }) } };

const banter = require('../commands/banter');
let failed = 0;
const check = (name, ok) => { if (!ok) { failed++; console.log('FAIL', name); } };

// classify()
const c = (t) => banter.classify(banter.clean(t));
check('guess what', c('astra, guess what?')?.kind === 'guess');
check('knock knock', c('Astra knock knock')?.kind === 'knock');
check('joke', c('astra tell me a joke')?.kind === 'joke');
check('piada', c('astra conta uma piada')?.kind === 'joke');
check('coin', c('astra flip a coin')?.kind === 'coin');
check('dice d20', c('astra roll a d20')?.sides === 20);
check('dice default', c('astra roll a dice')?.sides === 6);
check('dado pt', c('astra rola um dado')?.kind === 'dice');
check('predict', c('astra predict my future')?.kind === 'ball');
check('fortune', c('astra whats my fortune')?.kind === 'ball');
check('good bot', c('good bot astra')?.kind === 'goodBot');
check('bad bot', c('astra you suck')?.kind === 'badBot');
check('rate', c('astra rate me')?.kind === 'rate');
check('real question not hijacked', c('astra how do i get xp faster') === null);
check('verify question not hijacked', c('astra how does verification work') === null);
check('long sentence ignored', c('astra I told a joke yesterday and nobody laughed at all today') === null);
check('no joke ignored', c('astra no joke the bot is down') === null);

// fake message + flow
const replies = [];
let nextId = 1;
const client = { user: { id: 'BOT' } };
function msg(content, { user = 'U1', channel = 'C1', mention = false } = {}) {
    return {
        content, author: { id: user, bot: false }, channel: { id: channel }, guild: { id: 'G1' },
        mentions: { has: () => mention }, client,
        reply: async (o) => { replies.push(o.content); return { id: nextId++ }; },
    };
}
const say = async (...a) => { replies.length = 0; const h = await banter.handleMessage(msg(...a)); return { h, r: replies[0] }; };
const reset = () => { banter._test.pending.clear(); banter._test.lastBanterAt.clear(); };

(async () => {
    // guess what -> what? -> chicken butt (second message has no name)
    reset();
    let x = await say('astra, guess what?');
    check('guess: what?', x.h && /what/i.test(x.r));
    banter._test.lastBanterAt.clear();
    x = await say('what');
    check('guess: chicken butt without her name', x.h && /chicken butt/.test(x.r));
    x = await say('what');
    check('guess: state is consumed', !x.h);

    // other person does not trigger the continuation
    reset();
    await say('astra guess what', { user: 'U1' });
    x = await say('hello', { user: 'U2' });
    check('continuation is per person', !x.h);

    // knock knock chain
    reset();
    x = await say('astra knock knock');
    check('knock: who is there', x.h && /who's there/.test(x.r));
    x = await say('Boo <@123> **bold**');
    check('knock: echo is sanitised', x.h && /^Boo bold who\?$/.test(x.r));
    x = await say('Boo who? don\'t cry');
    check('knock: verdict', x.h && x.r.length > 10);

    // pt language by trigger
    reset();
    x = await say('astra adivinha');
    check('pt guess', x.h && /o quê/.test(x.r));
    x = await say('o que');
    check('pt guess end', x.h && /pegadinha|caiu|nada/.test(x.r));

    // cooldown: second trigger within 4s stays quiet but is handled (no double reply)
    reset();
    await say('astra flip a coin');
    x = await say('astra roll a d20');
    check('cooldown handled quietly', x.h === true && x.r === undefined);

    // gating
    reset();
    settings = { mention_replies_enabled: false, language: 'en' };
    x = await say('astra tell me a joke');
    check('respects mention_replies off', !x.h && x.r === undefined);
    settings = { mention_replies_enabled: true, language: 'en' };

    // no name -> no reply
    reset();
    x = await say('tell me a joke');
    check('needs her name', !x.h);
    x = await say('hey tell me a joke', { mention: true });
    check('mention works', x.h && x.r);

    // dice bounds
    reset();
    for (let i = 0; i < 50; i++) {
        banter._test.lastBanterAt.clear();
        const r = (await say('astra roll a d20')).r;
        const n = parseInt(r.match(/\*\*(\d+)\*\*/)[1], 10);
        if (n < 1 || n > 20) { check('dice range', false); break; }
    }

    console.log(failed ? `\n${failed} FAILED` : '\n✅ banter OK');
    process.exit(failed ? 1 : 0);
})();