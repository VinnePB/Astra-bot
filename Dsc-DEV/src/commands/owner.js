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
//   owner leave here / owner block here [reason]   typed in a server channel: she leaves
//                                      (the message is deleted at once; only you are listened to)
//
// The same actions are on the owner page of the website (see index.js).

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

// ---- the actions themselves: shared by the DM commands, the "here" shortcut in
// a server and the owner page on the website, so all three always behave the same.
const guildRows = (client) => [...client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount)
    .map((g) => ({ id: g.id, name: g.name, members: g.memberCount, ownerId: g.ownerId, joinedAt: g.joinedTimestamp || null }));

async function serverInfo(client, id) {
    const g = client.guilds.cache.get(id);
    const count = async (sql) => (await db.query(sql, [id])).rows[0].n;
    const [cases, tickets, levelRows, blocked] = await Promise.all([
        count('SELECT COUNT(*)::int AS n FROM mod_cases WHERE guild_id = $1'),
        count('SELECT COUNT(*)::int AS n FROM tickets WHERE guild_id = $1'),
        count('SELECT COUNT(*)::int AS n FROM user_levels WHERE guild_id = $1'),
        isBlocked(id),
    ]);
    return {
        id, inGuild: !!g, name: g ? g.name : null, members: g ? g.memberCount : null, ownerId: g ? g.ownerId : null,
        joinedAt: g?.joinedTimestamp || null, cases, tickets, levelRows, blocked,
    };
}

async function listBlocked() {
    const { rows } = await db.query('SELECT guild_id, reason, blocked_at FROM blocked_guilds ORDER BY blocked_at DESC LIMIT 100');
    return rows;
}

// Leaves a server (the server owner is told why); with block:true it also refuses to ever join again.
async function removeServer(client, id, { block = false, reason = null, by = 'owner' } = {}) {
    if (!isGuildId(id)) throw new Error('That doesn\'t look like a server ID.');
    reason = clip(reason, 300) || null;
    if (block) {
        await db.query(
            `INSERT INTO blocked_guilds (guild_id, reason) VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET reason = $2, blocked_at = NOW()`,
            [id, reason]
        );
    }
    const g = client.guilds.cache.get(id);
    const name = g ? g.name : null;
    if (g) await leaveWithNotice(g, reason, block ? 'Astra was removed and blocked from your server' : 'Astra was removed from your server');
    alerts.notify(`Owner action: ${block ? 'block' : 'leave'}`, `${name || 'server'} (${id})\nReason: ${reason || '—'}\nVia: ${by}`, { level: 'info', key: `owner-${block ? 'block' : 'leave'}-${id}`, cooldownMs: 0 });
    return { name, wasIn: !!g };
}

async function unblockServer(id) {
    if (!isGuildId(id)) throw new Error('That doesn\'t look like a server ID.');
    const res = await db.query('DELETE FROM blocked_guilds WHERE guild_id = $1', [id]);
    alerts.notify('Owner action: unblock', id, { level: 'info', key: 'owner-unblock-' + id, cooldownMs: 0 });
    return res.rowCount > 0;
}

async function purgeServer(client, id, confirm) {
    if (!isGuildId(id)) throw new Error('That doesn\'t look like a server ID.');
    if (String(confirm || '').trim() !== id) return { ok: false, error: 'The confirmation must match the server ID exactly. Nothing was deleted.' };
    if (client.guilds.cache.has(id)) return { ok: false, error: 'Astra is still in that server. Make her leave first.' };
    await retention.purgeGuild(id);
    alerts.notify('Owner action: purge', `Deleted all stored data for server ${id}.`, { level: 'info', key: 'owner-purge-' + id, cooldownMs: 0 });
    return { ok: true };
}

async function deleteUserData(userId, { moderation = false } = {}) {
    if (!userdata.isUserId(userId)) throw new Error('That doesn\'t look like a user ID.');
    const counts = await userdata.deleteUser(userId, { moderation });
    alerts.notify('Owner action: userdelete', `User ${userId}\n${JSON.stringify(counts)}${moderation ? '\n(moderation cases included)' : ''}`, { level: 'info', key: 'owner-userdelete-' + userId, cooldownMs: 0 });
    return counts;
}

async function exportUserData(userId) {
    if (!userdata.isUserId(userId)) throw new Error('That doesn\'t look like a user ID.');
    const out = await userdata.exportUser(userId);
    return { rows: userdata.countRows(out), json: JSON.stringify({ user_id: userId, exported_at: new Date().toISOString(), data: out }, null, 2) };
}

