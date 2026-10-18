// --- OWNER TOOLS ---
// There is NO slash command for this. The owner talks to Astra in a direct
// message with plain text, so nobody else can ever see these commands in
// Discord's command picker. Anyone who is not the owner just gets the normal
// "add me / website" reply (see handleDm), and the owner check below still
// runs on every call.
//
//   owner servers [page]               every server Astra is in
//   owner server <id>                  details about one server
//   owner leave <id> [reason]          make Astra leave (the server owner is told why)
//   owner block <id> [reason]          leave AND refuse to ever join again
//   owner unblock <id>
//   owner purge <id> <id again>        delete a server's data now (she must have left)
//   owner userdata <user_id>           export everything stored about one person
//   owner userdelete <user_id> confirm [moderation]
//   owner backup                       send a backup to your DMs right now
//   owner help

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database');
const { getOwnerIds } = require('../botowner');
const alerts = require('../alerts');
const retention = require('../retention');
const backup = require('../backup');
const userdata = require('../userdata');

const PAGE = 15;
const isGuildId = (s) => /^\d{15,25}$/.test(String(s || ''));
const clip = (s, n) => String(s || '').slice(0, n);

async function isOwner(interaction) {
    const ids = await getOwnerIds(interaction.client);
    return ids.includes(interaction.user.id);
}

// ---- plain-text front end (direct messages only)
const USAGE = [
    '**Owner commands** (only you can use these)',
    '`owner servers [page]`',
    '`owner server <id>`',
    '`owner leave <id> [reason]`',
    '`owner block <id> [reason]`',
    '`owner unblock <id>`',
    '`owner purge <id> <id again>`',
    '`owner userdata <user_id>`',
    '`owner userdelete <user_id> confirm [moderation]`',
    '`owner backup`',
].join('\n');

