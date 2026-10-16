// --- EXPERIMENTAL "SMART REPLIES" ---
// A tiny LOCAL intent classifier (nlp.js / node-nlp). No LLM, no API key, no
// cost per message. It does NOT generate text: it matches what someone said
// to one of the intents in ai/corpus.js and answers with a pre-written line
// (filled in with the server's real settings, e.g. its currency name).
//
// Kept deliberately separate from commands/fun.js:
//   - OFF by default per server (guild_settings.ai_enabled), /config ai.
//   - The model is TRAINED OFFLINE (npm run train-ai -> ai/model.nlp) and only
//     LOADED here, once, at first use. Nothing is trained at boot.
//   - If it's off, the model is missing, or she isn't confident (or the
//     question is off-topic), this returns false and index.js lets
//     commands/fun.js reply as usual.

const db = require('../database');
const classifier = require('../ai/classifier');

const REPLY_COOLDOWN_MS = 6000; // one smart reply per channel per this window
const BUSY_COOLDOWN_MS = 20000; // the "busy" line itself is rate-limited separately

const BUSY_EN = [
    "one at a time, I'm busy. 😤",
    "hold on, I'm still answering someone else.",
    "queue up, I only have one brain cell and it's taken.",
    "busy. ask again in a moment.",
];
const BUSY_PT = [
    "um de cada vez, tô ocupada. 😤",
    "espera aí, ainda tô respondendo outra pessoa.",
    "faz fila, eu só tenho um neurônio e ele tá ocupado.",
    "ocupada. pergunta de novo daqui a pouco.",
];

const NAME_REGEX = /\bastra\b/i;

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Pick an answer, avoiding the one used last time for this intent so she
// doesn't repeat herself back to back.
const lastPick = new Map(); // `${intent}:${locale}` -> index
function pickVaried(intent, locale, answers) {
    if (answers.length === 1) return answers[0];
    const key = `${intent}:${locale}`;
    let i;
    do { i = Math.floor(Math.random() * answers.length); } while (i === lastPick.get(key));
    lastPick.set(key, i);
    return answers[i];
}

// Fill {placeholders} with this server's real settings (see ai/corpus.js).
function fillAnswer(text, settings, locale) {
    const pt = locale === 'pt';
    const mention = (id, fallbackEn, fallbackPt) => (id ? `<#${id}>` : (pt ? fallbackPt : fallbackEn));
    const values = {
        currency: settings.currency_name || (pt ? 'moedas' : 'coins'),
        economy_note: settings.economy_enabled
            ? ''
            : (pt ? '(Aviso: a economia está desligada neste servidor agora, um admin precisa ligar.)' : '(Heads up: the economy is off on this server right now, an admin has to turn it on.)'),
        leveling_note: settings.leveling_enabled
            ? ''
            : (pt ? '(Aviso: o sistema de níveis está desligado neste servidor agora, um admin precisa ligar.)' : '(Heads up: leveling is off on this server right now, an admin has to turn it on.)'),
        verify_channel: mention(settings.verify_channel_id, 'the verify channel', 'o canal de verificação'),
        rules_channel: mention(settings.rules_channel_id, 'the rules channel', 'o canal de regras'),
        ticket_channel: mention(settings.ticket_channel_id, 'the ticket channel', 'o canal de tickets'),
    };
    return text
        .replace(/\{(\w+)\}/g, (m, name) => (name in values ? values[name] : m))
        .replace(/ {2,}/g, ' ')
        .trim();
}

// In-memory only (same reasoning as fun.js): resetting on restart is harmless.
const lastReply = new Map(); // channelId -> { at, userId }
const lastBusyAt = new Map(); // channelId -> ts

module.exports = {
    isReady: () => classifier.loadModel(),

    // Returns true if she handled the message (replied OR intentionally stayed
    // quiet), false if index.js should let fun.js handle it.
    async handleMessage(message) {
        try {
            const mentioned = message.mentions.has(message.client.user);
            if (!mentioned && !NAME_REGEX.test(message.content)) return false;

            const { rows } = await db.query(
                `SELECT ai_enabled, language, economy_enabled, leveling_enabled, currency_name,
                        verify_channel_id, rules_channel_id, ticket_channel_id
                 FROM guild_settings WHERE guild_id = $1`,
                [message.guild.id]
            );
            const settings = rows[0];
            if (!settings || settings.ai_enabled !== true) return false;
            if (!classifier.loadModel()) return false;

            const text = classifier.cleanText(message.content);
            if (!text) return false; // a bare ping -> normal fun reply

            const now = Date.now();
            const key = message.channel.id;
            const last = lastReply.get(key);

            // Inside the cooldown window:
            //  - the same person again -> stay quiet (no spam, no "busy" nagging)
            //  - someone else -> say she's busy, but at most once per BUSY_COOLDOWN_MS
            if (last && now - last.at < REPLY_COOLDOWN_MS) {
                if (last.userId !== message.author.id && now - (lastBusyAt.get(key) || 0) >= BUSY_COOLDOWN_MS) {
                    lastBusyAt.set(key, now);
                    const pool = settings.language === 'pt-br' ? BUSY_PT : BUSY_EN;
                    await message.reply({ content: pick(pool), allowedMentions: { repliedUser: false } }).catch(() => {});
                }
                return true;
            }

            const result = await classifier.classify(text);
            if (!result) return false; // unsure or off-topic -> fun.js

            const answers = classifier.getCorpus()[result.intent]?.answers?.[result.locale];
            if (!answers || answers.length === 0) return false;

            lastReply.set(key, { at: now, userId: message.author.id });
            const line = fillAnswer(pickVaried(result.intent, result.locale, answers), settings, result.locale);
            await message.reply({ content: line, allowedMentions: { repliedUser: false } }).catch(() => {});
            return true;
        } catch (err) {
            console.error('❌ Error in AI smart reply:', err);
            return false;
        }
    },
};