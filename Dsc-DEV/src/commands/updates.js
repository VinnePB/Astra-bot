// --- UPDATES CHANNEL ---
// Astra posts her own changelog in a channel, one version at a time, and the
// bot owner can warn every opted-in server before an update lands.
//
//   /updates on|off|view|preview   (server admins; off by default)
//   /announce soon                 (bot owner only: "update incoming" notice)
//
// Where the text comes from: src/changelog.md, the same file you already keep
// as the changelog. Headings must look like "## b.8.18.0 — Title". Oldest
// version first, newest last; "{UPCOMING UPDATE...}" lines are ignored.
//
// When it posts: once at startup (every deploy restarts her). Each server
// remembers the last version it was shown (guild_settings.updates_last_version),
// so nothing is posted twice. A server that was offline for several versions
// gets at most the newest MAX_CATCHUP, oldest first. Turning updates on never
// dumps history: it starts from the current version.

const fs = require('fs');
const path = require('path');
const {
    SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits,
} = require('discord.js');
const db = require('../database');
const { isAstraAdmin } = require('../permissions');
const { logAction } = require('./config');

const CHANGELOG_FILE = path.join(__dirname, '..', 'changelog.md');
const MAX_CATCHUP = 3;
const CHUNK = 3800;            // embed descriptions cap at 4096
const CREATED_CHANNEL_NAME = 'astra-updates';