// "owner leave 123 spam server" -> { sub: 'leave', opts: { id: '123', reason: 'spam server' } }
// Returns null when the text is not an owner command at all.
function parseText(content) {
    const text = String(content || '').trim();
    const m = /^!?owner(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i.exec(text);
    if (!m) return null;
    const sub = (m[1] || 'help').toLowerCase();
    const rest = (m[2] || '').trim();
    const words = rest ? rest.split(/\s+/) : [];
    const opts = {};
    switch (sub) {
        case 'servers': if (words[0]) opts.page = parseInt(words[0], 10); break;
        case 'server': case 'unblock': opts.id = words[0]; break;
        case 'leave': case 'block': opts.id = words[0]; opts.reason = words.slice(1).join(' ') || null; break;
        case 'purge': opts.id = words[0]; opts.confirm = words[1] || ''; break;
        case 'userdata': opts.user_id = words[0]; break;
        case 'userdelete':
            opts.user_id = words[0];
            opts.confirm = /^(confirm|yes|true|sim)$/i.test(words[1] || '');
            opts.include_moderation = /^(mod|moderation|moderacao|moderação)$/i.test(words[2] || '');
            break;
        case 'backup': case 'help': break;
        default: return { sub: 'help', opts: {} };
    }
    return { sub, opts };
}

// Lets the slash-style handler below run on a plain message.
function fromMessage(message, { sub, opts }) {
    const send = (o) => {
        const { ephemeral, ...rest } = o || {};
        return message.reply({ ...rest, allowedMentions: { parse: [], repliedUser: false } });
    };
    const i = {
        client: message.client, user: message.author, deferred: false,
        options: {
            getSubcommand: () => sub,
            getString: (n) => (opts[n] === undefined || opts[n] === null || typeof opts[n] === 'boolean' ? null : String(opts[n])),
            getInteger: (n) => (Number.isFinite(opts[n]) ? opts[n] : null),
            getBoolean: (n) => (typeof opts[n] === 'boolean' ? opts[n] : null),
        },
        reply: send,
        deferReply: async () => { i.deferred = true; await message.channel.sendTyping().catch(() => {}); },
        editReply: send,
    };
    return i;
}

const lastStranger = new Map(); // user id -> time of the last "add me" reply
const STRANGER_COOLDOWN_MS = 10 * 60 * 1000;

// Called for every direct message. Runs owner commands for the owner; gives
// everyone else (and the owner's non-commands) a short, harmless answer, and
// never says that owner commands exist.
async function handleDm(message, { strangerReply } = {}) {
    if (message.author.bot) return false;
    const parsed = parseText(message.content);
    const owner = parsed && (await getOwnerIds(message.client)).includes(message.author.id);
    if (owner) {
        if (parsed.sub === 'help') { await message.reply({ content: USAGE, allowedMentions: { parse: [] } }).catch(() => {}); return true; }
        try { await execute(fromMessage(message, parsed)); }
        catch (e) {
            console.error('❌ owner command error:', e);
            await message.reply({ content: `❌ ${clip(e.message, 200)}`, allowedMentions: { parse: [] } }).catch(() => {});
        }
        return true;
    }
    if (parsed === null && (await getOwnerIds(message.client)).includes(message.author.id)) return false; // the owner just chatting
    if (!strangerReply) return false;
    const now = Date.now();
    if (now - (lastStranger.get(message.author.id) || 0) < STRANGER_COOLDOWN_MS) return false;
    if (lastStranger.size > 5000) lastStranger.clear();
    lastStranger.set(message.author.id, now);
    await message.reply(strangerReply).catch(() => {});
    return true;
}

// ---- blocklist helpers (also used from index.js)
async function isBlocked(guildId) {
    const { rows } = await db.query('SELECT reason FROM blocked_guilds WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

async function leaveWithNotice(guild, reason, headline) {
    try {
        const owner = await guild.fetchOwner();
        const e = new EmbedBuilder().setColor('#ED4245').setTitle(headline)
            .setDescription(`**${guild.name}**`)
            .addFields({ name: 'Reason', value: reason || 'Violation of the Terms of Service (projeckt-v.dev/terms).' });
        await owner.send({ embeds: [e] }).catch(() => {});
    } catch (_) { /* owner not reachable: still leave */ }
    await guild.leave();
}

// Called when Astra joins a server: leave at once if it is blocked.
async function enforceBlock(guild) {
    try {
        const hit = await isBlocked(guild.id);
        if (!hit) return false;
        await leaveWithNotice(guild, hit.reason, 'Astra can\'t be added to this server');
        alerts.notify('Blocked server tried to add Astra', `${guild.name} (${guild.id}) was refused.`, { level: 'info', key: 'blocked-join:' + guild.id, cooldownMs: 60 * 60 * 1000 });
        return true;
    } catch (err) {
        console.error('❌ Block enforcement failed:', err.message);
        return false;
    }
}

async function sweepBlocked(client) {
    try {
        const { rows } = await db.query('SELECT guild_id FROM blocked_guilds');
        for (const { guild_id: id } of rows) {
            const g = client.guilds.cache.get(id);
            if (g) await enforceBlock(g);
        }
    } catch (err) {
        console.error('❌ Blocklist sweep failed:', err.message);
    }
}

// ---------------------------------------------------------------- handler
async function execute(interaction) {
    if (!(await isOwner(interaction))) {
        return interaction.reply({ content: '❌ Only the bot owner can use this.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const reply = (content) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
    if (sub === 'help') return reply(USAGE);
    const id = interaction.options.getString('id');
    if (id !== null && !isGuildId(id)) return reply('❌ That doesn\'t look like a server ID.');

    if (sub === 'servers') {
        const list = [...client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount);
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        const page = Math.min(interaction.options.getInteger('page') || 1, pages);
        const slice = list.slice((page - 1) * PAGE, page * PAGE);
        const lines = slice.map((g) => `**${clip(g.name, 40)}** · \`${g.id}\` · ${g.memberCount} members`);
        const e = new EmbedBuilder().setColor('#22E5FF')
            .setTitle(`Astra is in ${list.length} server(s)`)
            .setDescription(lines.join('\n') || 'None.')
            .setFooter({ text: `Page ${page}/${pages}` });
        return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'server') {
        const g = client.guilds.cache.get(id);
        const count = async (sql) => (await db.query(sql, [id])).rows[0].n;
        const [cases, tickets, levelRows, blocked] = await Promise.all([
            count('SELECT COUNT(*)::int AS n FROM mod_cases WHERE guild_id = $1'),
            count('SELECT COUNT(*)::int AS n FROM tickets WHERE guild_id = $1'),
            count('SELECT COUNT(*)::int AS n FROM user_levels WHERE guild_id = $1'),
            isBlocked(id),
        ]);
        const e = new EmbedBuilder().setColor(blocked ? '#ED4245' : '#22E5FF')
            .setTitle(g ? g.name : `Server ${id}`)
            .addFields(
                { name: 'In server now', value: g ? 'yes' : 'no', inline: true },
                { name: 'Members', value: g ? String(g.memberCount) : '—', inline: true },
                { name: 'Server owner', value: g ? `\`${g.ownerId}\`` : '—', inline: true },
                { name: 'Added', value: g?.joinedTimestamp ? `<t:${Math.floor(g.joinedTimestamp / 1000)}:D>` : '—', inline: true },
                { name: 'Stored data', value: `${levelRows} level rows · ${tickets} tickets · ${cases} mod cases`, inline: false },
                { name: 'Blocked', value: blocked ? `yes: ${clip(blocked.reason, 200) || 'no reason'}` : 'no', inline: true },
            );
        return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'leave' || sub === 'block') {
        const reason = clip(interaction.options.getString('reason'), 300) || null;
        if (sub === 'block') {
            await db.query(
                `INSERT INTO blocked_guilds (guild_id, reason) VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET reason = $2, blocked_at = NOW()`,
                [id, reason]
            );
        }
        const g = client.guilds.cache.get(id);
        if (g) {
            await interaction.deferReply({ ephemeral: true });
            try { await leaveWithNotice(g, reason, sub === 'block' ? 'Astra was removed and blocked from your server' : 'Astra was removed from your server'); }
            catch (err) { return interaction.editReply({ content: `❌ Couldn't leave: ${clip(err.message, 200)}` }); }
        }
        alerts.notify(`Owner action: ${sub}`, `${g ? g.name : 'server'} (${id})\nReason: ${reason || '—'}`, { level: 'info', key: `owner-${sub}-${id}`, cooldownMs: 0 });
        const msg = `✅ ${sub === 'block' ? 'Blocked' : 'Left'} ${g ? `**${g.name}**` : `\`${id}\``}${g ? '' : ' (she was not in it)'}.${sub === 'leave' ? ' Its data will be deleted automatically after 30 days.' : ' Its data will be deleted automatically after 30 days, and she will refuse to rejoin.'}`;
        return interaction.deferred ? interaction.editReply({ content: msg }) : reply(msg);
    }

    if (sub === 'unblock') {
        const res = await db.query('DELETE FROM blocked_guilds WHERE guild_id = $1', [id]);
        alerts.notify('Owner action: unblock', id, { level: 'info', key: 'owner-unblock-' + id, cooldownMs: 0 });
        return reply(res.rowCount ? `✅ \`${id}\` is no longer blocked.` : 'That server wasn\'t blocked.');
    }

    if (sub === 'purge') {
        if (interaction.options.getString('confirm').trim() !== id) return reply('❌ The confirmation must match the server ID exactly. Nothing was deleted.');
        if (client.guilds.cache.has(id)) return reply('❌ Astra is still in that server. Use `owner leave` first.');
        await retention.purgeGuild(id);
        alerts.notify('Owner action: purge', `Deleted all stored data for server ${id}.`, { level: 'info', key: 'owner-purge-' + id, cooldownMs: 0 });
        return reply(`✅ All stored data for \`${id}\` was deleted.`);
    }

    if (sub === 'userdata' || sub === 'userdelete') {
        const userId = interaction.options.getString('user_id');
        if (!userdata.isUserId(userId)) return reply('❌ That doesn\'t look like a user ID.');
        if (sub === 'userdata') {
            const out = await userdata.exportUser(userId);
            const file = new AttachmentBuilder(Buffer.from(JSON.stringify({ user_id: userId, exported_at: new Date().toISOString(), data: out }, null, 2)), { name: `astra-data-${userId}.json` });
            return interaction.reply({ content: `📄 ${userdata.countRows(out)} row(s) stored about \`${userId}\`.`, files: [file], ephemeral: true });
        }
        if (!interaction.options.getBoolean('confirm')) return reply('❌ Set `confirm` to true to delete. Nothing was deleted.');
        const includeMod = !!interaction.options.getBoolean('include_moderation');
        const counts = await userdata.deleteUser(userId, { moderation: includeMod });
        alerts.notify('Owner action: userdelete', `User ${userId}\n${JSON.stringify(counts)}${includeMod ? '\n(moderation cases included)' : ''}`, { level: 'info', key: 'owner-userdelete-' + userId, cooldownMs: 0 });
        const lines = Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join('\n');
        return reply(`✅ Deleted data for \`${userId}\`.\n\`\`\`\n${lines}\n\`\`\`${includeMod ? '' : 'Moderation cases were kept.'}`);
    }

    if (sub === 'backup') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const out = await backup.sendBackup(client, { reason: 'manual' });
            return interaction.editReply({ content: out.ok ? `✅ Backup sent to your DMs (${out.rows} rows).` : `❌ Backup not sent (${out.reason}).` });
        } catch (err) {
            return interaction.editReply({ content: `❌ Backup failed: ${clip(err.message, 200)}` });
        }
    }
}

module.exports = { execute, handleDm, parseText, enforceBlock, sweepBlocked, isBlocked };