// --- MODERATION ---
// Everyday moderator tools, with safety checks built in.
//
//   /ban  /kick  /timeout  /warn  /clear
//   /mod  unban | untimeout | warnings | clearwarnings | slowmode | lock | unlock | settings
//
// WHO CAN USE WHAT: the person running the command needs the matching real
// Discord permission (Ban Members to ban, Kick Members to kick, Moderate Members
// to timeout/warn, Manage Messages to clear, Manage Channels to lock/slowmode).
// Being an "Astra-authorized role" is deliberately NOT enough: delegated config
// access must never turn into the power to ban people.
//
// SAFETY: nobody can target themselves, the bot, the server owner, or someone
// whose top role is equal to or above their own (the owner is exempt from that
// last rule), and Astra refuses when her own role is too low to act.
//
// WARNINGS + QUICK PUNISHMENT: every /warn is stored. When a member's active
// warnings reach a number set in /mod settings, Astra punishes automatically
// (timeout by default at 3; optional kick and ban thresholds). All actions are
// recorded as cases and posted to the mod-log channel.

const {
    SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const db = require('../database');

const MAX_REASON = 400;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's limit
const NO_MENTIONS = { parse: [] };

// ------------------------------------------------------------------ helpers
const isPt = (s) => !!s && s.language === 'pt-br';
const tr = (s, en, pt) => (isPt(s) ? pt : en);

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

function cleanReason(text) {
    const r = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON);
    return r || null;
}

// "10m", "2h", "1d", "1w", "45s" -> milliseconds, or null when invalid / out of range.
function parseDuration(text) {
    const m = /^(\d{1,6})\s*([smhdw])$/i.exec(String(text || '').trim());
    if (!m) return null;
    const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2].toLowerCase()];
    const ms = Number(m[1]) * unit;
    if (!ms || ms < 1000 || ms > MAX_TIMEOUT_MS) return null;
    return ms;
}

function humanDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${+(s / 3600).toFixed(1)}h`;
    return `${+(s / 86400).toFixed(1)}d`;
}

// Which automatic punishment (if any) a new warning count triggers.
// Only fires when the count EQUALS a threshold, so one warning never
// re-punishes someone who is already past it. Ban beats kick beats timeout.
function escalationFor(count, s) {
    if (!s) return null;
    if (s.mod_warn_ban_at && count === s.mod_warn_ban_at) return { action: 'ban' };
    if (s.mod_warn_kick_at && count === s.mod_warn_kick_at) return { action: 'kick' };
    if (s.mod_warn_timeout_at && count === s.mod_warn_timeout_at) {
        return { action: 'timeout', minutes: s.mod_warn_timeout_min || 60 };
    }
    return null;
}

// Can `moderator` act on `target`, and can Astra? Returns null when fine,
// otherwise a { en, pt } reason. `target` is a GuildMember (or null when the
// person isn't in the server, which is allowed for bans only).
function targetProblem({ guild, moderator, target, targetUser, botId }) {
    const id = targetUser?.id || target?.id;
    if (id === moderator.id) return { en: 'You can\'t do that to yourself.', pt: 'Você não pode fazer isso consigo mesmo.' };
    if (id === botId) return { en: 'I won\'t do that to myself.', pt: 'Eu não vou fazer isso comigo mesma.' };
    if (id === guild.ownerId) return { en: 'You can\'t do that to the server owner.', pt: 'Você não pode fazer isso com o dono do servidor.' };
    if (!target) return null; // not in the server: nothing to rank-check
    const me = guild.members.me;
    if (moderator.id !== guild.ownerId && target.roles.highest.position >= moderator.roles.highest.position) {
        return { en: 'That member\'s top role is the same as or higher than yours.', pt: 'O cargo mais alto desse membro é igual ou maior que o seu.' };
    }
    if (!me || target.roles.highest.position >= me.roles.highest.position) {
        return { en: 'That member\'s top role is the same as or higher than mine. Move my role above theirs in Server Settings → Roles.', pt: 'O cargo mais alto desse membro é igual ou maior que o meu. Mova o meu cargo acima do dele em Configurações do Servidor → Cargos.' };
    }
    return null;
}

const NEEDS = {
    ban: PermissionFlagsBits.BanMembers,
    kick: PermissionFlagsBits.KickMembers,
    timeout: PermissionFlagsBits.ModerateMembers,
    warn: PermissionFlagsBits.ModerateMembers,
    clear: PermissionFlagsBits.ManageMessages,
    channel: PermissionFlagsBits.ManageChannels,
    settings: PermissionFlagsBits.ManageGuild,
};

function userCan(interaction, key) {
    const p = interaction.memberPermissions;
    return !!p && (p.has(PermissionFlagsBits.Administrator) || p.has(NEEDS[key]));
}

function botCan(guild, key, channel) {
    const me = guild.members.me;
    if (!me) return false;
    const perms = channel ? channel.permissionsFor(me) : me.permissions;
    return !!perms && perms.has(NEEDS[key] || key);
}

const ACTION_STYLE = {
    ban: { color: '#ED4245', icon: '🔨' },
    unban: { color: '#57F287', icon: '🕊️' },
    kick: { color: '#F59E0B', icon: '👢' },
    timeout: { color: '#F59E0B', icon: '⏳' },
    untimeout: { color: '#57F287', icon: '🔊' },
    warn: { color: '#FEE75C', icon: '⚠️' },
    clear: { color: '#22E5FF', icon: '🧹' },
    lock: { color: '#22E5FF', icon: '🔒' },
    unlock: { color: '#22E5FF', icon: '🔓' },
    slowmode: { color: '#22E5FF', icon: '🐌' },
};

async function recordCase(guildId, userId, moderatorId, action, reason, durationSeconds) {
    try {
        const { rows } = await db.query(
            `INSERT INTO mod_cases (guild_id, user_id, moderator_id, action, reason, duration_seconds)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [guildId, userId, moderatorId, action, reason, durationSeconds || null]
        );
        return rows[0].id;
    } catch (err) {
        console.error('❌ Could not record mod case:', err.message);
        return null;
    }
}

