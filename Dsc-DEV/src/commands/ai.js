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

// Asked a clear question but she didn't recognize it: point to /help instead
// of a random canned line. "Off-topic" gets its own, playfully honest line.
const CONFUSED_EN = [
    "hm, I didn't get that one. `/help` shows everything I can do, or try asking another way.",
    "that went over my tiny brain. try rephrasing, or check `/help`.",
    "not sure what you mean. I'm good with commands, levels, economy, verification and tickets. `/help` has the full list.",
];
const CONFUSED_PT = [
    "hm, essa eu não entendi. o `/help` mostra tudo que eu faço, ou tente perguntar de outro jeito.",
    "isso passou por cima do meu cérebro pequeno. tente reformular, ou veja o `/help`.",
    "não sei bem o que você quis dizer. eu entendo de comandos, níveis, economia, verificação e tickets. o `/help` tem a lista completa.",
];
const OFFTOPIC_EN = [
    "that's outside my job, I only know this server. `/help` shows what I can do.",
    "no idea, I was trained for this server only. ask me about commands, levels, economy or tickets.",
    "I'd just make something up, and that's worse. I'm only good at this server's stuff, see `/help`.",
];
const OFFTOPIC_PT = [
    "isso foge do meu trabalho, eu só conheço este servidor. o `/help` mostra o que eu faço.",
    "sem ideia, fui treinada só pra este servidor. pergunte de comandos, níveis, economia ou tickets.",
    "eu só ia inventar algo, e isso é pior. eu só sei das coisas deste servidor, veja o `/help`.",
];

// "tell me more" style follow-ups (intent followup_more). She answers from what
// she last said to that same person in that channel.
const FOLLOWUP_NOCONTEXT_EN = [
    "more of what? ask me a whole question, like how levels or the economy work.",
    "I forgot what we were talking about. ask me again in full.",
];
const FOLLOWUP_NOCONTEXT_PT = [
    "mais do quê? me pergunta a frase inteira, tipo como funcionam os níveis ou a economia.",
    "esqueci do que a gente tava falando. me pergunta de novo por inteiro.",
];
const FOLLOWUP_END_EN = [
    "that's everything I know on that one. `/about` has the full guide and `/help` lists every command.",
    "I'm out of material on that. try `/about` for the long version.",
];
const FOLLOWUP_END_PT = [
    "isso é tudo que eu sei sobre isso. o `/about` tem o guia completo e o `/help` lista todos os comandos.",
    "acabou meu material sobre isso. tente o `/about` pra versão longa.",
];
const FOLLOWUP_AGAIN_EN = 'another way to say it: ';
const FOLLOWUP_AGAIN_PT = 'dizendo de outro jeito: ';
const CONTEXT_TTL_MS = 3 * 60 * 1000;

const QUESTION_START = /^(what|how|where|why|when|who|which|can|could|do|does|is|are|will|should|o que|oque|como|onde|por que|porque|pq|quando|quem|qual|quais|posso|pode|tem|existe|d[aá]|e se)\b/i;
function looksLikeQuestion(text) {
    const words = text.trim().split(/\s+/).length;
    return words >= 3 && (/\?\s*$/.test(text) || QUESTION_START.test(text.trim()));
}

// A display name that is safe to drop into a reply: no mentions, no markdown.
function safeName(message) {
    const raw = message.member?.displayName || message.author.username || '';
    return raw.replace(/<[@#&!]+\d+>/g, '').replace(/[@#<>*_~`|\\\[\]()]/g, '').trim().slice(0, 32) || (message.author.username || '').slice(0, 32);
}

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
function siteUrl(pt) {
    try {
        return `<${new URL(process.env.REDIRECT_URI).origin}>`; // <...> stops Discord from adding a link preview
    } catch (e) {
        return pt ? 'o site (veja o `/about`)' : 'the website (see `/about`)';
    }
}

function fillAnswer(text, settings, locale, userName) {
    const pt = locale === 'pt';
    const mention = (id, fallbackEn, fallbackPt) => (id ? `<#${id}>` : (pt ? fallbackPt : fallbackEn));
    const values = {
        site_url: siteUrl(pt),
        user_name: userName || (pt ? 'amigo' : 'friend'),
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
const topicOf = new Map(); // `${channelId}:${userId}` -> { intent, locale, at }

function rememberTopic(message, intent, locale) {
    if (topicOf.size > 500) {
        const cutoff = Date.now() - CONTEXT_TTL_MS;
        for (const [k, v] of topicOf) if (v.at < cutoff) topicOf.delete(k);
        if (topicOf.size > 500) topicOf.clear();
    }
    topicOf.set(`${message.channel.id}:${message.author.id}`, { intent, locale, at: Date.now() });
}

function recentTopic(message) {
    const t = topicOf.get(`${message.channel.id}:${message.author.id}`);
    return t && Date.now() - t.at < CONTEXT_TTL_MS ? t : null;
}

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

            const result = await classifier.understand(text, settings.language === 'pt-br' ? 'pt' : 'en');

            if (result.status !== 'hit') {
                // Not a recognized topic. A real QUESTION still gets an answer
                // (nudge to /help, or a polite "not my job"); chit-chat falls
                // through to the normal fun.js line.
                if (!looksLikeQuestion(text)) return false;
                const pt = (result.locale || (settings.language === 'pt-br' ? 'pt' : 'en')) === 'pt';
                const pool = result.status === 'offtopic' ? (pt ? OFFTOPIC_PT : OFFTOPIC_EN) : (pt ? CONFUSED_PT : CONFUSED_EN);
                lastReply.set(key, { at: now, userId: message.author.id });
                await message.reply({ content: pick(pool), allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }

            const corpus = classifier.getCorpus();

            // "tell me more" / "explain again": answer from the last topic.
            if (result.intent === 'followup_more') {
                const pt = result.locale === 'pt';
                const topic = recentTopic(message);
                const topicAnswers = topic && corpus[topic.intent]?.answers?.[topic.locale];
                lastReply.set(key, { at: now, userId: message.author.id });
                let line;
                if (!topic || !topicAnswers || topicAnswers.length === 0) {
                    line = pick(pt ? FOLLOWUP_NOCONTEXT_PT : FOLLOWUP_NOCONTEXT_EN);
                } else if (topicAnswers.length > 1) {
                    const another = pickVaried(topic.intent, topic.locale, topicAnswers);
                    line = (topic.locale === 'pt' ? FOLLOWUP_AGAIN_PT : FOLLOWUP_AGAIN_EN) +
                        fillAnswer(another, settings, topic.locale, safeName(message));
                } else {
                    line = pick(pt ? FOLLOWUP_END_PT : FOLLOWUP_END_EN);
                }
                await message.reply({ content: line, allowedMentions: { repliedUser: false } }).catch(() => {});
                return true;
            }

            const answers = corpus[result.intent]?.answers?.[result.locale];
            if (!answers || answers.length === 0) return false;

            lastReply.set(key, { at: now, userId: message.author.id });
            rememberTopic(message, result.intent, result.locale);
            const line = fillAnswer(pickVaried(result.intent, result.locale, answers), settings, result.locale, safeName(message));
            await message.reply({ content: line, allowedMentions: { repliedUser: false } }).catch(() => {});
            return true;
        } catch (err) {
            console.error('❌ Error in AI smart reply:', err);
            return false;
        }
    },
};