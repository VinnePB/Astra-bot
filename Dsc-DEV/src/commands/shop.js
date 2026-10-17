// --- ECONOMY, PART 2: RANDOM EVENTS, SHOP AND GAMBLING ---
// Gives the currency from commands/economy.js something to do.
//
//   RANDOM EVENTS   While people chat, Astra now and then drops a button
//                   message: "Grab it!" (first click wins a random amount) or a
//                   "coin rain" (everyone who clicks in time gets a small random
//                   amount, once each). Off by default (/shopconfig events or the
//                   dashboard). Never fires in a dead server (needs two different
//                   chatters recently) or more often than the configured interval.
//   SHOP            /shop lists, /buy buys.
//                     - cosmetic ROLES that admins add (/shopconfig add-role or the
//                       dashboard). Roles with powerful permissions are refused.
//                     - five built-in dumb items that need no setup: Town crier,
//                       Get roasted, Get hyped, Fake ban, Mystery box.
//   /gamble         Coin flip, slightly stacked against you (a coin sink).
//
// All money changes are single atomic SQL statements (balance = balance + n,
// or balance = balance - n only WHERE balance >= n), so two people clicking or
// buying at the same time can never overdraw or lose an update.

const crypto = require('crypto');
const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const db = require('../database');
const { isAstraAdmin } = require('../permissions');
const { logAction } = require('./config');

// ---------------------------------------------------------------- tuning
const MAX_ROLE_ITEMS = 25;          // also the Discord autocomplete limit
const MAX_PRICE = 1_000_000;
const SHOUT_MAX_CHARS = 120;
const GAMBLE_MAX_BET = 1000;
const GAMBLE_WIN_CHANCE = 0.45;     // pays double, so the house keeps ~10%
const GAMBLE_COOLDOWN_MS = 8000;

const EVENT_CHANCE_PER_MESSAGE = 0.05;   // once the interval has passed
const EVENT_DEFAULT_INTERVAL_MIN = 45;
const EVENT_NEEDS_CHATTERS = 2;          // distinct people in the last window
const EVENT_CHATTER_WINDOW_MS = 10 * 60 * 1000;
const DROP_LIFETIME_MS = 60_000;
const RAIN_LIFETIME_MS = 45_000;

// A role a shop item hands out must not be able to hurt the server.
const DANGEROUS_PERMS = [
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ManageWebhooks',
    'ManageNicknames', 'ManageEvents', 'ManageThreads', 'KickMembers', 'BanMembers', 'ModerateMembers',
    'MentionEveryone', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers',
];

// ----------------------------------------------------------- small helpers
const isPt = (s) => !!s && s.language === 'pt-br';
const L = (s, en, pt) => (isPt(s) ? pt : en);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Weighted random: table of [weight, min, max]
function rollWeighted(table) {
    const total = table.reduce((n, [w]) => n + w, 0);
    let r = Math.random() * total;
    for (const [w, min, max] of table) {
        if (r < w) return randInt(min, max);
        r -= w;
    }
    const last = table[table.length - 1];
    return randInt(last[1], last[2]);
}

const DROP_TABLE = [[60, 25, 60], [30, 61, 150], [9, 151, 400], [1, 401, 600]];
const GOLDEN_TABLE = [[1, 500, 1500]];
const RAIN_TABLE = [[1, 5, 60]];
// Mystery box pays back about 80% on average, so it is a coin sink, not a printer.
const BOX_TABLE = [[20, 0, 0], [35, 20, 60], [25, 61, 110], [13, 111, 200], [6, 201, 400], [1, 401, 1000]];

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => stripAccents(String(s || '').toLowerCase().trim());