async function postModLog(guild, settings, embed) {
    try {
        const id = settings && (settings.mod_log_channel_id || settings.admin_log_channel_id || settings.log_channel_id);
        if (!id) return;
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (channel && channel.isTextBased?.()) await channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS }).catch(() => {});
    } catch (err) {
        console.error('❌ Mod log post failed:', err.message);
    }
}

function caseEmbed({ action, caseId, user, moderator, reason, extra }) {
    const st = ACTION_STYLE[action] || { color: '#22E5FF', icon: '🛡️' };
    const e = new EmbedBuilder()
        .setColor(st.color)
        .setTitle(`${st.icon} ${action.toUpperCase()}${caseId ? ` · Case #${caseId}` : ''}`)
        .setTimestamp();
    if (user) e.addFields({ name: 'Member', value: `${user.tag || user.username} (${user.id})`, inline: true });
    if (moderator) e.addFields({ name: 'Moderator', value: `${moderator.tag || moderator.username} (${moderator.id})`, inline: true });
    if (extra) e.addFields({ name: 'Details', value: String(extra).slice(0, 1000) });
    e.addFields({ name: 'Reason', value: reason || '—' });
    return e;
}

async function tryDm(user, settings, guild, titleEn, titlePt, reason, extra) {
    try {
        const e = new EmbedBuilder()
            .setColor('#F59E0B')
            .setTitle(tr(settings, titleEn, titlePt))
            .setDescription(`**${guild.name}**`)
            .addFields({ name: tr(settings, 'Reason', 'Motivo'), value: reason || '—' });
        if (extra) e.addFields({ name: tr(settings, 'Details', 'Detalhes'), value: extra });
        await user.send({ embeds: [e] });
        return true;
    } catch (_) { return false; }
}

const deny = (interaction, s, en, pt) =>
    interaction.reply({ content: `❌ ${tr(s, en, pt)}`, ephemeral: true, allowedMentions: NO_MENTIONS });

async function noPerm(interaction, s, key) {
    const names = {
        ban: 'Ban Members', kick: 'Kick Members', timeout: 'Moderate Members', warn: 'Moderate Members',
        clear: 'Manage Messages', channel: 'Manage Channels', settings: 'Manage Server',
    };
    return deny(interaction, s, `You need the **${names[key]}** permission to do that.`, `Você precisa da permissão **${names[key]}** para fazer isso.`);
}

async function noBotPerm(interaction, s, key) {
    const names = {
        ban: 'Ban Members', kick: 'Kick Members', timeout: 'Moderate Members', warn: 'Moderate Members',
        clear: 'Manage Messages', channel: 'Manage Channels',
    };
    return deny(interaction, s,
        `I'm missing the **${names[key]}** permission. Give my role that permission in Server Settings → Roles (older servers may need Astra re-invited from the dashboard).`,
        `Eu estou sem a permissão **${names[key]}**. Dê essa permissão ao meu cargo em Configurações do Servidor → Cargos (servidores antigos podem precisar convidar a Astra de novo pelo painel).`);
}

// ------------------------------------------------------------ command data
const ALL_PERMS = (perm) => (b) => b.setDefaultMemberPermissions(perm).setDMPermission(false);
const reasonOpt = (o) => o.setName('reason').setDescription('Why (shown in the log and to the member)').setMaxLength(MAX_REASON).setRequired(false);

const banData = ALL_PERMS(PermissionFlagsBits.BanMembers)(
    new SlashCommandBuilder().setName('ban').setDescription('Ban a member from the server.')
        .addUserOption((o) => o.setName('user').setDescription('Who to ban').setRequired(true))
        .addStringOption(reasonOpt)
        .addIntegerOption((o) => o.setName('delete_days').setDescription('Also delete their messages from the last N days (0-7)').setMinValue(0).setMaxValue(7).setRequired(false))
);
const kickData = ALL_PERMS(PermissionFlagsBits.KickMembers)(
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member from the server.')
        .addUserOption((o) => o.setName('user').setDescription('Who to kick').setRequired(true))
        .addStringOption(reasonOpt)
);
const timeoutData = ALL_PERMS(PermissionFlagsBits.ModerateMembers)(
    new SlashCommandBuilder().setName('timeout').setDescription('Temporarily mute a member (they can\'t talk, react or join voice).')
        .addUserOption((o) => o.setName('user').setDescription('Who to timeout').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('For how long, e.g. 10m, 2h, 1d, 1w (max 28d)').setRequired(true))
        .addStringOption(reasonOpt)
);
const warnData = ALL_PERMS(PermissionFlagsBits.ModerateMembers)(
    new SlashCommandBuilder().setName('warn').setDescription('Warn a member. Enough warnings trigger an automatic punishment.')
        .addUserOption((o) => o.setName('user').setDescription('Who to warn').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why they are being warned').setMaxLength(MAX_REASON).setRequired(true))
);
const clearData = ALL_PERMS(PermissionFlagsBits.ManageMessages)(
    new SlashCommandBuilder().setName('clear').setDescription('Cleanse recent messages from this channel.')
        .addIntegerOption((o) => o.setName('amount').setDescription('How many messages to delete (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
        .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this person').setRequired(false))
);

// /mod is visible to everyone who could use ANY of its parts; each part is
// checked individually inside the handler.
const modData = new SlashCommandBuilder()
    .setName('mod').setDescription('More moderation tools.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('unban').setDescription('Unban someone by their user ID.')
        .addStringOption((o) => o.setName('user_id').setDescription('The user\'s ID').setRequired(true))
        .addStringOption(reasonOpt))
    .addSubcommand((s) => s.setName('untimeout').setDescription('Remove a member\'s timeout early.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(reasonOpt))
    .addSubcommand((s) => s.setName('warnings').setDescription('See a member\'s warnings and history.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('clearwarnings').setDescription('Clear all of a member\'s active warnings.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('slowmode').setDescription('Set slowmode in this channel (0 turns it off).')
        .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds between messages (0-21600)').setMinValue(0).setMaxValue(21600).setRequired(true)))
    .addSubcommand((s) => s.setName('lock').setDescription('Stop everyone from sending messages in this channel.')
        .addStringOption(reasonOpt))
    .addSubcommand((s) => s.setName('unlock').setDescription('Let everyone send messages in this channel again.'))
    .addSubcommand((s) => s.setName('settings').setDescription('View or change moderation settings (mod log, quick punishments).')
        .addChannelOption((o) => o.setName('log_channel').setDescription('Where moderation actions are logged').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
        .addIntegerOption((o) => o.setName('timeout_at').setDescription('Auto-timeout at this many warnings (0 = off)').setMinValue(0).setMaxValue(20).setRequired(false))
        .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('How long the automatic timeout lasts, in minutes').setMinValue(1).setMaxValue(40320).setRequired(false))
        .addIntegerOption((o) => o.setName('kick_at').setDescription('Auto-kick at this many warnings (0 = off)').setMinValue(0).setMaxValue(20).setRequired(false))
        .addIntegerOption((o) => o.setName('ban_at').setDescription('Auto-ban at this many warnings (0 = off)').setMinValue(0).setMaxValue(20).setRequired(false)));

// ------------------------------------------------------------- shared flow
// Resolve the target member (or null) and run the standard safety checks.
async function resolveTarget(interaction, s, user, { allowAbsent = false } = {}) {
    const guild = interaction.guild;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member && !allowAbsent) {
        await deny(interaction, s, 'That person isn\'t in this server.', 'Essa pessoa não está neste servidor.');
        return { stop: true };
    }
    const problem = targetProblem({ guild, moderator: interaction.member, target: member, targetUser: user, botId: interaction.client.user.id });
    if (problem) {
        await deny(interaction, s, problem.en, problem.pt);
        return { stop: true };
    }
    return { member };
}

async function finish(interaction, s, { action, user, reason, extra, dmSent, caseId, summaryEn, summaryPt }) {
    const embed = caseEmbed({ action, caseId, user, moderator: interaction.user, reason, extra });
    await postModLog(interaction.guild, s, embed);
    const note = dmSent === false ? tr(s, '\n(I couldn\'t DM them.)', '\n(Não consegui enviar DM para a pessoa.)') : '';
    return interaction.editReply({ content: `${ACTION_STYLE[action].icon} ${tr(s, summaryEn, summaryPt)}${caseId ? ` · Case #${caseId}` : ''}${note}`, allowedMentions: NO_MENTIONS });
}

// ------------------------------------------------------------------ actions
async function applyTimeout(guild, member, ms, reason) {
    await member.timeout(ms, reason || undefined);
}

async function doEscalation(interaction, s, member, user, esc, count) {
    const guild = interaction.guild;
    const reason = `Automatic: reached ${count} warnings`;
    try {
        if (esc.action === 'ban') {
            if (!botCan(guild, 'ban')) return { ok: false, action: 'ban' };
            await tryDm(user, s, guild, 'You were banned', 'Você foi banido', reason);
            await guild.members.ban(user.id, { reason });
        } else if (esc.action === 'kick') {
            if (!member || !botCan(guild, 'kick')) return { ok: false, action: 'kick' };
            await tryDm(user, s, guild, 'You were kicked', 'Você foi expulso', reason);
            await member.kick(reason);
        } else {
            if (!member || !botCan(guild, 'timeout')) return { ok: false, action: 'timeout' };
            await applyTimeout(guild, member, Math.min(esc.minutes * 60000, MAX_TIMEOUT_MS), reason);
        }
        const caseId = await recordCase(guild.id, user.id, interaction.client.user.id, esc.action, reason, esc.minutes ? esc.minutes * 60 : null);
        await postModLog(guild, s, caseEmbed({ action: esc.action, caseId, user, moderator: interaction.client.user, reason, extra: esc.minutes ? `${esc.minutes} min` : null }));
        return { ok: true, action: esc.action, minutes: esc.minutes };
    } catch (err) {
        console.error('❌ Automatic punishment failed:', err.message);
        return { ok: false, action: esc.action };
    }
}

// ---------------------------------------------------------------- handlers
async function executeBan(interaction) {
    const s = await getSettings(interaction.guild.id);
    if (!userCan(interaction, 'ban')) return noPerm(interaction, s, 'ban');
    if (!botCan(interaction.guild, 'ban')) return noBotPerm(interaction, s, 'ban');
    const user = interaction.options.getUser('user');
    const reason = cleanReason(interaction.options.getString('reason'));
    const days = interaction.options.getInteger('delete_days') ?? 0;
    const r = await resolveTarget(interaction, s, user, { allowAbsent: true });
    if (r.stop) return;
    await interaction.deferReply({ ephemeral: true });
    const dmSent = r.member ? await tryDm(user, s, interaction.guild, 'You were banned', 'Você foi banido', reason) : null;
    try {
        await interaction.guild.members.ban(user.id, { reason: `${interaction.user.tag}: ${reason || 'no reason'}`.slice(0, 500), deleteMessageSeconds: days * 86400 });
    } catch (err) {
        console.error('❌ ban failed:', err.message);
        return interaction.editReply({ content: `❌ ${tr(s, 'I couldn\'t ban that person.', 'Não consegui banir essa pessoa.')}` });
    }
    const caseId = await recordCase(interaction.guild.id, user.id, interaction.user.id, 'ban', reason);
    return finish(interaction, s, { action: 'ban', user, reason, dmSent: dmSent === null ? undefined : dmSent, caseId,
        extra: days ? `Deleted ${days} day(s) of messages` : null,
        summaryEn: `**${user.username}** was banned.`, summaryPt: `**${user.username}** foi banido.` });
}

async function executeKick(interaction) {
    const s = await getSettings(interaction.guild.id);
    if (!userCan(interaction, 'kick')) return noPerm(interaction, s, 'kick');
    if (!botCan(interaction.guild, 'kick')) return noBotPerm(interaction, s, 'kick');
    const user = interaction.options.getUser('user');
    const reason = cleanReason(interaction.options.getString('reason'));
    const r = await resolveTarget(interaction, s, user);
    if (r.stop) return;
    await interaction.deferReply({ ephemeral: true });
    const dmSent = await tryDm(user, s, interaction.guild, 'You were kicked', 'Você foi expulso', reason);
    try {
        await r.member.kick(`${interaction.user.tag}: ${reason || 'no reason'}`.slice(0, 500));
    } catch (err) {
        console.error('❌ kick failed:', err.message);
        return interaction.editReply({ content: `❌ ${tr(s, 'I couldn\'t kick that person.', 'Não consegui expulsar essa pessoa.')}` });
    }
    const caseId = await recordCase(interaction.guild.id, user.id, interaction.user.id, 'kick', reason);
    return finish(interaction, s, { action: 'kick', user, reason, dmSent, caseId,
        summaryEn: `**${user.username}** was kicked.`, summaryPt: `**${user.username}** foi expulso.` });
}

async function executeTimeout(interaction) {
    const s = await getSettings(interaction.guild.id);
    if (!userCan(interaction, 'timeout')) return noPerm(interaction, s, 'timeout');
    if (!botCan(interaction.guild, 'timeout')) return noBotPerm(interaction, s, 'timeout');
    const user = interaction.options.getUser('user');
    const reason = cleanReason(interaction.options.getString('reason'));
    const ms = parseDuration(interaction.options.getString('duration'));
    if (!ms) return deny(interaction, s, 'Use a duration like `10m`, `2h`, `1d` or `1w` (between 1 second and 28 days).', 'Use uma duração como `10m`, `2h`, `1d` ou `1w` (entre 1 segundo e 28 dias).');
    const r = await resolveTarget(interaction, s, user);
    if (r.stop) return;
    await interaction.deferReply({ ephemeral: true });
    try {
        await applyTimeout(interaction.guild, r.member, ms, `${interaction.user.tag}: ${reason || 'no reason'}`.slice(0, 500));
    } catch (err) {
        console.error('❌ timeout failed:', err.message);
        return interaction.editReply({ content: `❌ ${tr(s, 'I couldn\'t timeout that person.', 'Não consegui silenciar essa pessoa.')}` });
    }
    const dmSent = await tryDm(user, s, interaction.guild, 'You were timed out', 'Você foi silenciado', reason, humanDuration(ms));
    const caseId = await recordCase(interaction.guild.id, user.id, interaction.user.id, 'timeout', reason, Math.round(ms / 1000));
    return finish(interaction, s, { action: 'timeout', user, reason, dmSent, caseId, extra: humanDuration(ms),
        summaryEn: `**${user.username}** was timed out for ${humanDuration(ms)}.`, summaryPt: `**${user.username}** foi silenciado por ${humanDuration(ms)}.` });
}

async function executeWarn(interaction) {
    const s = await getSettings(interaction.guild.id);
    if (!userCan(interaction, 'warn')) return noPerm(interaction, s, 'warn');
    const user = interaction.options.getUser('user');
    const reason = cleanReason(interaction.options.getString('reason'));
    if (user.bot) return deny(interaction, s, 'You can\'t warn a bot.', 'Você não pode advertir um bot.');
    const r = await resolveTarget(interaction, s, user);
    if (r.stop) return;
    await interaction.deferReply({ ephemeral: true });
    const caseId = await recordCase(interaction.guild.id, user.id, interaction.user.id, 'warn', reason);
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM mod_cases WHERE guild_id = $1 AND user_id = $2 AND action = 'warn' AND cleared = FALSE`,
        [interaction.guild.id, user.id]
    );
    const count = rows[0].n;
    const dmSent = await tryDm(user, s, interaction.guild, 'You received a warning', 'Você recebeu uma advertência', reason, tr(s, `Active warnings: ${count}`, `Advertências ativas: ${count}`));

    const esc = escalationFor(count, s);
    let escText = '';
    if (esc) {
        const out = await doEscalation(interaction, s, r.member, user, esc, count);
        if (out.ok) {
            escText = tr(s, `\n⚡ Automatic ${out.action} applied (${count} warnings).`, `\n⚡ ${out.action === 'ban' ? 'Banimento' : out.action === 'kick' ? 'Expulsão' : 'Silenciamento'} automático aplicado (${count} advertências).`);
        } else {
            escText = tr(s, `\n⚠️ ${count} warnings reached, but I couldn't apply the automatic ${out.action} (check my permissions and role position).`, `\n⚠️ ${count} advertências atingidas, mas não consegui aplicar a punição automática (${out.action}). Verifique minhas permissões e a posição do meu cargo.`);
        }
    }
    const embed = caseEmbed({ action: 'warn', caseId, user, moderator: interaction.user, reason, extra: `Active warnings: ${count}` });
    await postModLog(interaction.guild, s, embed);
    return interaction.editReply({
        content: `${ACTION_STYLE.warn.icon} ${tr(s, `**${user.username}** was warned (${count} active).`, `**${user.username}** foi advertido (${count} ativas).`)}${caseId ? ` · Case #${caseId}` : ''}${dmSent ? '' : tr(s, '\n(I couldn\'t DM them.)', '\n(Não consegui enviar DM para a pessoa.)')}${escText}`,
        allowedMentions: NO_MENTIONS,
    });
}

async function executeClear(interaction) {
    const s = await getSettings(interaction.guild.id);
    if (!userCan(interaction, 'clear')) return noPerm(interaction, s, 'clear');
    const channel = interaction.channel;
    if (!channel || !channel.bulkDelete) return deny(interaction, s, 'I can\'t clear messages here.', 'Não consigo limpar mensagens aqui.');
    if (!botCan(interaction.guild, 'clear', channel)) return noBotPerm(interaction, s, 'clear');
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');
    await interaction.deferReply({ ephemeral: true });
    let deleted = 0;
    try {
        if (user) {
            const recent = await channel.messages.fetch({ limit: 100 });
            const mine = [...recent.filter((m) => m.author.id === user.id).values()].slice(0, amount);
            deleted = mine.length ? (await channel.bulkDelete(mine, true)).size : 0;
        } else {
            deleted = (await channel.bulkDelete(amount, true)).size;
        }
    } catch (err) {
        console.error('❌ clear failed:', err.message);
        return interaction.editReply({ content: `❌ ${tr(s, 'I couldn\'t delete those messages.', 'Não consegui apagar essas mensagens.')}` });
    }
    const caseId = await recordCase(interaction.guild.id, user ? user.id : interaction.user.id, interaction.user.id, 'clear', `${deleted} message(s) in #${channel.name}`);
    await postModLog(interaction.guild, s, caseEmbed({ action: 'clear', caseId, user: user || null, moderator: interaction.user, reason: `${deleted} message(s) in #${channel.name}`, extra: user ? `Only from ${user.username}` : null }));
    const old = deleted < (user ? 1 : amount) ? tr(s, '\n(Discord can\'t bulk-delete messages older than 14 days.)', '\n(O Discord não permite apagar em massa mensagens com mais de 14 dias.)') : '';
    return interaction.editReply({ content: `🧹 ${tr(s, `Deleted **${deleted}** message(s).`, `**${deleted}** mensagem(ns) apagada(s).`)}${old}` });
}

// ---- /mod
async function executeMod(interaction) {
    const sub = interaction.options.getSubcommand();
    const s = await getSettings(interaction.guild.id);
    const guild = interaction.guild;

    if (sub === 'unban') {
        if (!userCan(interaction, 'ban')) return noPerm(interaction, s, 'ban');
        if (!botCan(guild, 'ban')) return noBotPerm(interaction, s, 'ban');
        const id = interaction.options.getString('user_id').trim();
        if (!/^\d{15,25}$/.test(id)) return deny(interaction, s, 'That doesn\'t look like a user ID.', 'Isso não parece um ID de usuário.');
        const reason = cleanReason(interaction.options.getString('reason'));
        await interaction.deferReply({ ephemeral: true });
        const ban = await guild.bans.fetch(id).catch(() => null);
        if (!ban) return interaction.editReply({ content: `❌ ${tr(s, 'That person isn\'t banned.', 'Essa pessoa não está banida.')}` });
        try { await guild.bans.remove(id, `${interaction.user.tag}: ${reason || 'no reason'}`.slice(0, 500)); }
        catch (err) { console.error('❌ unban failed:', err.message); return interaction.editReply({ content: `❌ ${tr(s, 'I couldn\'t unban that person.', 'Não consegui desbanir essa pessoa.')}` }); }
        const caseId = await recordCase(guild.id, id, interaction.user.id, 'unban', reason);
        return finish(interaction, s, { action: 'unban', user: ban.user, reason, caseId,
            summaryEn: `**${ban.user.username}** was unbanned.`, summaryPt: `**${ban.user.username}** foi desbanido.` });
    }

    if (sub === 'untimeout') {
        if (!userCan(interaction, 'timeout')) return noPerm(interaction, s, 'timeout');
        if (!botCan(guild, 'timeout')) return noBotPerm(interaction, s, 'timeout');
        const user = interaction.options.getUser('user');
        const reason = cleanReason(interaction.options.getString('reason'));
        const r = await resolveTarget(interaction, s, user);
        if (r.stop) return;
        if (!r.member.communicationDisabledUntilTimestamp || r.member.communicationDisabledUntilTimestamp < Date.now()) {
            return deny(interaction, s, 'That member isn\'t timed out.', 'Esse membro não está silenciado.');
        }
        await interaction.deferReply({ ephemeral: true });
        try { await r.member.timeout(null, `${interaction.user.tag}: ${reason || 'no reason'}`.slice(0, 500)); }
        catch (err) { console.error('❌ untimeout failed:', err.message); return interaction.editReply({ content: `❌ ${tr(s, 'I couldn\'t remove the timeout.', 'Não consegui remover o silenciamento.')}` }); }
        const caseId = await recordCase(guild.id, user.id, interaction.user.id, 'untimeout', reason);
        return finish(interaction, s, { action: 'untimeout', user, reason, caseId,
            summaryEn: `**${user.username}**'s timeout was removed.`, summaryPt: `O silenciamento de **${user.username}** foi removido.` });
    }

    if (sub === 'warnings') {
        if (!userCan(interaction, 'warn')) return noPerm(interaction, s, 'warn');
        const user = interaction.options.getUser('user');
        const { rows } = await db.query(
            `SELECT id, action, reason, cleared, created_at FROM mod_cases
             WHERE guild_id = $1 AND user_id = $2 AND action IN ('warn','timeout','kick','ban')
             ORDER BY id DESC LIMIT 10`,
            [guild.id, user.id]
        );
        const active = rows.filter((x) => x.action === 'warn' && !x.cleared).length;
        const { rows: cnt } = await db.query(
            `SELECT COUNT(*)::int AS n FROM mod_cases WHERE guild_id = $1 AND user_id = $2 AND action = 'warn' AND cleared = FALSE`,
            [guild.id, user.id]
        );
        const lines = rows.length
            ? rows.map((x) => `#${x.id} · **${x.action}**${x.cleared ? ' (cleared)' : ''} · <t:${Math.floor(new Date(x.created_at).getTime() / 1000)}:d> · ${String(x.reason || '—').slice(0, 120)}`).join('\n')
            : tr(s, 'No history.', 'Sem histórico.');
        const e = new EmbedBuilder().setColor('#FEE75C')
            .setTitle(tr(s, `Warnings for ${user.username}`, `Advertências de ${user.username}`))
            .setDescription(lines.slice(0, 3900))
            .setFooter({ text: tr(s, `${cnt[0].n} active warning(s) · showing the latest 10 entries`, `${cnt[0].n} advertência(s) ativa(s) · mostrando as 10 últimas`) });
        void active;
        return interaction.reply({ embeds: [e], ephemeral: true, allowedMentions: NO_MENTIONS });
    }

    if (sub === 'clearwarnings') {
        if (!userCan(interaction, 'warn')) return noPerm(interaction, s, 'warn');
        const user = interaction.options.getUser('user');
        const res = await db.query(
            `UPDATE mod_cases SET cleared = TRUE WHERE guild_id = $1 AND user_id = $2 AND action = 'warn' AND cleared = FALSE`,
            [guild.id, user.id]
        );
        const caseId = await recordCase(guild.id, user.id, interaction.user.id, 'clearwarnings', `${res.rowCount} warning(s) cleared`);
        await postModLog(guild, s, caseEmbed({ action: 'warn', caseId, user, moderator: interaction.user, reason: `Cleared ${res.rowCount} warning(s)` }));
        return interaction.reply({ content: `✅ ${tr(s, `Cleared **${res.rowCount}** warning(s) for **${user.username}**.`, `**${res.rowCount}** advertência(s) de **${user.username}** limpa(s).`)}`, ephemeral: true, allowedMentions: NO_MENTIONS });
    }

    if (sub === 'slowmode' || sub === 'lock' || sub === 'unlock') {
        if (!userCan(interaction, 'channel')) return noPerm(interaction, s, 'channel');
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased?.() || channel.isThread?.() || !channel.permissionOverwrites) {
            return deny(interaction, s, 'Use this in a regular text channel.', 'Use isto em um canal de texto comum.');
        }
        if (!botCan(guild, 'channel', channel)) return noBotPerm(interaction, s, 'channel');
        try {
            if (sub === 'slowmode') {
                const secs = interaction.options.getInteger('seconds');
                await channel.setRateLimitPerUser(secs, `${interaction.user.tag}`);
                await postModLog(guild, s, caseEmbed({ action: 'slowmode', user: null, moderator: interaction.user, reason: `#${channel.name}: ${secs ? secs + 's' : 'off'}` }));
                return interaction.reply({ content: `🐌 ${secs ? tr(s, `Slowmode set to **${secs}s**.`, `Modo lento definido para **${secs}s**.`) : tr(s, 'Slowmode turned off.', 'Modo lento desativado.')}` });
            }
            const everyone = guild.roles.everyone;
            if (sub === 'lock') {
                const reason = cleanReason(interaction.options.getString('reason'));
                await channel.permissionOverwrites.edit(everyone, { SendMessages: false, AddReactions: false }, { reason: `${interaction.user.tag}: ${reason || 'lock'}`.slice(0, 500) });
                await postModLog(guild, s, caseEmbed({ action: 'lock', user: null, moderator: interaction.user, reason: reason || `#${channel.name}` }));
                return interaction.reply({ content: `🔒 ${tr(s, 'This channel is now locked.', 'Este canal foi trancado.')}${reason ? ` ${reason}` : ''}`, allowedMentions: NO_MENTIONS });
            }
            await channel.permissionOverwrites.edit(everyone, { SendMessages: null, AddReactions: null }, { reason: `${interaction.user.tag}: unlock` });
            await postModLog(guild, s, caseEmbed({ action: 'unlock', user: null, moderator: interaction.user, reason: `#${channel.name}` }));
            return interaction.reply({ content: `🔓 ${tr(s, 'This channel is unlocked.', 'Este canal foi destrancado.')}` });
        } catch (err) {
            console.error(`❌ ${sub} failed:`, err.message);
            return deny(interaction, s, 'I couldn\'t change this channel.', 'Não consegui alterar este canal.');
        }
    }

    if (sub === 'settings') {
        if (!userCan(interaction, 'settings')) return noPerm(interaction, s, 'settings');
        const logCh = interaction.options.getChannel('log_channel');
        const o = (n) => interaction.options.getInteger(n);
        const changes = { log: logCh, tAt: o('timeout_at'), tMin: o('timeout_minutes'), kAt: o('kick_at'), bAt: o('ban_at') };
        const any = Object.values(changes).some((v) => v !== null && v !== undefined);
        if (any) {
            await db.query(
                `INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`, [guild.id]);
            await db.query(
                `UPDATE guild_settings SET
                    mod_log_channel_id = COALESCE($2, mod_log_channel_id),
                    mod_warn_timeout_at = CASE WHEN $3::int IS NULL THEN mod_warn_timeout_at WHEN $3::int = 0 THEN NULL ELSE $3::int END,
                    mod_warn_timeout_min = COALESCE($4, mod_warn_timeout_min),
                    mod_warn_kick_at = CASE WHEN $5::int IS NULL THEN mod_warn_kick_at WHEN $5::int = 0 THEN NULL ELSE $5::int END,
                    mod_warn_ban_at = CASE WHEN $6::int IS NULL THEN mod_warn_ban_at WHEN $6::int = 0 THEN NULL ELSE $6::int END
                 WHERE guild_id = $1`,
                [guild.id, logCh ? logCh.id : null, changes.tAt, changes.tMin, changes.kAt, changes.bAt]
            );
        }
        const cur = await getSettings(guild.id);
        const off = tr(cur, 'off', 'desligado');
        const e = new EmbedBuilder().setColor('#22E5FF')
            .setTitle(tr(cur, '🛡️ Moderation settings', '🛡️ Configurações de moderação'))
            .addFields(
                { name: tr(cur, 'Mod log', 'Registro de moderação'), value: cur?.mod_log_channel_id ? `<#${cur.mod_log_channel_id}>` : tr(cur, 'not set (uses the admin log)', 'não definido (usa o registro de admin)') },
                { name: tr(cur, 'Auto-timeout', 'Silenciamento automático'), value: cur?.mod_warn_timeout_at ? tr(cur, `at ${cur.mod_warn_timeout_at} warnings, for ${cur.mod_warn_timeout_min || 60} min`, `com ${cur.mod_warn_timeout_at} advertências, por ${cur.mod_warn_timeout_min || 60} min`) : off, inline: true },
                { name: tr(cur, 'Auto-kick', 'Expulsão automática'), value: cur?.mod_warn_kick_at ? tr(cur, `at ${cur.mod_warn_kick_at} warnings`, `com ${cur.mod_warn_kick_at} advertências`) : off, inline: true },
                { name: tr(cur, 'Auto-ban', 'Banimento automático'), value: cur?.mod_warn_ban_at ? tr(cur, `at ${cur.mod_warn_ban_at} warnings`, `com ${cur.mod_warn_ban_at} advertências`) : off, inline: true },
            );
        return interaction.reply({ embeds: [e], ephemeral: true });
    }
}

module.exports = {
    banData, kickData, timeoutData, warnData, clearData, modData,
    executeBan, executeKick, executeTimeout, executeWarn, executeClear, executeMod,
    _test: { parseDuration, humanDuration, escalationFor, targetProblem, cleanReason },
};