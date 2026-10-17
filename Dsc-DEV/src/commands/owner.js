// --- OWNER TOOLS ---
// Only the bot owner can use /owner (see botowner.js). Everything is private
// (only you see the replies) and every destructive action is also sent to the
// alerts channel as a record.
//
//   /owner servers [page]              every server Astra is in
//   /owner server <id>                 details about one server
//   /owner leave <id> [reason]         make Astra leave (the server owner is told why)
//   /owner block <id> [reason]         leave AND refuse to ever join again
//   /owner unblock <id>
//   /owner purge <id> <confirm>        delete a server's data now (she must have left)
//   /owner userdata <user_id>          export everything stored about one person
//   /owner userdelete <user_id> <confirm> [include_moderation]
//   /owner backup                      send a backup to your DMs right now
//
// It only exists in direct messages with Astra (not in any server), and it
// refuses anyone who is not the owner regardless.

const {
    SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, InteractionContextType,
} = require('discord.js');
const db = require('../database');
const { getOwnerIds } = require('../botowner');
const alerts = require('../alerts');
const retention = require('../retention');
const backup = require('../backup');
const userdata = require('../userdata');

const PAGE = 15;
const isGuildId = (s) => /^\d{15,25}$/.test(String(s || ''));
const clip = (s, n) => String(s || '').slice(0, n);

const data = new SlashCommandBuilder()
    .setName('owner').setDescription('Bot owner only: manage servers and data.')
    // Direct messages with Astra only: this command is registered globally for
    // the DM context and is never registered in any server, so nobody sees it
    // in a server's command list.
    .setContexts(InteractionContextType.BotDM)
    .addSubcommand((s) => s.setName('servers').setDescription('List the servers Astra is in')
        .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1).setRequired(false)))
    .addSubcommand((s) => s.setName('server').setDescription('Details about one server')
        .addStringOption((o) => o.setName('id').setDescription('Server ID').setRequired(true)))
    .addSubcommand((s) => s.setName('leave').setDescription('Make Astra leave a server')
        .addStringOption((o) => o.setName('id').setDescription('Server ID').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Shown to the server owner').setMaxLength(300).setRequired(false)))
    .addSubcommand((s) => s.setName('block').setDescription('Leave a server and never join it again')
        .addStringOption((o) => o.setName('id').setDescription('Server ID').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why (private note; also shown to the server owner)').setMaxLength(300).setRequired(false)))
    .addSubcommand((s) => s.setName('unblock').setDescription('Allow a blocked server again')
        .addStringOption((o) => o.setName('id').setDescription('Server ID').setRequired(true)))
    .addSubcommand((s) => s.setName('purge').setDescription('Delete a server\'s stored data now (Astra must not be in it)')
        .addStringOption((o) => o.setName('id').setDescription('Server ID').setRequired(true))
        .addStringOption((o) => o.setName('confirm').setDescription('Type the server ID again to confirm').setRequired(true)))
    .addSubcommand((s) => s.setName('userdata').setDescription('Export everything stored about a person')
        .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID').setRequired(true)))
    .addSubcommand((s) => s.setName('userdelete').setDescription('Delete everything stored about a person')
        .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID').setRequired(true))
        .addBooleanOption((o) => o.setName('confirm').setDescription('Set to true to confirm').setRequired(true))
        .addBooleanOption((o) => o.setName('include_moderation').setDescription('Also delete their moderation cases (default: keep)').setRequired(false)))
    .addSubcommand((s) => s.setName('backup').setDescription('Send a backup to your DMs now'));

async function isOwner(interaction) {
    const ids = await getOwnerIds(interaction.client);
    return ids.includes(interaction.user.id);
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
        if (client.guilds.cache.has(id)) return reply('❌ Astra is still in that server. Use `/owner leave` first.');
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

module.exports = { data, execute, enforceBlock, sweepBlocked, isBlocked };