function safeName(member, user) {
    const raw = member?.displayName || user?.username || '';
    return raw.replace(/<[@#&!]+\d+>/g, '').replace(/[@#<>*_~`|\\\[\]()]/g, '').trim().slice(0, 32) || 'someone';
}

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

// Settings are read on EVERY chat message (the event roll), so keep a short cache.
const settingsCache = new Map(); // guildId -> { at, data }
const SETTINGS_TTL_MS = 60_000;
async function cachedSettings(guildId) {
    const hit = settingsCache.get(guildId);
    if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.data;
    const data = await getSettings(guildId);
    settingsCache.set(guildId, { at: Date.now(), data });
    return data;
}
const invalidate = (guildId) => settingsCache.delete(guildId);

function sym(s) { return s?.currency_symbol || '🪙'; }
function cur(s) { return s?.currency_name || 'Coins'; }
function money(s, n) { return `${sym(s)} **${Number(n).toLocaleString()}** ${cur(s)}`; }

// ------------------------------------------------------ atomic money moves
async function getBalance(guildId, userId) {
    const { rows } = await db.query('SELECT balance FROM user_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    return rows[0] ? Number(rows[0].balance) : 0;
}

async function addBalance(guildId, userId, amount) {
    const { rows } = await db.query(
        `INSERT INTO user_economy (guild_id, user_id, balance) VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET balance = user_economy.balance + $3
         RETURNING balance`,
        [guildId, userId, amount]
    );
    return Number(rows[0].balance);
}

// Returns the new balance, or null if they can't afford it. Never goes negative.
async function spend(guildId, userId, amount) {
    const { rows } = await db.query(
        `UPDATE user_economy SET balance = balance - $3
         WHERE guild_id = $1 AND user_id = $2 AND balance >= $3
         RETURNING balance`,
        [guildId, userId, amount]
    );
    return rows[0] ? Number(rows[0].balance) : null;
}

// ------------------------------------------------------------ built-in items
const ROASTS = {
    en: [
        '{name}, you have the energy of a loading screen that never finishes.',
        '{name} types like they are being charged per correct letter.',
        '{name}, even my 404 page has more direction than you.',
        'legend says {name} is still looking for the "any" key.',
        '{name} brings the same energy as an unread terms-of-service.',
        '{name}, you are proof that autocorrect has limits.',
        'I would insult {name} further but they would need a second brain cell to notice.',
    ],
    pt: [
        '{name}, você tem a energia de uma tela de carregamento que nunca termina.',
        '{name} digita como se cobrassem por letra certa.',
        '{name}, até a minha página de erro 404 tem mais rumo que você.',
        'dizem que {name} ainda procura a tecla "qualquer".',
        '{name} tem a mesma energia de termos de uso que ninguém leu.',
        '{name}, você é a prova de que o corretor automático tem limites.',
        'eu zoaria {name} mais, mas ele precisaria de um segundo neurônio pra perceber.',
    ],
};
const HYPES = {
    en: [
        'ladies, gentlemen and others: {name}. a true menace to boredom.',
        '{name} walked in and the server\'s average vibe went up by 12%. scientists are baffled.',
        'if {name} were a Discord role they would be permanently pinned above everything.',
        'all rise for {name}, the one person here who could win an argument with a wall.',
        '{name} is the reason the group chat is not a graveyard.',
        'historians will call it "the era of {name}". fondly.',
    ],
    pt: [
        'senhoras, senhores e demais presentes: {name}. uma verdadeira ameaça ao tédio.',
        '{name} entrou e o astral médio do servidor subiu 12%. cientistas estão perplexos.',
        'se {name} fosse um cargo do Discord, ficaria fixado acima de todos.',
        'todos de pé para {name}, a única pessoa aqui capaz de ganhar uma discussão com uma parede.',
        '{name} é o motivo de o chat não ser um cemitério.',
        'historiadores vão chamar de "a era de {name}". com carinho.',
    ],
};
const FAKEBANS = {
    en: [
        '🔨 **{name}** has been BANNED for crimes against fun. (not really. they paid for this.)',
        '🚨 **{name}** was removed from existence by the Ministry of Vibes. (just a bit. it is fake.)',
        '⚖️ **{name}** has been sentenced to 1,000 years of reading the rules. (this is a joke, they are fine.)',
    ],
    pt: [
        '🔨 **{name}** foi BANIDO por crimes contra a diversão. (de mentira. ele pagou por isso.)',
        '🚨 **{name}** foi removido da existência pelo Ministério do Astral. (só um pouquinho. é falso.)',
        '⚖️ **{name}** foi condenado a 1.000 anos lendo as regras. (é piada, ele está bem.)',
    ],
};

const BUILTIN = {
    shout: {
        emoji: '📣', price: 75, needsText: true,
        name: { en: 'Town crier', pt: 'Arauto' },
        desc: { en: `Astra announces your message (up to ${SHOUT_MAX_CHARS} characters) to the channel.`, pt: `A Astra anuncia sua mensagem (até ${SHOUT_MAX_CHARS} caracteres) no canal.` },
    },
    roast: {
        emoji: '🔥', price: 40,
        name: { en: 'Get roasted', pt: 'Ser zoado' },
        desc: { en: 'Astra roasts you in public. Gently. Absurdly.', pt: 'A Astra zoa você em público. Com carinho. Absurdamente.' },
    },
    hype: {
        emoji: '🎉', price: 40,
        name: { en: 'Get hyped', pt: 'Ser exaltado' },
        desc: { en: 'Astra gives you an over-the-top introduction.', pt: 'A Astra faz uma apresentação exagerada de você.' },
    },
    fakeban: {
        emoji: '🔨', price: 60,
        name: { en: 'Fake ban', pt: 'Banimento falso' },
        desc: { en: 'Astra announces your dramatic "ban". Nobody is actually banned.', pt: 'A Astra anuncia seu "banimento" dramático. Ninguém é banido de verdade.' },
    },
    lootbox: {
        emoji: '📦', price: 100,
        name: { en: 'Mystery box', pt: 'Caixa misteriosa' },
        desc: { en: 'Could be nothing, could be a lot. On average it pays a bit less than it costs.', pt: 'Pode ser nada, pode ser muito. Na média paga um pouco menos do que custa.' },
    },
};
const builtinName = (key, s) => (isPt(s) ? BUILTIN[key].name.pt : BUILTIN[key].name.en);

// Is this role safe to sell? Also used by the dashboard route.
function validateShopRole(guild, roleId) {
    const role = guild?.roles?.cache?.get(roleId);
    if (!role || role.id === guild.id) return { ok: false, reason: 'invalid' };
    if (role.managed) return { ok: false, reason: 'managed' };
    if (DANGEROUS_PERMS.some((p) => PermissionFlagsBits[p] !== undefined && role.permissions.has(PermissionFlagsBits[p]))) return { ok: false, reason: 'dangerous' };
    const me = guild.members.me;
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
        return { ok: false, reason: 'hierarchy' };
    }
    return { ok: true, role };
}

const ROLE_REASONS = {
    en: {
        invalid: 'that is not a valid role.',
        managed: 'that role is managed by an integration, so it can\'t be handed out.',
        dangerous: 'that role has powerful permissions (like managing messages, roles or members). Shop roles must be cosmetic.',
        hierarchy: 'I can\'t hand out that role: it is above my own highest role, or I lack Manage Roles. Move my role above it.',
    },
    pt: {
        invalid: 'esse não é um cargo válido.',
        managed: 'esse cargo é gerenciado por uma integração, então não dá pra entregá-lo.',
        dangerous: 'esse cargo tem permissões poderosas (como gerenciar mensagens, cargos ou membros). Cargos da loja precisam ser cosméticos.',
        hierarchy: 'não consigo entregar esse cargo: ele está acima do meu cargo mais alto, ou eu não tenho Gerenciar Cargos. Mova meu cargo para cima dele.',
    },
};

// ---------------------------------------------------------- shop item storage
async function listRoleItems(guildId) {
    const { rows } = await db.query('SELECT id, name, description, price, role_id FROM shop_items WHERE guild_id = $1 ORDER BY price ASC, name ASC', [guildId]);
    return rows;
}

// Shared by /shopconfig add-role and the dashboard. Returns { ok } or { ok:false, error }.
async function addRoleItem(guild, { name, price, roleId, description }) {
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
    const cost = Number(price);
    if (cleanName.length < 2 || cleanName.length > 40) return { ok: false, error: 'name' };
    if (!Number.isInteger(cost) || cost < 1 || cost > MAX_PRICE) return { ok: false, error: 'price' };
    const taken = Object.keys(BUILTIN).some((k) => norm(BUILTIN[k].name.en) === norm(cleanName) || norm(BUILTIN[k].name.pt) === norm(cleanName) || k === norm(cleanName));
    if (taken) return { ok: false, error: 'builtin' };
    const check = validateShopRole(guild, roleId);
    if (!check.ok) return { ok: false, error: check.reason };

    const { rows: count } = await db.query('SELECT COUNT(*)::int AS n FROM shop_items WHERE guild_id = $1 AND name <> $2', [guild.id, cleanName]);
    if (count[0].n >= MAX_ROLE_ITEMS) return { ok: false, error: 'limit' };

    await db.query(
        `INSERT INTO shop_items (guild_id, name, description, price, role_id) VALUES ($1, $2, NULLIF($3, ''), $4, $5)
         ON CONFLICT (guild_id, name) DO UPDATE SET description = NULLIF($3, ''), price = $4, role_id = $5`,
        [guild.id, cleanName, String(description || '').trim().slice(0, 120), cost, roleId]
    );
    return { ok: true, role: check.role, name: cleanName, price: cost };
}

async function removeItemByName(guildId, name) {
    const { rowCount } = await db.query('DELETE FROM shop_items WHERE guild_id = $1 AND lower(name) = lower($2)', [guildId, String(name || '').trim()]);
    return rowCount > 0;
}

const ADD_ERRORS = {
    en: {
        name: 'the name must be 2 to 40 characters.',
        price: `the price must be a whole number from 1 to ${MAX_PRICE.toLocaleString()}.`,
        builtin: 'that name is used by a built-in item. Pick another.',
        limit: `a server can have at most ${MAX_ROLE_ITEMS} role items.`,
    },
    pt: {
        name: 'o nome precisa ter de 2 a 40 caracteres.',
        price: `o preço precisa ser um número inteiro de 1 a ${MAX_PRICE.toLocaleString()}.`,
        builtin: 'esse nome é usado por um item padrão. Escolha outro.',
        limit: `um servidor pode ter no máximo ${MAX_ROLE_ITEMS} itens de cargo.`,
    },
};
function addErrorText(settings, code) {
    const table = isPt(settings) ? ADD_ERRORS.pt : ADD_ERRORS.en;
    const roles = isPt(settings) ? ROLE_REASONS.pt : ROLE_REASONS.en;
    return table[code] || roles[code] || code;
}

// ---------------------------------------------------------------- COMMAND DATA
const shopData = new SlashCommandBuilder()
    .setName('shop')
    .setDescription('See what you can spend your currency on');

const buyData = new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy something from the shop')
    .addStringOption((o) => o.setName('item').setDescription('What to buy (start typing to see the list)').setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Only for the Town crier: what Astra should announce').setMaxLength(SHOUT_MAX_CHARS).setRequired(false));

const gambleData = new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Flip a coin: win double your bet, or lose it (slightly rigged against you)')
    .addIntegerOption((o) => o.setName('amount').setDescription(`How much to bet (1 to ${GAMBLE_MAX_BET})`).setMinValue(1).setMaxValue(GAMBLE_MAX_BET).setRequired(true));

// No setDefaultMemberPermissions: same reason as /config (Astra-authorized roles
// would be hidden by Discord). Access is checked inside the handlers.
const shopConfigData = new SlashCommandBuilder()
    .setName('shopconfig')
    .setDescription('Admins: manage the shop and the random events')
    .addSubcommand((s) => s.setName('add-role').setDescription('Sell a cosmetic role in the shop (or change an existing item)')
        .addStringOption((o) => o.setName('name').setDescription('Item name, e.g. "Neon Pink"').setMinLength(2).setMaxLength(40).setRequired(true))
        .addIntegerOption((o) => o.setName('price').setDescription('Price in the server currency').setMinValue(1).setMaxValue(MAX_PRICE).setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('The role members get (must be cosmetic, below Astra\'s role)').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Optional one-line description').setMaxLength(120).setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take an item out of the shop')
        .addStringOption((o) => o.setName('name').setDescription('Item name').setAutocomplete(true).setRequired(true)))
    .addSubcommand((s) => s.setName('events').setDescription('Random events: coin drops and coin rain while people chat')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn random events on or off (default: off)').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Where events appear (default: wherever people are chatting)').setRequired(false))
        .addIntegerOption((o) => o.setName('interval').setDescription('Minimum minutes between events (10 to 1440, default 45)').setMinValue(10).setMaxValue(1440).setRequired(false)))
    .addSubcommand((s) => s.setName('view').setDescription('Show the shop items and event settings'));

// -------------------------------------------------------------------- /shop
async function executeSlashShop(interaction) {
    const settings = await getSettings(interaction.guild.id);
    if (!settings || !settings.economy_enabled) {
        return interaction.reply({ content: L(settings, '❌ The economy system isn\'t enabled on this server.', '❌ O sistema de economia não está ativado neste servidor.'), ephemeral: true });
    }
    try {
        const items = await listRoleItems(interaction.guild.id);
        const builtIn = Object.entries(BUILTIN).map(([key, b]) =>
            `${b.emoji} **${builtinName(key, settings)}** · ${sym(settings)} ${b.price}\n${isPt(settings) ? b.desc.pt : b.desc.en}`
        ).join('\n\n');
        const embed = new EmbedBuilder()
            .setColor('#22E5FF')
            .setTitle(L(settings, `🛒 ${interaction.guild.name}'s shop`, `🛒 Loja de ${interaction.guild.name}`))
            .setDescription(L(settings, `Spend your ${cur(settings)} with \`/buy\`. Check your balance with \`/balance\`.`, `Gaste seu(s) ${cur(settings)} com \`/buy\`. Veja seu saldo com \`/balance\`.`))
            .addFields({ name: L(settings, '✨ Fun stuff', '✨ Coisas divertidas'), value: builtIn });
        if (items.length) {
            const lines = items.map((i) => `🎭 **${i.name}** · ${sym(settings)} ${Number(i.price).toLocaleString()} → <@&${i.role_id}>${i.description ? `\n${i.description}` : ''}`).join('\n\n');
            embed.addFields({ name: L(settings, '🎨 Cosmetic roles', '🎨 Cargos cosméticos'), value: lines.slice(0, 1024) });
        }
        embed.setFooter({ text: L(settings, 'Also: /gamble to flip a coin. Watch the chat for random coin drops.', 'Também: /gamble pra jogar uma moeda. Fique de olho no chat por moedas aleatórias.') });
        return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
        console.error('❌ Error in /shop:', err);
        return interaction.reply({ content: '❌ Database error.', ephemeral: true });
    }
}

// --------------------------------------------------------------------- /buy
// Works out which item was meant. Autocomplete sends "b:key" or "r:<id>";
// someone who types free text is matched by name instead.
async function resolveItem(guildId, raw, settings) {
    const text = String(raw || '').trim();
    if (text.startsWith('b:') && BUILTIN[text.slice(2)]) return { type: 'builtin', key: text.slice(2) };
    if (text.startsWith('r:')) {
        const { rows } = await db.query('SELECT * FROM shop_items WHERE guild_id = $1 AND id = $2', [guildId, parseInt(text.slice(2), 10) || 0]);
        if (rows[0]) return { type: 'role', item: rows[0] };
    }
    const n = norm(text);
    for (const [key, b] of Object.entries(BUILTIN)) {
        if (key === n || norm(b.name.en) === n || norm(b.name.pt) === n) return { type: 'builtin', key };
    }
    const { rows } = await db.query('SELECT * FROM shop_items WHERE guild_id = $1 AND lower(name) = lower($2)', [guildId, text]);
    if (rows[0]) return { type: 'role', item: rows[0] };
    return null;
}

const gambleLast = new Map(); // `${guild}:${user}` -> ts

async function executeSlashBuy(interaction) {
    const settings = await getSettings(interaction.guild.id);
    if (!settings || !settings.economy_enabled) {
        return interaction.reply({ content: L(settings, '❌ The economy system isn\'t enabled on this server.', '❌ O sistema de economia não está ativado neste servidor.'), ephemeral: true });
    }
    const guild = interaction.guild;
    const userId = interaction.user.id;
    try {
        const found = await resolveItem(guild.id, interaction.options.getString('item'), settings);
        if (!found) {
            return interaction.reply({ content: L(settings, '❌ I couldn\'t find that item. Use `/shop` to see the list.', '❌ Não encontrei esse item. Use `/shop` pra ver a lista.'), ephemeral: true });
        }

        // ---- cosmetic role
        if (found.type === 'role') {
            const item = found.item;
            const member = interaction.member;
            if (member.roles.cache.has(item.role_id)) {
                return interaction.reply({ content: L(settings, `You already own **${item.name}**.`, `Você já tem **${item.name}**.`), ephemeral: true });
            }
            const check = validateShopRole(guild, item.role_id);
            if (!check.ok) {
                return interaction.reply({ content: L(settings, '❌ This item is unavailable right now (an admin needs to fix the role). You were not charged.', '❌ Este item está indisponível agora (um admin precisa arrumar o cargo). Você não foi cobrado.'), ephemeral: true });
            }
            const left = await spend(guild.id, userId, Number(item.price));
            if (left === null) {
                const have = await getBalance(guild.id, userId);
                return interaction.reply({ content: L(settings, `❌ You need ${money(settings, item.price)} but only have ${money(settings, have)}.`, `❌ Você precisa de ${money(settings, item.price)} mas tem só ${money(settings, have)}.`), ephemeral: true });
            }
            try {
                await member.roles.add(item.role_id, 'Bought in the Astra shop');
            } catch (err) {
                await addBalance(guild.id, userId, Number(item.price)); // refund
                console.error('❌ Could not give shop role, refunded:', err.message);
                return interaction.reply({ content: L(settings, '❌ I couldn\'t give you the role, so you were refunded. Tell an admin (my role has to be above it).', '❌ Não consegui te dar o cargo, então você foi reembolsado. Avise um admin (meu cargo precisa estar acima dele).'), ephemeral: true });
            }
            const embed = new EmbedBuilder().setColor('#22E5FF')
                .setDescription(L(settings, `🎭 ${interaction.user} bought **${item.name}** for ${money(settings, item.price)}. Looking good.`, `🎭 ${interaction.user} comprou **${item.name}** por ${money(settings, item.price)}. Ficou bonito.`))
                .setFooter({ text: L(settings, `Balance left: ${left.toLocaleString()}`, `Saldo restante: ${left.toLocaleString()}`) });
            return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        }

        // ---- built-in item
        const key = found.key;
        const b = BUILTIN[key];
        const lang = isPt(settings) ? 'pt' : 'en';
        const name = safeName(interaction.member, interaction.user);
        let text = null;
        if (b.needsText) {
            text = (interaction.options.getString('message') || '').replace(/\s+/g, ' ').trim();
            if (!text) {
                return interaction.reply({ content: L(settings, '❌ Add your announcement in the `message` option.', '❌ Escreva seu anúncio na opção `message`.'), ephemeral: true });
            }
            if (text.length > SHOUT_MAX_CHARS) text = text.slice(0, SHOUT_MAX_CHARS);
            if (/https?:|www\.|discord\.gg|discord\.com\/invite/i.test(text)) {
                return interaction.reply({ content: L(settings, '❌ No links in announcements.', '❌ Sem links nos anúncios.'), ephemeral: true });
            }
            text = text.replace(/[<>@]/g, '').replace(/[*_~`|]/g, '');
            if (!text) return interaction.reply({ content: L(settings, '❌ That message is empty after cleaning it up.', '❌ Essa mensagem ficou vazia depois da limpeza.'), ephemeral: true });
        }

        const left = await spend(guild.id, userId, b.price);
        if (left === null) {
            const have = await getBalance(guild.id, userId);
            return interaction.reply({ content: L(settings, `❌ You need ${money(settings, b.price)} but only have ${money(settings, have)}.`, `❌ Você precisa de ${money(settings, b.price)} mas tem só ${money(settings, have)}.`), ephemeral: true });
        }

        const embed = new EmbedBuilder().setColor('#22E5FF');
        let payout = 0;
        if (key === 'shout') {
            embed.setTitle(L(settings, `📣 ${name} has an announcement`, `📣 ${name} tem um anúncio`)).setDescription(`**${text}**`);
        } else if (key === 'roast') {
            embed.setDescription(`🔥 ${pick(ROASTS[lang]).replace(/\{name\}/g, name)}`);
        } else if (key === 'hype') {
            embed.setDescription(`🎉 ${pick(HYPES[lang]).replace(/\{name\}/g, name)}`);
        } else if (key === 'fakeban') {
            embed.setColor('#ED4245').setDescription(pick(FAKEBANS[lang]).replace(/\{name\}/g, name));
        } else if (key === 'lootbox') {
            payout = rollWeighted(BOX_TABLE);
            if (payout > 0) await addBalance(guild.id, userId, payout);
            const verdict = payout === 0
                ? L(settings, 'Empty. The box was just a box.', 'Vazia. A caixa era só uma caixa.')
                : payout > b.price
                    ? L(settings, `Profit! You got ${money(settings, payout)}.`, `Lucro! Você ganhou ${money(settings, payout)}.`)
                    : L(settings, `You got ${money(settings, payout)} back.`, `Você recebeu ${money(settings, payout)} de volta.`);
            embed.setColor(payout > b.price ? '#57F287' : '#FEE75C')
                .setDescription(`📦 **${name}** ${L(settings, 'opened a mystery box...', 'abriu uma caixa misteriosa...')}\n${verdict}`);
        }
        embed.setFooter({ text: L(settings, `${name} paid ${b.price} ${cur(settings)}. Balance: ${(left + payout).toLocaleString()}`, `${name} pagou ${b.price} ${cur(settings)}. Saldo: ${(left + payout).toLocaleString()}`) });

        try {
            await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        } catch (err) {
            // Could not post it: give the money back (and take back any box winnings).
            await addBalance(guild.id, userId, b.price - payout);
            console.error('❌ Could not post shop item, refunded:', err.message);
        }
    } catch (err) {
        console.error('❌ Error in /buy:', err);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: '❌ Database error. If you were charged, tell an admin.', ephemeral: true }).catch(() => {});
        }
    }
}

// ------------------------------------------------------------------ /gamble
async function executeSlashGamble(interaction) {
    const settings = await getSettings(interaction.guild.id);
    if (!settings || !settings.economy_enabled) {
        return interaction.reply({ content: L(settings, '❌ The economy system isn\'t enabled on this server.', '❌ O sistema de economia não está ativado neste servidor.'), ephemeral: true });
    }
    const bet = interaction.options.getInteger('amount');
    const key = `${interaction.guild.id}:${interaction.user.id}`;
    const now = Date.now();
    if (now - (gambleLast.get(key) || 0) < GAMBLE_COOLDOWN_MS) {
        return interaction.reply({ content: L(settings, '⏱️ Slow down, the coin is still in the air.', '⏱️ Calma, a moeda ainda está no ar.'), ephemeral: true });
    }
    gambleLast.set(key, now);
    try {
        const left = await spend(interaction.guild.id, interaction.user.id, bet);
        if (left === null) {
            const have = await getBalance(interaction.guild.id, interaction.user.id);
            return interaction.reply({ content: L(settings, `❌ You only have ${money(settings, have)}.`, `❌ Você tem só ${money(settings, have)}.`), ephemeral: true });
        }
        const won = Math.random() < GAMBLE_WIN_CHANCE;
        const balance = won ? await addBalance(interaction.guild.id, interaction.user.id, bet * 2) : left;
        const embed = new EmbedBuilder()
            .setColor(won ? '#57F287' : '#ED4245')
            .setDescription(won
                ? L(settings, `🪙 Heads! You bet ${money(settings, bet)} and won ${money(settings, bet * 2)}.`, `🪙 Cara! Você apostou ${money(settings, bet)} e ganhou ${money(settings, bet * 2)}.`)
                : L(settings, `🪙 Tails. ${money(settings, bet)} gone. The coin thanks you.`, `🪙 Coroa. ${money(settings, bet)} perdidos. A moeda agradece.`))
            .setFooter({ text: L(settings, `Balance: ${balance.toLocaleString()}`, `Saldo: ${balance.toLocaleString()}`) });
        return interaction.reply({ embeds: [embed] });
    } catch (err) {
        console.error('❌ Error in /gamble:', err);
        return interaction.reply({ content: '❌ Database error.', ephemeral: true }).catch(() => {});
    }
}

// ---------------------------------------------------------------- /shopconfig
async function executeSlashShopConfig(interaction) {
    const settings = await getSettings(interaction.guild.id);
    if (!(await isAstraAdmin(interaction.member))) {
        return interaction.reply({ content: L(settings, '❌ You need Administrator permission or an Astra-authorized role to do this.', '❌ Você precisa da permissão de Administrador ou de um cargo autorizado pela Astra.'), ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    try {
        if (sub === 'add-role') {
            const role = interaction.options.getRole('role');
            const result = await addRoleItem(guild, {
                name: interaction.options.getString('name'),
                price: interaction.options.getInteger('price'),
                roleId: role.id,
                description: interaction.options.getString('description') || '',
            });
            if (!result.ok) return interaction.reply({ content: `❌ ${addErrorText(settings, result.error)}`, ephemeral: true });
            await logAction(guild, `🛒 ${interaction.user} added shop item **${result.name}** (${result.price} ${cur(settings)}) → ${role.name}.`);
            return interaction.reply({ content: L(settings, `✅ **${result.name}** is now in the shop for ${money(settings, result.price)}, giving @${role.name}.${settings?.economy_enabled ? '' : ' (The economy is off right now, turn it on with `/config economy`.)'}`, `✅ **${result.name}** agora está na loja por ${money(settings, result.price)}, dando @${role.name}.${settings?.economy_enabled ? '' : ' (A economia está desligada agora, ligue com `/config economy`.)'}`), ephemeral: true, allowedMentions: { parse: [] } });
        }

        if (sub === 'remove') {
            const name = interaction.options.getString('name');
            const done = await removeItemByName(guild.id, name);
            if (!done) return interaction.reply({ content: L(settings, '❌ No role item with that name. `/shopconfig view` lists them.', '❌ Nenhum item de cargo com esse nome. `/shopconfig view` lista todos.'), ephemeral: true });
            await logAction(guild, `🛒 ${interaction.user} removed shop item **${name}**.`);
            return interaction.reply({ content: L(settings, `✅ Removed **${name}** from the shop. Members keep roles they already bought.`, `✅ **${name}** removido da loja. Quem já comprou continua com o cargo.`), ephemeral: true });
        }

        if (sub === 'events') {
            const enabled = interaction.options.getBoolean('enabled');
            const channel = interaction.options.getChannel('channel');
            const interval = interaction.options.getInteger('interval');
            await db.query(
                `INSERT INTO guild_settings (guild_id, events_enabled, events_channel_id, events_interval_min)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guild_id) DO UPDATE SET
                    events_enabled = $2,
                    events_channel_id = COALESCE($3, guild_settings.events_channel_id),
                    events_interval_min = COALESCE($4, guild_settings.events_interval_min)`,
                [guild.id, enabled, channel ? channel.id : null, interval || null]
            );
            invalidate(guild.id);
            await logAction(guild, `🎲 ${interaction.user} turned random events ${enabled ? 'on' : 'off'}.`);
            const note = enabled && !settings?.economy_enabled
                ? L(settings, '\n⚠️ The economy is off, so events won\'t happen until you turn it on (`/config economy`).', '\n⚠️ A economia está desligada, então os eventos não acontecem até você ligá-la (`/config economy`).')
                : '';
            return interaction.reply({ content: (enabled
                ? L(settings, `✅ Random events are **on**. At most one every ${interval || settings?.events_interval_min || EVENT_DEFAULT_INTERVAL_MIN} minutes, while people are chatting${channel ? ` in ${channel}` : ''}.`, `✅ Eventos aleatórios **ligados**. No máximo um a cada ${interval || settings?.events_interval_min || EVENT_DEFAULT_INTERVAL_MIN} minutos, enquanto o pessoal conversa${channel ? ` em ${channel}` : ''}.`)
                : L(settings, '✅ Random events are **off**.', '✅ Eventos aleatórios **desligados**.')) + note, ephemeral: true });
        }

        if (sub === 'view') {
            const items = await listRoleItems(guild.id);
            const ev = settings?.events_enabled
                ? L(settings, `on, every ≥ ${settings.events_interval_min || EVENT_DEFAULT_INTERVAL_MIN} min${settings.events_channel_id ? `, in <#${settings.events_channel_id}>` : ', where people chat'}`, `ligados, a cada ≥ ${settings.events_interval_min || EVENT_DEFAULT_INTERVAL_MIN} min${settings.events_channel_id ? `, em <#${settings.events_channel_id}>` : ', onde o pessoal conversa'}`)
                : L(settings, 'off', 'desligados');
            const lines = items.length
                ? items.map((i) => `• **${i.name}** · ${Number(i.price).toLocaleString()} → <@&${i.role_id}>`).join('\n')
                : L(settings, 'No role items yet. Add one with `/shopconfig add-role`.', 'Nenhum item de cargo ainda. Adicione com `/shopconfig add-role`.');
            return interaction.reply({ content: L(settings, `**Events:** ${ev}\n**Role items (${items.length}/${MAX_ROLE_ITEMS}):**\n${lines}`, `**Eventos:** ${ev}\n**Itens de cargo (${items.length}/${MAX_ROLE_ITEMS}):**\n${lines}`), ephemeral: true, allowedMentions: { parse: [] } });
        }
    } catch (err) {
        console.error('❌ Error in /shopconfig:', err);
        return interaction.reply({ content: '❌ Database error.', ephemeral: true }).catch(() => {});
    }
}

// --------------------------------------------------------------- autocomplete
async function handleAutocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused(true);
        const q = norm(focused.value);
        const settings = await cachedSettings(interaction.guild.id);
        let choices = [];
        if (interaction.commandName === 'buy' && focused.name === 'item') {
            const items = await listRoleItems(interaction.guild.id);
            choices = [
                ...Object.entries(BUILTIN).map(([key, b]) => ({ name: `${b.emoji} ${builtinName(key, settings)} (${b.price})`, value: `b:${key}`, search: norm(builtinName(key, settings)) })),
                ...items.map((i) => ({ name: `🎭 ${i.name} (${Number(i.price).toLocaleString()})`, value: `r:${i.id}`, search: norm(i.name) })),
            ];
        } else if (interaction.commandName === 'shopconfig' && focused.name === 'name') {
            const items = await listRoleItems(interaction.guild.id);
            choices = items.map((i) => ({ name: i.name, value: i.name, search: norm(i.name) }));
        }
        const out = choices.filter((c) => !q || c.search.includes(q)).slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) }));
        await interaction.respond(out);
    } catch (err) {
        console.error('❌ Error in autocomplete:', err.message);
        await interaction.respond([]).catch(() => {});
    }
}

// ------------------------------------------------------------- RANDOM EVENTS
const BOOT_AT = Date.now();
const lastEventAt = new Map();   // guildId -> ts
const recentChatters = new Map(); // guildId -> Map(userId -> ts)
const activeEvents = new Map();  // id -> event state

const DROP_FLAVOR = {
    en: ['👜 A coin pouch just fell out of the sky!', '🐦 A pigeon dropped something shiny!', '🕳️ A hole opened in the floor and coins came out.', '🧙 A wizard sneezed and money happened.', '🦝 A raccoon left a bag behind. Finders keepers!'],
    pt: ['👜 Uma bolsa de moedas acabou de cair do céu!', '🐦 Um pombo largou algo brilhante!', '🕳️ Um buraco abriu no chão e saíram moedas.', '🧙 Um mago espirrou e apareceu dinheiro.', '🦝 Um guaxinim deixou uma sacola. Achado não é roubado!'],
};
const RAIN_FLAVOR = {
    en: ['🌧️ It\'s raining money! Everyone gets a turn.', '🎰 The vault sprang a leak. Grab a handful!', '🎈 A coin piñata burst open!'],
    pt: ['🌧️ Está chovendo dinheiro! Todo mundo pega um pouco.', '🎰 O cofre vazou. Pegue um punhado!', '🎈 Uma piñata de moedas estourou!'],
};

function noteChatter(guildId, userId) {
    let m = recentChatters.get(guildId);
    if (!m) { m = new Map(); recentChatters.set(guildId, m); }
    const now = Date.now();
    m.set(userId, now);
    if (m.size > 50) for (const [k, ts] of m) if (now - ts > EVENT_CHATTER_WINDOW_MS) m.delete(k);
    let n = 0;
    for (const ts of m.values()) if (now - ts <= EVENT_CHATTER_WINDOW_MS) n++;
    return n;
}

// Called from index.js for every normal chat message. Cheap when events are off.
async function handleMessageEvent(message) {
    try {
        if (!message.guild || message.author.bot) return;
        const s = await cachedSettings(message.guild.id);
        if (!s || !s.economy_enabled || !s.events_enabled) return;

        const chatters = noteChatter(message.guild.id, message.author.id);
        const interval = (s.events_interval_min || EVENT_DEFAULT_INTERVAL_MIN) * 60_000;
        const now = Date.now();
        const last = lastEventAt.get(message.guild.id) ?? (BOOT_AT - interval / 2);
        if (now - last < interval) return;
        if (chatters < EVENT_NEEDS_CHATTERS) return;
        if (Math.random() >= EVENT_CHANCE_PER_MESSAGE) return;

        lastEventAt.set(message.guild.id, now); // claim the slot before any await below
        let channel = message.channel;
        if (s.events_channel_id) {
            const configured = await message.guild.channels.fetch(s.events_channel_id).catch(() => null);
            if (configured) channel = configured;
        }
        const me = message.guild.members.me;
        if (!channel?.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return;

        await spawnEvent(channel, s);
    } catch (err) {
        console.error('❌ Error rolling a random event:', err);
    }
}

async function spawnEvent(channel, s) {
    const lang = isPt(s) ? 'pt' : 'en';
    const id = crypto.randomBytes(5).toString('hex');
    const r = Math.random();
    const type = r < 0.12 ? 'rain' : 'drop';
    const golden = type === 'drop' && Math.random() < 0.03;
    const ev = {
        id, type, golden, guildId: channel.guild.id, s, done: false, winner: null,
        amount: type === 'drop' ? rollWeighted(golden ? GOLDEN_TABLE : DROP_TABLE) : 0,
        claimed: new Set(), total: 0, message: null, timer: null,
    };

    const embed = new EmbedBuilder().setColor(golden ? '#FEE75C' : '#22E5FF');
    if (type === 'drop') {
        embed.setTitle(golden ? L(s, '✨ A GOLDEN pouch appeared!', '✨ Uma bolsa DOURADA apareceu!') : pick(DROP_FLAVOR[lang]))
            .setDescription(L(s, `First to click **Grab it!** wins some ${cur(s)}. You have ${DROP_LIFETIME_MS / 1000} seconds.`, `Quem clicar primeiro em **Pegar!** ganha uns ${cur(s)}. Você tem ${DROP_LIFETIME_MS / 1000} segundos.`));
    } else {
        embed.setTitle(pick(RAIN_FLAVOR[lang]))
            .setDescription(L(s, `Click **Catch some!** once to grab a random amount of ${cur(s)}. ${RAIN_LIFETIME_MS / 1000} seconds, everyone can join.`, `Clique em **Pegar!** uma vez pra levar uma quantia aleatória de ${cur(s)}. ${RAIN_LIFETIME_MS / 1000} segundos, todo mundo pode participar.`));
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`astra_event_${id}`).setStyle(ButtonStyle.Success)
            .setLabel(type === 'drop' ? L(s, 'Grab it!', 'Pegar!') : L(s, 'Catch some!', 'Pegar!'))
            .setEmoji(type === 'drop' ? (golden ? '✨' : '👜') : '🌧️')
    );

    const sent = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch((err) => { console.error('❌ Could not post an event:', err.message); return null; });
    if (!sent) return;
    ev.message = sent;
    activeEvents.set(id, ev);
    ev.timer = setTimeout(() => finishEvent(ev), type === 'drop' ? DROP_LIFETIME_MS : RAIN_LIFETIME_MS);
}

async function finishEvent(ev) {
    if (!activeEvents.has(ev.id)) return;
    activeEvents.delete(ev.id);
    clearTimeout(ev.timer);
    const s = ev.s;
    let embed = null;
    if (ev.type === 'drop' && !ev.winner) {
        embed = new EmbedBuilder().setColor('#747F8D').setDescription(L(s, '💨 Nobody grabbed it. It rolled away.', '💨 Ninguém pegou. Rolou pra longe.'));
    } else if (ev.type === 'rain') {
        embed = new EmbedBuilder().setColor('#747F8D').setDescription(ev.claimed.size
            ? L(s, `🌧️ The rain stopped. **${ev.claimed.size}** ${ev.claimed.size === 1 ? 'person' : 'people'} caught ${money(s, ev.total)} in total.`, `🌧️ A chuva passou. **${ev.claimed.size}** ${ev.claimed.size === 1 ? 'pessoa pegou' : 'pessoas pegaram'} ${money(s, ev.total)} no total.`)
            : L(s, '🌧️ The rain stopped. Nobody came out. Sad.', '🌧️ A chuva passou. Ninguém apareceu. Triste.'));
    }
    if (embed && ev.message) await ev.message.edit({ embeds: [embed], components: [] }).catch(() => {});
}

async function handleEventButton(interaction) {
    const id = interaction.customId.replace('astra_event_', '');
    const ev = activeEvents.get(id);
    if (!ev || ev.guildId !== interaction.guild.id) {
        return interaction.reply({ content: '⌛ This one already ended.', ephemeral: true }).catch(() => {});
    }
    const s = ev.s;
    const userId = interaction.user.id;
    try {
        if (ev.type === 'drop') {
            if (ev.done) return interaction.reply({ content: L(s, '😔 Too late, someone was faster.', '😔 Tarde demais, alguém foi mais rápido.'), ephemeral: true });
            ev.done = true; // set before any await: only ONE click can win
            let balance;
            try {
                balance = await addBalance(ev.guildId, userId, ev.amount);
            } catch (err) {
                ev.done = false; // let someone else try
                console.error('❌ Could not pay an event winner:', err);
                return interaction.reply({ content: '❌ Database error, try again.', ephemeral: true }).catch(() => {});
            }
            ev.winner = userId;
            clearTimeout(ev.timer);
            activeEvents.delete(ev.id);
            const embed = new EmbedBuilder().setColor(ev.golden ? '#FEE75C' : '#57F287')
                .setDescription(L(s, `🎉 ${interaction.user} grabbed it and got ${money(s, ev.amount)}!`, `🎉 ${interaction.user} pegou e levou ${money(s, ev.amount)}!`))
                .setFooter({ text: L(s, `New balance: ${balance.toLocaleString()}`, `Novo saldo: ${balance.toLocaleString()}`) });
            return interaction.update({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
        }

        // rain: one catch per person
        if (ev.claimed.has(userId)) return interaction.reply({ content: L(s, 'You already caught yours. Greedy.', 'Você já pegou a sua. Ganancioso.'), ephemeral: true });
        ev.claimed.add(userId); // before any await
        const amount = rollWeighted(RAIN_TABLE);
        try {
            await addBalance(ev.guildId, userId, amount);
        } catch (err) {
            ev.claimed.delete(userId);
            console.error('❌ Could not pay a rain catch:', err);
            return interaction.reply({ content: '❌ Database error, try again.', ephemeral: true }).catch(() => {});
        }
        ev.total += amount;
        return interaction.reply({ content: L(s, `🌧️ You caught ${money(s, amount)}!`, `🌧️ Você pegou ${money(s, amount)}!`), ephemeral: true });
    } catch (err) {
        console.error('❌ Error in event button:', err);
    }
}

module.exports = {
    shopData, buyData, gambleData, shopConfigData,
    executeSlashShop, executeSlashBuy, executeSlashGamble, executeSlashShopConfig,
    handleAutocomplete, handleMessageEvent, handleEventButton,
    // shared with the dashboard routes in index.js
    listRoleItems, addRoleItem, removeItemByName, validateShopRole, addErrorText, invalidate,
    // exported for tests
    _test: { rollWeighted, BOX_TABLE, DROP_TABLE, RAIN_TABLE, GOLDEN_TABLE, BUILTIN, DANGEROUS_PERMS, GAMBLE_WIN_CHANCE, spend, addBalance, finishEvent, activeEvents },
};