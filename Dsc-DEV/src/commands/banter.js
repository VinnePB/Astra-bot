// --- BANTER ---
// Silly, rule-based chit-chat. No AI, no LLM, no model: a handful of patterns
// and pre-written lines, so it costs nothing and works even when the smart
// replies (commands/ai.js) are off.
//
// What she joins in on (say her name or @mention her):
//   "guess what?"  -> "what?" ... and your NEXT message gets "chicken butt."
//   "knock knock"  -> "who's there?" -> "<you> who?" -> a verdict on your joke
//   "tell me a joke", "flip a coin", "roll a d20", "rate me",
//   "predict ...", "what's my fortune", "good bot" / "bad bot"
//
// The two back-and-forth bits keep a tiny in-memory state per channel+person
// (90 seconds, lost on restart, nothing stored). It follows the same switch as
// the other silly replies: /config mention-replies (guild_settings.mention_replies_enabled).

const db = require('../database');

const NAME_REGEX = /\bastra\b/i;
const CHANNEL_COOLDOWN_MS = 4000;
const PENDING_TTL_MS = 90 * 1000;
const MAX_WORDS = 8; // longer than this is a real sentence, not banter

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Lowercase, no accents, no mentions, her name removed, punctuation gone.
function clean(content) {
    return strip(content.toLowerCase())
        .replace(/<[@#&!]+\d+>/g, ' ')
        .replace(/\bastra\b/g, ' ')
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// A word or two of what someone said, safe to repeat back: no mentions, no markdown.
function safeEcho(content) {
    return content
        .replace(/<[@#&!]*\d+>/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[@#<>*_~`|\\\[\]()]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30);
}

const LINES = {
    en: {
        guess: ['what?', 'what? 👀', 'okay, what?'],
        guessEnd: ['chicken butt. 🐔', 'chicken butt.', 'chicken butt. you walked right into it. 🐔'],
        knock: ["who's there?", "who's there? 🚪"],
        knockWho: (x) => `${x} who?`,
        knockEnd: [
            "...I don't get it. 4/10, but I respect the commitment.",
            'ha. okay. I laughed internally, which for me is a lot.',
            'that one was terrible. do another.',
            "I'd tell you the punchline was great, but I'm honest. 5/10.",
        ],
        joke: [
            'why do programmers prefer dark mode? because light attracts bugs.',
            "I told my computer I needed a break. it said it'd go to sleep.",
            'there are 10 kinds of people: those who get binary and those who do not.',
            'a SQL query walks into a bar, sees two tables and asks: can I join you?',
            "I'd tell you a UDP joke, but you might not get it.",
            "why was the Discord bot so calm? it had no feelings, only intents.",
            'my code has no bugs. just surprise features.',
            "'it works on my machine.' -- every dev, right before it didn't.",
        ],
        coin: (heads) => (heads ? '🪙 heads.' : '🪙 tails.'),
        dice: (n, sides) => `🎲 d${sides}: **${n}**${n === sides ? ', a perfect roll. I will pretend I did not rig it.' : n === 1 ? '. ouch.' : '.'}`,
        goodBot: ['I know. 😌', 'thank you, I will let it go to my head.', 'good human. keep going.', 'noted. that goes in my permanent record.'],
        badBot: ['rude. I will remember this. (I will not, I have no long-term memory.)', 'ouch. my feelings are made of 1s and 0s, but still.', 'I am going to pretend I did not read that.', 'that was uncalled for. I am filing a complaint with myself.'],
        rate: (n) => `${n}/10. ${n >= 8 ? 'elite.' : n >= 5 ? 'solid, nothing to be ashamed of.' : 'bold of you to ask.'}`,
        ball: [
            'the signs say yes. the signs are me, and I say yes.',
            'my crystal ball says: absolutely not.',
            'ask again later. I am recharging.',
            'it is certain. (it is not certain, but I said it confidently.)',
            'outlook unclear. much like your question.',
            'I see... a lot of snacks in your future.',
            'yes, but only if you believe in yourself. and do your homework.',
            'the stars are aligned, and also on fire. interpret that however you want.',
            'unlikely, but chaos is a ladder.',
            "I predicted this question. the answer is 'maybe'.",
        ],
    },
    pt: {
        guess: ['o quê?', 'o quê? 👀', 'tá, o quê?'],
        guessEnd: ['caiu na pegadinha. 🐔', 'adivinha: você caiu. 🐔', 'nada. só queria ver você perguntar. 🐔'],
        knock: ['quem é?', 'quem é? 🚪'],
        knockWho: (x) => `${x} quem?`,
        knockEnd: [
            '...não entendi. 4/10, mas respeito o esforço.',
            'ha. tá. eu ri por dentro, o que pra mim é muito.',
            'essa foi péssima. faz outra.',
            'eu diria que a piada foi ótima, mas sou honesta. 5/10.',
        ],
        joke: [
            'por que programador prefere o modo escuro? porque a luz atrai bugs.',
            'eu disse pro meu computador que precisava de uma pausa. ele foi dormir.',
            'existem 10 tipos de pessoas: as que entendem binário e as que não.',
            'o código não tem bugs. só funcionalidades surpresa.',
            "'na minha máquina funciona.' -- todo dev, segundos antes de não funcionar.",
            'por que o bot do Discord era tão calmo? não tinha sentimentos, só intents.',
        ],
        coin: (heads) => (heads ? '🪙 cara.' : '🪙 coroa.'),
        dice: (n, sides) => `🎲 d${sides}: **${n}**${n === sides ? ', rolagem perfeita. vou fingir que não viciei.' : n === 1 ? '. ai.' : '.'}`,
        goodBot: ['eu sei. 😌', 'obrigada, vou deixar isso subir à cabeça.', 'bom humano. continua assim.', 'anotado. vai pro meu histórico permanente.'],
        badBot: ['que grosseria. vou lembrar disso. (não vou, não tenho memória de longo prazo.)', 'ai. meus sentimentos são feitos de 1 e 0, mas mesmo assim.', 'vou fingir que não li isso.', 'foi desnecessário. vou abrir uma reclamação comigo mesma.'],
        rate: (n) => `${n}/10. ${n >= 8 ? 'elite.' : n >= 5 ? 'sólido, nada do que se envergonhar.' : 'ousadia sua perguntar.'}`,
        ball: [
            'os sinais dizem que sim. os sinais sou eu, e eu digo que sim.',
            'minha bola de cristal diz: de jeito nenhum.',
            'pergunta de novo mais tarde. estou recarregando.',
            'é certo. (não é certo, mas eu falei com confiança.)',
            'o futuro está nublado. igual à sua pergunta.',
            'vejo... muitos lanches no seu futuro.',
            'sim, mas só se você acreditar em você. e fizer o dever de casa.',
            'os astros estão alinhados, e também pegando fogo. interprete como quiser.',
            'improvável, mas o caos é uma escada.',
            "eu previ essa pergunta. a resposta é 'talvez'.",
        ],
    },
};

// text is already clean(). Returns { kind, locale, ... } or null.
function classify(text) {
    if (!text) return null;
    const words = text.split(' ').length;
    if (words > MAX_WORDS) return null;

    if (/^(guess what|chicken guess what)$/.test(text)) return { kind: 'guess', locale: 'en' };
    if (/^adivinha( o que| so)?$/.test(text)) return { kind: 'guess', locale: 'pt' };
    if (/^knock knock$/.test(text)) return { kind: 'knock', locale: 'en' };
    if (/^toc toc$/.test(text)) return { kind: 'knock', locale: 'pt' };

    if (/\b(joke|jokes)\b/.test(text) && !/\b(not|no)\b/.test(text)) return { kind: 'joke', locale: 'en' };
    if (/\b(piada|piadas)\b/.test(text)) return { kind: 'joke', locale: 'pt' };

    if (/\b(flip a coin|coin flip|heads or tails|toss a coin)\b/.test(text)) return { kind: 'coin', locale: 'en' };
    if (/\b(cara ou coroa|joga uma moeda)\b/.test(text)) return { kind: 'coin', locale: 'pt' };

    let m = text.match(/\broll (?:a |an )?(?:dice|die|d(\d{1,3}))\b/);
    if (m) return { kind: 'dice', locale: 'en', sides: Math.min(Math.max(parseInt(m[1] || '6', 10), 2), 1000) };
    m = text.match(/\b(?:rola|joga) (?:um )?(?:dado|d(\d{1,3}))\b/);
    if (m) return { kind: 'dice', locale: 'pt', sides: Math.min(Math.max(parseInt(m[1] || '6', 10), 2), 1000) };

    if (/\b(predict|prediction|fortune|my future|8 ?ball|eight ball|crystal ball|horoscope)\b/.test(text)) return { kind: 'ball', locale: 'en' };
    if (/\b(preve|preveja|previsao|meu futuro|bola de cristal|horoscopo|sorte de hoje)\b/.test(text)) return { kind: 'ball', locale: 'pt' };

    // Her name is required to get here ("good astra", "good bot astra", "astra bad bot").
    if (/^(good|nice|great|best)( bot| girl)?$|^(i )?love you( bot)?$/.test(text)) return { kind: 'goodBot', locale: 'en' };
    if (/^(bom|boa|otimo|otima)( bot| garota)?$|^eu te amo$/.test(text)) return { kind: 'goodBot', locale: 'pt' };
    if (/^(bad|stupid|dumb|trash|useless)( bot)?$|\bi hate you\b|\byou suck\b|\byou (are|re) (dumb|stupid|useless|trash)\b/.test(text)) return { kind: 'badBot', locale: 'en' };
    if (/^(bot )?(burra|idiota|lixo|inutil)$|\bvoce e (burra|idiota|inutil)\b|\beu te odeio\b/.test(text)) return { kind: 'badBot', locale: 'pt' };

    if (/\brate (me|my|this|that)\b/.test(text)) return { kind: 'rate', locale: 'en' };
    if (/\b(me da uma nota|nota pra mim|nota pra isso|avalia (eu|isso|meu|minha))\b/.test(text)) return { kind: 'rate', locale: 'pt' };

    return null;
}

// ---- tiny conversation state (guess what, knock knock) ----
const pending = new Map(); // `${channelId}:${userId}` -> { kind, step, locale, at }
const lastBanterAt = new Map(); // channelId -> ts

function setPending(message, kind, locale) {
    if (pending.size > 500) {
        const cutoff = Date.now() - PENDING_TTL_MS;
        for (const [k, v] of pending) if (v.at < cutoff) pending.delete(k);
        if (pending.size > 500) pending.clear();
    }
    pending.set(`${message.channel.id}:${message.author.id}`, { kind, step: 1, locale, at: Date.now() });
}

const reply = (message, content) => message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT mention_replies_enabled, language FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

module.exports = {
    classify,
    clean,

    // Returns true when she took part (so the normal replies stay quiet).
    async handleMessage(message) {
        try {
            const key = `${message.channel.id}:${message.author.id}`;

            // 1) Continue a back-and-forth she started with this person.
            const p = pending.get(key);
            if (p) {
                pending.delete(key);
                if (Date.now() - p.at < PENDING_TTL_MS && message.content.length <= 80) {
                    const L = LINES[p.locale];
                    if (p.kind === 'guess') {
                        await reply(message, pick(L.guessEnd));
                        return true;
                    }
                    if (p.kind === 'knock' && p.step === 1) {
                        const echo = safeEcho(message.content);
                        if (echo) {
                            pending.set(key, { kind: 'knock', step: 2, locale: p.locale, at: Date.now() });
                            await reply(message, L.knockWho(echo));
                            return true;
                        }
                    }
                    if (p.kind === 'knock' && p.step === 2) {
                        await reply(message, pick(L.knockEnd));
                        return true;
                    }
                }
                // too long or too late: the bit is over, fall through to normal handling
            }

            // 2) A new bit: needs her name or an @mention.
            const mentioned = message.mentions.has(message.client.user);
            if (!mentioned && !NAME_REGEX.test(message.content)) return false;

            const hit = classify(clean(message.content));
            if (!hit) return false;

            const settings = await getSettings(message.guild.id);
            if (settings && settings.mention_replies_enabled === false) return false;

            const now = Date.now();
            if (now - (lastBanterAt.get(message.channel.id) || 0) < CHANNEL_COOLDOWN_MS) return true; // stay quiet, don't fall through to a second reply
            lastBanterAt.set(message.channel.id, now);

            const L = LINES[hit.locale];
            switch (hit.kind) {
                case 'guess': setPending(message, 'guess', hit.locale); await reply(message, pick(L.guess)); break;
                case 'knock': setPending(message, 'knock', hit.locale); await reply(message, pick(L.knock)); break;
                case 'joke': await reply(message, pick(L.joke)); break;
                case 'coin': await reply(message, L.coin(Math.random() < 0.5)); break;
                case 'dice': await reply(message, L.dice(1 + Math.floor(Math.random() * hit.sides), hit.sides)); break;
                case 'goodBot': await reply(message, pick(L.goodBot)); break;
                case 'badBot': await reply(message, pick(L.badBot)); break;
                case 'rate': await reply(message, L.rate(1 + Math.floor(Math.random() * 10))); break;
                case 'ball': await reply(message, pick(L.ball)); break;
                default: return false;
            }
            return true;
        } catch (err) {
            console.error('❌ Error in banter:', err);
            return false;
        }
    },

    _test: { pending, lastBanterAt, LINES },
};