// Owner typed "owner leave here" / "owner block here [reason]" in a server channel.
// Silent for everyone else: to a stranger it is just an ordinary message.
async function handleGuildMessage(message) {
    if (message.author.bot || !message.guild) return false;
    const m = /^!?owner\s+(leave|block)\s+here(?:\s+([\s\S]*))?$/i.exec(String(message.content || '').trim());
    if (!m) return false;
    if (!(await getOwnerIds(message.client)).includes(message.author.id)) return false;
    const block = m[1].toLowerCase() === 'block';
    const guild = message.guild;
    await message.delete().catch(() => {}); // keep the channel clean: nobody needs to see this
    try {
        await removeServer(message.client, guild.id, { block, reason: (m[2] || '').trim() || null, by: 'server channel' });
        await message.author.send(`✅ ${block ? 'Blocked and left' : 'Left'} **${clip(guild.name, 60)}** (\`${guild.id}\`).${block ? ' She will refuse to join it again.' : ''}`).catch(() => {});
    } catch (e) {
        await message.author.send(`❌ Couldn't do that in **${clip(guild.name, 60)}**: ${clip(e.message, 200)}`).catch(() => {});
    }
    return true;
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
        const list = guildRows(client);
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        const page = Math.min(interaction.options.getInteger('page') || 1, pages);
        const slice = list.slice((page - 1) * PAGE, page * PAGE);
        const lines = slice.map((g) => `**${clip(g.name, 40)}** · \`${g.id}\` · ${g.members} members`);
        const e = new EmbedBuilder().setColor('#22E5FF')
            .setTitle(`Astra is in ${list.length} server(s)`)
            .setDescription(lines.join('\n') || 'None.')
            .setFooter({ text: `Page ${page}/${pages}` });
        return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'server') {
        const info = await serverInfo(client, id);
        const e = new EmbedBuilder().setColor(info.blocked ? '#ED4245' : '#22E5FF')
            .setTitle(info.name || `Server ${id}`)
            .addFields(
                { name: 'In server now', value: info.inGuild ? 'yes' : 'no', inline: true },
                { name: 'Members', value: info.inGuild ? String(info.members) : '—', inline: true },
                { name: 'Server owner', value: info.inGuild ? `\`${info.ownerId}\`` : '—', inline: true },
                { name: 'Added', value: info.joinedAt ? `<t:${Math.floor(info.joinedAt / 1000)}:D>` : '—', inline: true },
                { name: 'Stored data', value: `${info.levelRows} level rows · ${info.tickets} tickets · ${info.cases} mod cases`, inline: false },
                { name: 'Blocked', value: info.blocked ? `yes: ${clip(info.blocked.reason, 200) || 'no reason'}` : 'no', inline: true },
            );
        return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'leave' || sub === 'block') {
        const block = sub === 'block';
        await interaction.deferReply({ ephemeral: true });
        try {
            const out = await removeServer(client, id, { block, reason: interaction.options.getString('reason'), by: 'DM' });
            return interaction.editReply({ content: `✅ ${block ? 'Blocked' : 'Left'} ${out.name ? `**${out.name}**` : `\`${id}\``}${out.wasIn ? '' : ' (she was not in it)'}.${block ? ' Its data will be deleted automatically after 30 days, and she will refuse to rejoin.' : ' Its data will be deleted automatically after 30 days.'}` });
        } catch (err) { return interaction.editReply({ content: `❌ Couldn't ${sub}: ${clip(err.message, 200)}` }); }
    }

    if (sub === 'unblock') {
        return reply((await unblockServer(id)) ? `✅ \`${id}\` is no longer blocked.` : 'That server wasn\'t blocked.');
    }

    if (sub === 'purge') {
        const out = await purgeServer(client, id, interaction.options.getString('confirm'));
        return reply(out.ok ? `✅ All stored data for \`${id}\` was deleted.` : `❌ ${out.error}`);
    }

    if (sub === 'userdata' || sub === 'userdelete') {
        const userId = interaction.options.getString('user_id');
        if (!userdata.isUserId(userId)) return reply('❌ That doesn\'t look like a user ID.');
        if (sub === 'userdata') {
            const out = await exportUserData(userId);
            const file = new AttachmentBuilder(Buffer.from(out.json), { name: `astra-data-${userId}.json` });
            return interaction.reply({ content: `📄 ${out.rows} row(s) stored about \`${userId}\`.`, files: [file], ephemeral: true });
        }
        if (!interaction.options.getBoolean('confirm')) return reply('❌ Write `confirm` after the ID to delete. Nothing was deleted.');
        const includeMod = !!interaction.options.getBoolean('include_moderation');
        const counts = await deleteUserData(userId, { moderation: includeMod });
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

module.exports = {
    execute, handleDm, handleGuildMessage, parseText, enforceBlock, sweepBlocked, isBlocked,
    guildRows, serverInfo, listBlocked, removeServer, unblockServer, purgeServer, deleteUserData, exportUserData,
};