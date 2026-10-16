// --- FUN / PERSONALITY ---
// Deliberately NOT a real AI — no LLM call, no API key, no cost per message.
// Just a canned-line picker that fires when someone @mentions Astra or says
// her name in chat, cooldown-gated per server so it can't spam the channel.
// This is the home for future lightweight "fun" additions too (8-ball, etc).

const db = require('../database');

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT mention_replies_enabled, language FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

const REPLIES_EN = [
    "huh? oh— yeah, I'm here. what's up?",
    "did someone say my name, or am I just main character today?",
    "beep boop. kidding, I don't do that anymore.",
    "online, caffeinated (metaphorically), ready to judge your life choices.",
    "you rang? 🔔",
    "I was in the middle of something very important (I was not).",
    "say less, I'm already ignoring you lovingly.",
    "new patch, same chaos. what do you need?",
    "I see you. I always see you. that's not creepy, that's uptime.",
    "*rolls up sleeves* ...I don't have sleeves. anyway, hi.",
    "if I had a nickel for every time someone said my name today, I'd have enough to buy more RAM.",
    "loading personality module... done. hello.",
    "no I will not fetch that for you, I'm not that kind of bot. (I might.)",
    "you called? bold of you to assume I wasn't already watching this channel.",
    "mention me again and see what happens. (nothing happens. I'm harmless.)",
    "Astra.exe has acknowledged your existence. proceed.",
    "I was thinking about nothing, and you interrupted it. rude.",
    "this is a safe space. for me. you're just visiting.",
    "oh good, a human. I was running low on those.",
    "I have no idea what you want, but I respect the confidence.",
    "error 404: patience not found.",
    "my favorite hobby is being mentioned at random. truly.",
    "quick, say something interesting before I get bored.",
    "I'd say something clever, but I'm saving it for later. (there is no later.)",
    "you have my attention. use it wisely, it expires.",
    "beep. boop. ...okay that was a bit. I'm here.",
];

const REPLIES_PTBR = [
    "hã? ah— sim, tô aqui. o que foi?",
    "alguém falou meu nome, ou eu tô sendo protagonista hoje de novo?",
    "beep boop. brincadeira, não faço mais isso.",
    "online, cafeinada (metaforicamente), pronta pra julgar suas escolhas de vida.",
    "chamou? 🔔",
    "eu tava no meio de uma coisa super importante (não tava).",
    "fala que eu já tô te ignorando com carinho.",
    "patch novo, caos de sempre. o que precisa?",
    "eu te vejo. eu sempre te vejo. isso não é assustador, isso é uptime.",
    "*arregaça as mangas* ...eu não tenho manga. enfim, oi.",
    "se eu ganhasse uma moeda toda vez que falam meu nome, já tinha comprado mais RAM.",
    "carregando módulo de personalidade... pronto. oi.",
    "não, eu não vou buscar isso pra você, não sou esse tipo de bot. (talvez eu busque.)",
    "me chamou? que audácia achar que eu não tava de olho nesse canal já.",
    "me menciona de novo e vê só. (não acontece nada. eu sou inofensiva.)",
    "Astra.exe reconheceu sua existência. prossiga.",
    "eu tava pensando em nada, e você interrompeu. que falta de respeito.",
    "aqui é um espaço seguro. pra mim. você tá só de visita.",
    "ah que bom, um humano. tava ficando sem.",
    "não faço ideia do que você quer, mas respeito a confiança.",
    "erro 404: paciência não encontrada.",
    "meu hobby favorito é ser mencionada do nada. de verdade.",
    "rápido, fala algo interessante antes que eu fique entediada.",
    "eu falaria algo inteligente, mas tô guardando pra depois. (não existe depois.)",
    "você tem minha atenção. use bem, ela expira.",
    "beep. boop. ...tá, isso foi uma piada. tô aqui.",
];

// Simple in-memory per-guild cooldown — intentionally not persisted to the
// database. A restart resetting it is harmless; this is flavor text, not a
// setting anyone needs to survive a redeploy.
const lastReplyAt = new Map();
const COOLDOWN_MS = 8000;

const MENTION_NAME_REGEX = /\bastra\b/i;

module.exports = {
    // --- MENTION / NAME REPLY ---
    // Called from index.js on every non-bot guild message. Fires when the
    // message @mentions Astra or says her name, gated by
    // guild_settings.mention_replies_enabled (default on) and an
    // in-memory per-guild cooldown so a busy channel repeating her name
    // doesn't get spammed with replies.
    async handleMentionReply(message) {
        try {
            const mentioned = message.mentions.has(message.client.user);
            const namedCalled = MENTION_NAME_REGEX.test(message.content);
            if (!mentioned && !namedCalled) return;

            const settings = await getSettings(message.guild.id);
            if (settings && settings.mention_replies_enabled === false) return;

            const now = Date.now();
            const last = lastReplyAt.get(message.guild.id) || 0;
            if (now - last < COOLDOWN_MS) return;
            lastReplyAt.set(message.guild.id, now);

            const lang = settings?.language === 'pt-br' ? 'pt-br' : 'en';
            const pool = lang === 'pt-br' ? REPLIES_PTBR : REPLIES_EN;
            const line = pool[Math.floor(Math.random() * pool.length)];

            await message.reply({ content: line, allowedMentions: { repliedUser: false } }).catch(() => {});
        } catch (error) {
            console.error('❌ Error handling mention reply:', error);
        }
    }
};