const isPt = (s) => !!s && s.language === 'pt-br';
const L = (s, en, pt) => (isPt(s) ? pt : en);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ changelog text
function parseChangelog(text) {
    const entries = [];
    for (const part of String(text).split(/^## /m).slice(1)) {
        const nl = part.indexOf('\n');
        const head = (nl === -1 ? part : part.slice(0, nl)).trim();
        const m = head.match(/^(b\.\d+\.\d+\.\d+)\s*[—–-]\s*(.+?)\s*(?:\*\(current\)\*)?$/);
        if (!m) continue;
        let body = nl === -1 ? '' : part.slice(nl + 1);
        body = body
            .split('\n')
            .filter((line) => line.trim() !== '---' && !/^\{UPCOMING UPDATE/i.test(line.trim()))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        // A version heading that appears twice (it happens in old changelogs) is
        // merged into one entry, so a version is only ever posted once.
        const same = entries.find((e) => e.version === m[1]);
        if (same) same.body = `${same.body}\n\n${body}`.trim();
        else entries.push({ version: m[1], title: m[2], body });
    }
    return entries;
}

let cached = null;
function loadChangelog() {
    if (cached) return cached;
    try {
        cached = parseChangelog(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
    } catch (err) {
        console.error('❌ Could not read changelog.md:', err.message);
        return [];
    }
    return cached;
}

// Splits text on line breaks into pieces of at most `max` characters.
function chunkText(text, max = CHUNK) {
    const out = [];
    let cur = '';
    const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (let line of String(text).split('\n')) {
        while (line.length > max) { // one absurdly long line: cut it
            push();
            out.push(line.slice(0, max));
            line = line.slice(max);
        }
        if ((cur + '\n' + line).length > max) push();
        cur += (cur ? '\n' : '') + line;
    }
    push();
    return out.length ? out : [''];
}

// What a server still has to be shown. null lastVersion or one we no longer
// know about means "just start from now" (nothing to post).
function pendingFor(entries, lastVersion, cap = MAX_CATCHUP) {
    if (!entries.length) return { toPost: [], skipped: 0, resync: false };
    const idx = lastVersion ? entries.findIndex((e) => e.version === lastVersion) : -1;
    if (idx === -1) return { toPost: [], skipped: 0, resync: true };
    const unseen = entries.slice(idx + 1);
    return { toPost: unseen.slice(-cap), skipped: Math.max(0, unseen.length - cap), resync: false };
}

// ------------------------------------------------------------------ posting
async function usableChannel(guild, channelId) {
    if (!channelId) return { ok: false, reason: 'no channel' };
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return { ok: false, reason: 'channel missing' };
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const perms = me && channel.permissionsFor(me);
    if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) return { ok: false, reason: 'missing permissions' };
    return { ok: true, channel };
}

const mentionOptions = (roleId) => (roleId ? { parse: [], roles: [roleId] } : { parse: [] });

// Posts one version. Returns true when every piece was sent.
async function postEntry(channel, entry, { roleId = null, skipped = 0 } = {}) {
    const parts = chunkText(entry.body);
    for (let i = 0; i < parts.length; i++) {
        const embed = new EmbedBuilder()
            .setColor('#22E5FF')
            .setTitle(`${entry.version} — ${entry.title}${i > 0 ? ' (cont.)' : ''}`.slice(0, 256))
            .setDescription(parts[i] || '​')
            .setFooter({ text: 'Astra changelog' });
        const payload = { embeds: [embed], allowedMentions: mentionOptions(i === 0 ? roleId : null) };
        if (i === 0 && roleId) payload.content = `<@&${roleId}>`;
        if (i === 0 && skipped > 0) payload.content = `${payload.content ? payload.content + ' ' : ''}(${skipped} older update${skipped === 1 ? '' : 's'} not shown)`;
        await channel.send(payload);
    }
    return true;
}

async function setLast(guildId, version) {
    await db.query('UPDATE guild_settings SET updates_last_version = $2 WHERE guild_id = $1', [guildId, version]);
}

const currentEntry = () => { const e = loadChangelog(); return e.length ? e[e.length - 1] : null; };

// Saves the updates settings (slash command and dashboard share this).
// Turning updates on (from off, or with no remembered version) starts from the
// current version, so old history is never dumped; edits while it is already
// on keep the remembered version.
async function saveSettings(guildId, { enabled, channelId, roleId }) {
    const current = currentEntry();
    await db.query(
        `INSERT INTO guild_settings (guild_id, updates_enabled, updates_channel_id, updates_role_id, updates_last_version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (guild_id) DO UPDATE SET
            updates_enabled = $2, updates_channel_id = $3, updates_role_id = $4,
            updates_last_version = CASE
                WHEN $2 AND (guild_settings.updates_enabled IS NOT TRUE OR guild_settings.updates_last_version IS NULL) THEN $5
                ELSE guild_settings.updates_last_version END`,
        [guildId, enabled, channelId, roleId, current ? current.version : null]
    );
}

// Creates a read-only #astra-updates. Returns { ok, channel } or { ok: false, error: 'nomanage' }.
async function createUpdatesChannel(guild, settings, requestedBy) {
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return { ok: false, error: 'nomanage' };
    const channel = await guild.channels.create({
        name: CREATED_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: L(settings, 'Astra changelogs and update notices.', 'Changelogs e avisos de atualização da Astra.'),
        permissionOverwrites: [
            { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
        ],
        reason: `Astra updates channel, requested by ${requestedBy}`,
    });
    return { ok: true, channel };
}

// Called once after startup. Never throws.
async function postPendingToAll(client) {
    const summary = { guilds: 0, posted: 0, failed: 0 };
    try {
        const entries = loadChangelog();
        if (!entries.length) return summary;
        const current = entries[entries.length - 1].version;
        const { rows } = await db.query(
            `SELECT guild_id, updates_channel_id, updates_role_id, updates_last_version
             FROM guild_settings WHERE updates_enabled = TRUE`
        );
        for (const row of rows) {
            const guild = client.guilds.cache.get(row.guild_id);
            if (!guild) continue; // Astra left that server
            summary.guilds++;
            try {
                const { toPost, skipped, resync } = pendingFor(entries, row.updates_last_version);
                if (resync) { await setLast(row.guild_id, current); continue; }
                if (!toPost.length) continue;
                const target = await usableChannel(guild, row.updates_channel_id);
                if (!target.ok) {
                    summary.failed++;
                    console.warn(`⚠️ Updates not posted in ${guild.name} (${guild.id}): ${target.reason}. Will retry next start.`);
                    continue;
                }
                for (let i = 0; i < toPost.length; i++) {
                    await postEntry(target.channel, toPost[i], { roleId: i === 0 ? row.updates_role_id : null, skipped: i === 0 ? skipped : 0 });
                    await setLast(row.guild_id, toPost[i].version); // remembered per version, so a failure halfway never repeats
                    summary.posted++;
                    await sleep(400);
                }
            } catch (err) {
                summary.failed++;
                console.error(`❌ Updates failed for guild ${row.guild_id}:`, err.message);
            }
        }
        if (summary.guilds) console.log(`📣 Changelog pass: ${summary.posted} post(s), ${summary.failed} failure(s), ${summary.guilds} server(s).`);
    } catch (err) {
        console.error('❌ Changelog pass failed:', err);
    }
    return summary;
}

// "Update incoming" notice to every opted-in server (bot owner).
async function sendSoonNotice(client, { eta, teaser }) {
    const summary = { sent: 0, failed: 0 };
    const { rows } = await db.query(
        `SELECT guild_id, updates_channel_id, updates_role_id, language
         FROM guild_settings WHERE updates_enabled = TRUE`
    );
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guild_id);
        if (!guild) continue;
        try {
            const target = await usableChannel(guild, row.updates_channel_id);
            if (!target.ok) { summary.failed++; continue; }
            const s = { language: row.language };
            const embed = new EmbedBuilder()
                .setColor('#FF2E6D')
                .setTitle(L(s, '⏳ Update incoming', '⏳ Atualização a caminho'))
                .setDescription(teaser || L(s,
                    'A new update is on its way. I might restart for a moment. Nothing to do on your side, the changelog will show up here when it lands.',
                    'Uma atualização nova está chegando. Posso reiniciar por um instante. Não precisa fazer nada, o changelog aparece aqui quando ela chegar.'));
            if (eta) embed.addFields({ name: L(s, 'Expected', 'Previsão'), value: eta });
            const payload = { embeds: [embed], allowedMentions: mentionOptions(row.updates_role_id) };
            if (row.updates_role_id) payload.content = `<@&${row.updates_role_id}>`;
            await target.channel.send(payload);
            summary.sent++;
        } catch (err) {
            summary.failed++;
            console.error(`❌ Update notice failed for guild ${row.guild_id}:`, err.message);
        }
        await sleep(400);
    }
    return summary;
}

// ----------------------------------------------------------- owner check
let ownerCache = null;
async function getOwnerIds(client) {
    const fromEnv = (process.env.BOT_OWNER_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fromEnv.length) return fromEnv;
    if (ownerCache && Date.now() - ownerCache.at < 10 * 60 * 1000) return ownerCache.ids;
    try {
        const app = await client.application.fetch();
        const o = app.owner;
        const ids = o ? [o.members ? o.ownerId : o.id].filter(Boolean) : [];
        ownerCache = { at: Date.now(), ids };
        return ids;
    } catch (err) {
        console.error('❌ Could not look up the bot owner:', err.message);
        return [];
    }
}

// ------------------------------------------------------------- commands
const updatesData = new SlashCommandBuilder()
    .setName('updates')
    .setDescription('Admins: have Astra post her changelogs and update notices in a channel')
    .addSubcommand((s) => s.setName('on').setDescription('Turn the updates channel on (or change its channel or ping role)')
        .addChannelOption((o) => o.setName('channel').setDescription('Where updates go').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
        .addBooleanOption((o) => o.setName('create').setDescription('Create a read-only #astra-updates channel for it (needs Manage Channels)').setRequired(false))
        .addRoleOption((o) => o.setName('role').setDescription('Role to ping on every update (optional)').setRequired(false))
        .addBooleanOption((o) => o.setName('clear_role').setDescription('Stop pinging any role').setRequired(false)))
    .addSubcommand((s) => s.setName('off').setDescription('Turn the updates channel off'))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current updates settings'))
    .addSubcommand((s) => s.setName('preview').setDescription('Post the latest changelog entry in the updates channel now (to test the setup)'));

const announceData = new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Bot owner only: send an update notice to every server that turned updates on')
    .addSubcommand((s) => s.setName('soon').setDescription('Warn that an update is coming')
        .addStringOption((o) => o.setName('eta').setDescription('When, e.g. "tonight" or "in about 10 minutes"').setMaxLength(60).setRequired(false))
        .addStringOption((o) => o.setName('teaser').setDescription('One line about what is coming (replaces the default text)').setMaxLength(300).setRequired(false)));

async function getSettings(guildId) {
    const { rows } = await db.query(
        `SELECT language, updates_enabled, updates_channel_id, updates_role_id, updates_last_version
         FROM guild_settings WHERE guild_id = $1`, [guildId]
    );
    return rows[0] || null;
}

async function executeSlashUpdates(interaction) {
    const settings = await getSettings(interaction.guild.id);
    if (!(await isAstraAdmin(interaction.member))) {
        return interaction.reply({ content: L(settings, '❌ You need Administrator permission or an Astra-authorized role to do this.', '❌ Você precisa da permissão de Administrador ou de um cargo autorizado pela Astra.'), ephemeral: true });
    }
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const entries = loadChangelog();
    const current = entries.length ? entries[entries.length - 1] : null;
    try {
        if (sub === 'on') {
            if (!current) return interaction.reply({ content: L(settings, '❌ I have no changelog loaded right now. Tell the bot owner.', '❌ Estou sem changelog carregado agora. Avise o dono do bot.'), ephemeral: true });
            const picked = interaction.options.getChannel('channel');
            const create = interaction.options.getBoolean('create');
            const role = interaction.options.getRole('role');
            const clearRole = interaction.options.getBoolean('clear_role');

            let channelId = picked ? picked.id : settings?.updates_channel_id || null;
            if (create) {
                const made = await createUpdatesChannel(guild, settings, interaction.user.username);
                if (!made.ok) {
                    return interaction.reply({ content: L(settings, '❌ I need the **Manage Channels** permission to create a channel. Give it to me, or pick an existing channel with `channel:`.', '❌ Preciso da permissão **Gerenciar Canais** para criar um canal. Me dê a permissão, ou escolha um canal existente com `channel:`.'), ephemeral: true });
                }
                channelId = made.channel.id;
            }
            if (!channelId) {
                return interaction.reply({ content: L(settings, '❌ Pick a channel with `channel:` or let me create one with `create:True`.', '❌ Escolha um canal com `channel:` ou deixe eu criar um com `create:True`.'), ephemeral: true });
            }
            const check = await usableChannel(guild, channelId);
            if (!check.ok) {
                return interaction.reply({ content: L(settings, `❌ I can't post in <#${channelId}> (${check.reason}). I need View Channel, Send Messages and Embed Links there.`, `❌ Não consigo postar em <#${channelId}> (${check.reason}). Preciso de Ver Canal, Enviar Mensagens e Inserir Links ali.`), ephemeral: true });
            }
            const roleId = clearRole ? null : role ? role.id : settings?.updates_role_id || null;
            await saveSettings(guild.id, { enabled: true, channelId, roleId });
            await logAction(guild, `📣 ${interaction.user} turned on the updates channel (<#${channelId}>).`);
            return interaction.reply({
                content: L(settings,
                    `✅ Updates are on in <#${channelId}>${roleId ? `, pinging <@&${roleId}>` : ''}. the next version I get will show up there on its own. \`/updates preview\` posts the latest one now if you want to see how it looks.`,
                    `✅ Atualizações ligadas em <#${channelId}>${roleId ? `, marcando <@&${roleId}>` : ''}. a próxima versão que eu receber aparece lá sozinha. \`/updates preview\` posta a mais recente agora, se quiser ver como fica.`),
                ephemeral: true, allowedMentions: { parse: [] },
            });
        }

        if (sub === 'off') {
            await db.query(
                `INSERT INTO guild_settings (guild_id, updates_enabled) VALUES ($1, FALSE)
                 ON CONFLICT (guild_id) DO UPDATE SET updates_enabled = FALSE`, [guild.id]
            );
            await logAction(guild, `📣 ${interaction.user} turned off the updates channel.`);
            return interaction.reply({ content: L(settings, '✅ Updates are off. I will not post changelogs here anymore.', '✅ Atualizações desligadas. Não vou mais postar changelogs aqui.'), ephemeral: true });
        }

        if (sub === 'view') {
            const on = settings?.updates_enabled === true;
            const text = L(settings,
                `📣 **Updates:** ${on ? 'on' : 'off'}\nChannel: ${settings?.updates_channel_id ? `<#${settings.updates_channel_id}>` : 'not set'}\nPing role: ${settings?.updates_role_id ? `<@&${settings.updates_role_id}>` : 'none'}\nLast version shown here: ${settings?.updates_last_version || 'none yet'}\nCurrent version: ${current ? current.version : 'unknown'}`,
                `📣 **Atualizações:** ${on ? 'ligadas' : 'desligadas'}\nCanal: ${settings?.updates_channel_id ? `<#${settings.updates_channel_id}>` : 'não definido'}\nCargo marcado: ${settings?.updates_role_id ? `<@&${settings.updates_role_id}>` : 'nenhum'}\nÚltima versão mostrada aqui: ${settings?.updates_last_version || 'nenhuma ainda'}\nVersão atual: ${current ? current.version : 'desconhecida'}`);
            return interaction.reply({ content: text, ephemeral: true, allowedMentions: { parse: [] } });
        }

        if (sub === 'preview') {
            if (!current) return interaction.reply({ content: L(settings, '❌ No changelog loaded.', '❌ Nenhum changelog carregado.'), ephemeral: true });
            if (!settings?.updates_enabled || !settings.updates_channel_id) {
                return interaction.reply({ content: L(settings, '❌ Turn updates on first with `/updates on`.', '❌ Ligue as atualizações antes com `/updates on`.'), ephemeral: true });
            }
            const check = await usableChannel(guild, settings.updates_channel_id);
            if (!check.ok) return interaction.reply({ content: L(settings, `❌ I can't post in <#${settings.updates_channel_id}> (${check.reason}).`, `❌ Não consigo postar em <#${settings.updates_channel_id}> (${check.reason}).`), ephemeral: true });
            await postEntry(check.channel, current); // no role ping on a preview
            return interaction.reply({ content: L(settings, `✅ Posted ${current.version} in <#${settings.updates_channel_id}>.`, `✅ ${current.version} postada em <#${settings.updates_channel_id}>.`), ephemeral: true });
        }
    } catch (err) {
        console.error('❌ Error in /updates:', err);
        const msg = { content: L(settings, '❌ Something went wrong. Check my permissions and try again.', '❌ Algo deu errado. Verifique minhas permissões e tente de novo.'), ephemeral: true };
        if (interaction.replied || interaction.deferred) return interaction.followUp(msg).catch(() => {});
        return interaction.reply(msg).catch(() => {});
    }
}

async function executeSlashAnnounce(interaction) {
    const ids = await getOwnerIds(interaction.client);
    if (!ids.includes(interaction.user.id)) {
        return interaction.reply({ content: '❌ Only the bot owner can use this.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
        const eta = (interaction.options.getString('eta') || '').trim();
        const teaser = (interaction.options.getString('teaser') || '').trim();
        const r = await sendSoonNotice(interaction.client, { eta, teaser });
        return interaction.editReply({ content: `✅ Update notice sent to ${r.sent} server(s)${r.failed ? `, ${r.failed} could not be reached (channel missing or no permission)` : ''}.` });
    } catch (err) {
        console.error('❌ Error in /announce:', err);
        return interaction.editReply({ content: '❌ Something went wrong, check the logs.' }).catch(() => {});
    }
}

module.exports = {
    updatesData, announceData,
    executeSlashUpdates, executeSlashAnnounce,
    postPendingToAll,
    // shared with the dashboard routes in index.js
    saveSettings, createUpdatesChannel, usableChannel, postEntry, currentEntry,
    _test: { parseChangelog, chunkText, pendingFor, postEntry, sendSoonNotice, loadChangelog, getOwnerIds, usableChannel },
};