const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../database');
const { isServerAdministrator, isAstraAdmin } = require('../permissions');
const { t } = require('../i18n');

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

// Welcome/leave message templates support {user} (mention), {username},
// {server}, and {membercount} placeholders. Admin-authored free text — not
// something we translate, since it's the server's own voice, not Astra's UI.
function fillTemplate(template, vars) {
    return String(template)
        .replace(/\{user\}/g, vars.user)
        .replace(/\{username\}/g, vars.username)
        .replace(/\{server\}/g, vars.server)
        .replace(/\{membercount\}/g, vars.membercount);
}

// Unified audit trail — every meaningful admin action and notable automatic
// action (kicks, scam flags, ticket open/close, verification completions)
// posts here if a log channel is configured. Deliberately NOT wired into
// every micro-step (e.g. "user clicked I Agree") — that would flood an
// active server's log channel. Configured the same way as everything
// else: log_channel_id on guild_settings, set via /config verification,
// /config tickets, or the website.
async function logAction(guild, message) {
    try {
        const settings = await getSettings(guild.id);
        if (!settings || !settings.log_channel_id) return;
        const logChannel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
        if (logChannel) await logChannel.send(message).catch(() => {});
    } catch (err) {
        console.error('❌ Error posting to Astra log channel:', err);
    }
}

// Grants member_role_id if (and only if) the member holds both configured
// prerequisite roles. Returns true if the final role is now granted
// (either just now, or already held).
async function checkAndGrantFinalRole(member, settings) {
    if (!settings.member_role_id) return false;

    const hasRulesRole = !settings.rules_role_id || member.roles.cache.has(settings.rules_role_id);
    const hasVerifyRole = !settings.verify_role_id || member.roles.cache.has(settings.verify_role_id);

    if (!hasRulesRole || !hasVerifyRole) return false;

    if (!member.roles.cache.has(settings.member_role_id)) {
        await member.roles.add(settings.member_role_id);
    }
    return true;
}

module.exports = {
    logAction,

    // --- SLASH COMMAND DATA (/config) ---
    // No setDefaultMemberPermissions — Astra-authorized roles may lack real
    // Administrator permission, and Discord hides restricted commands from
    // them entirely regardless of our own isAstraAdmin() check. Access is
    // enforced inside the handlers instead.
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure Astra channels, roles, and admin access for this server.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('verification')
                .setDescription('Configure the verification system')
                .addChannelOption(option =>
                    option.setName('verify_channel')
                        .setDescription('"Chat B" — members type !verify here (anything else gets deleted + a warning)')
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('member_role')
                        .setDescription('Final role granted once verification is complete (e.g. "2STEP VERIFIED")')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('rules_channel')
                        .setDescription('"Chat A" — where the "I Agree" button is posted (optional — enables the two-step gate)')
                        .setRequired(false))
                .addRoleOption(option =>
                    option.setName('rules_role')
                        .setDescription('Role granted by Chat A\'s button (required if rules_channel is set)')
                        .setRequired(false))
                .addRoleOption(option =>
                    option.setName('verify_role')
                        .setDescription('Role granted by typing !verify in Chat B (required if rules_channel is set)')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('log_channel')
                        .setDescription('Channel to log verifications and auto-kicks')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('joinleave_logs')
                        .setDescription('Log member joins/leaves to the log channel (default: on)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Chat A embed title (Optional)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Chat A embed text (Use \\n for a new line. Optional)')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('auto_kick')
                        .setDescription('Automatically kick members who never finish verification (default: off)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('auto_kick_days')
                        .setDescription('Grace period in days before an unverified member is kicked (default: 2)')
                        .setMinValue(1)
                        .setMaxValue(30)
                        .setRequired(false))
        )
        .addSubcommandGroup(group =>
            group
                .setName('admins')
                .setDescription('Manage which roles are allowed to configure Astra')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Grant a role permission to configure Astra (real Administrators only)')
                        .addRoleOption(option =>
                            option.setName('role')
                                .setDescription('Role to authorize')
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Revoke a role\'s permission to configure Astra (real Administrators only)')
                        .addRoleOption(option =>
                            option.setName('role')
                                .setDescription('Role to revoke')
                                .setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription('List roles currently authorized to configure Astra'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('antiscam')
                .setDescription('Flag or kick likely scam/spam accounts on join (new account + no avatar)')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Turn this check on or off')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('What to do when an account looks suspicious (default: log only)')
                        .addChoices(
                            { name: 'Log only — post an alert for staff to review', value: 'log' },
                            { name: 'Kick automatically', value: 'kick' }
                        )
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('min_age_hours')
                        .setDescription('Flag accounts younger than this many hours old (default: 24)')
                        .setMinValue(1)
                        .setMaxValue(720)
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('require_no_avatar')
                        .setDescription('Only flag new accounts that ALSO have no custom avatar (default: true, fewer false positives)')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('tickets')
                .setDescription('Set up the commission ticket system')
                .addChannelOption(option =>
                    option.setName('ticket_channel')
                        .setDescription('Channel where the "Open a Ticket" button is posted')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('ticket_category')
                        .setDescription('Category new ticket channels get created under')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('log_channel')
                        .setDescription('Channel to log ticket opens/closes (reuses the verification log channel if omitted)')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('artist_setup_category')
                        .setDescription('Category where artists\' private setup channels get created')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false))
        )
        .addSubcommandGroup(group =>
            group
                .setName('artist-roles')
                .setDescription('Manage which roles automatically count as artists')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Anyone holding this role can self-manage a commission panel')
                        .addRoleOption(option => option.setName('role').setDescription('Role to authorize').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Revoke a role\'s automatic artist status')
                        .addRoleOption(option => option.setName('role').setDescription('Role to revoke').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription('List roles that automatically count as artists'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('welcome')
                .setDescription('Configure the public welcome message posted when someone joins')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Turn public welcome messages on or off')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to post welcome messages in (required the first time you enable this)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Use {user}, {username}, {server}, {membercount}. \\n for a new line. Optional.')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('card')
                        .setDescription('Post as a styled embed with the member\'s avatar (default: on). Off = plain text.')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Configure the message posted when someone leaves')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Turn leave messages on or off')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to post leave messages in (required the first time you enable this)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Use {username}, {server}, {membercount}. \\n for a new line. Optional.')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leveling')
                .setDescription('Configure the XP/leveling system')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Turn the leveling system on or off')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Level-up channel (leave unset to announce in whatever channel they leveled up in)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Use {user}, {username}, {level}, {xp}. \\n for a new line. Optional.')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('cooldown_seconds')
                        .setDescription('Minimum seconds between XP awards per member (default: 60)')
                        .setMinValue(5)
                        .setMaxValue(3600)
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('xp_min')
                        .setDescription('Minimum XP awarded per eligible message (default: 15)')
                        .setMinValue(1)
                        .setMaxValue(1000)
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('xp_max')
                        .setDescription('Maximum XP awarded per eligible message (default: 25)')
                        .setMinValue(1)
                        .setMaxValue(1000)
                        .setRequired(false))
        )
        .addSubcommandGroup(group =>
            group
                .setName('level-roles')
                .setDescription('Manage milestone roles granted when a member reaches a given level')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Grant a role automatically once a member reaches this level')
                        .addIntegerOption(option => option.setName('level').setDescription('Level required').setMinValue(1).setMaxValue(1000).setRequired(true))
                        .addRoleOption(option => option.setName('role').setDescription('Role to grant').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Remove a level\'s role reward')
                        .addIntegerOption(option => option.setName('level').setDescription('Level to remove').setMinValue(1).setMaxValue(1000).setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription('List all configured level-role rewards'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('fun')
                .setDescription('Toggle Astra\'s random canned-line reply when @mentioned or called by name (no AI)')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Turn mention/name replies on or off (default: on)')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('economy')
                .setDescription('Configure the currency/economy system')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Turn the economy system on or off')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('currency_name')
                        .setDescription('What to call the currency (default: Coins)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('currency_symbol')
                        .setDescription('An emoji or short symbol for the currency (default: 🪙)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('daily_min')
                        .setDescription('Minimum /daily payout (default: 50)')
                        .setMinValue(1)
                        .setMaxValue(1000000)
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('daily_max')
                        .setDescription('Maximum /daily payout (default: 150)')
                        .setMinValue(1)
                        .setMaxValue(1000000)
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('daily_streak_bonus')
                        .setDescription('Extra payout per consecutive day claimed, capped at 10 days (default: 10)')
                        .setMinValue(0)
                        .setMaxValue(100000)
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('language')
                .setDescription('Set the language Astra uses for member-facing messages in this server')
                .addStringOption(option =>
                    option.setName('language')
                        .setDescription('Language')
                        .setRequired(true)
                        .addChoices(
                            { name: 'English', value: 'en' },
                            { name: 'Português (Brasil)', value: 'pt-br' }
                        ))
        ),

    // --- SLASH COMMAND HANDLER ---
    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false);
        const group = interaction.options.getSubcommandGroup(false);

        if (group === 'admins') {
            return this.handleAdminsSubcommand(interaction, sub);
        }

        if (group === 'artist-roles') {
            return this.handleArtistRolesSubcommand(interaction, sub);
        }

        if (group === 'level-roles') {
            return this.handleLevelRolesSubcommand(interaction, sub);
        }

        if (sub === 'leveling') {
            return this.handleLevelingSubcommand(interaction);
        }

        if (sub === 'fun') {
            return this.handleFunSubcommand(interaction);
        }

        if (sub === 'economy') {
            return this.handleEconomySubcommand(interaction);
        }

        if (sub === 'language') {
            return this.handleLanguageSubcommand(interaction);
        }

        if (sub === 'verification') {
            return this.handleVerificationSubcommand(interaction);
        }

        if (sub === 'antiscam') {
            return this.handleAntiscamSubcommand(interaction);
        }

        if (sub === 'tickets') {
            return this.handleTicketsSubcommand(interaction);
        }

        if (sub === 'welcome') {
            return this.handleWelcomeSubcommand(interaction);
        }

        if (sub === 'leave') {
            return this.handleLeaveSubcommand(interaction);
        }
    },

    async handleWelcomeSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const messageRaw = interaction.options.getString('message');
        const message = messageRaw ? messageRaw.replace(/\\n/g, '\n') : null;
        const card = interaction.options.getBoolean('card');

        try {
            const existing = await getSettings(guildId);
            const channelId = channel ? channel.id : (existing ? existing.welcome_channel_id : null);

            if (enabled && !channelId) {
                return interaction.reply({ content: '❌ Pick a `channel` the first time you enable welcome messages.', ephemeral: true });
            }

            await db.query(`
                INSERT INTO guild_settings (guild_id, welcome_enabled, welcome_channel_id, welcome_message, welcome_card_enabled)
                VALUES ($1, $2, $3, COALESCE($4, 'Welcome {user} to **{server}**! You''re member #{membercount}.'), COALESCE($5, TRUE))
                ON CONFLICT (guild_id) DO UPDATE SET
                    welcome_enabled = EXCLUDED.welcome_enabled,
                    welcome_channel_id = COALESCE($3, guild_settings.welcome_channel_id),
                    welcome_message = COALESCE($4, guild_settings.welcome_message),
                    welcome_card_enabled = COALESCE($5, guild_settings.welcome_card_enabled);
            `, [guildId, enabled, channelId, message, card]);

            await logAction(interaction.guild, `⚙️ ${interaction.user} ${enabled ? 'enabled' : 'disabled'} public welcome messages${channel ? ` in ${channel}` : ''}.`);

            if (!enabled) {
                return interaction.reply({ content: '✅ Public welcome messages turned off.', ephemeral: true });
            }
            return interaction.reply({ content: `✅ Welcome messages enabled in <#${channelId}>.`, ephemeral: true });
        } catch (error) {
            console.error('❌ Error saving welcome settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
        }
    },

    async handleLevelingSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const messageRaw = interaction.options.getString('message');
        const message = messageRaw ? messageRaw.replace(/\\n/g, '\n') : null;
        const cooldown = interaction.options.getInteger('cooldown_seconds');
        const xpMin = interaction.options.getInteger('xp_min');
        const xpMax = interaction.options.getInteger('xp_max');

        if (xpMin && xpMax && xpMin > xpMax) {
            return interaction.reply({ content: '❌ `xp_min` can\'t be greater than `xp_max`.', ephemeral: true });
        }

        try {
            await db.query(`
                INSERT INTO guild_settings (guild_id, leveling_enabled, levelup_channel_id, levelup_message, xp_cooldown_seconds, xp_min, xp_max)
                VALUES ($1, $2, $3, COALESCE($4, '🎉 {user} just reached **Level {level}**!'), COALESCE($5, 60), COALESCE($6, 15), COALESCE($7, 25))
                ON CONFLICT (guild_id) DO UPDATE SET
                    leveling_enabled = EXCLUDED.leveling_enabled,
                    levelup_channel_id = COALESCE($3, guild_settings.levelup_channel_id),
                    levelup_message = COALESCE($4, guild_settings.levelup_message),
                    xp_cooldown_seconds = COALESCE($5, guild_settings.xp_cooldown_seconds),
                    xp_min = COALESCE($6, guild_settings.xp_min),
                    xp_max = COALESCE($7, guild_settings.xp_max);
            `, [guildId, enabled, channel ? channel.id : null, message, cooldown, xpMin, xpMax]);

            await logAction(interaction.guild, `⚙️ ${interaction.user} ${enabled ? 'enabled' : 'disabled'} the leveling system.`);
            return interaction.reply({ content: `✅ Leveling system ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
        } catch (error) {
            console.error('❌ Error saving leveling settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
        }
    },

    async handleLevelRolesSubcommand(interaction, sub) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const guildId = interaction.guild.id;

        if (sub === 'add') {
            const level = interaction.options.getInteger('level');
            const role = interaction.options.getRole('role');
            try {
                await db.query(
                    `INSERT INTO guild_level_roles (guild_id, level, role_id) VALUES ($1, $2, $3)
                     ON CONFLICT (guild_id, level) DO UPDATE SET role_id = $3`,
                    [guildId, level, role.id]
                );
                await logAction(interaction.guild, `⚙️ ${interaction.user} set ${role} as the reward for reaching level ${level}.`);
                return interaction.reply({ content: `✅ Members who reach **Level ${level}** will now automatically get ${role}.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error adding level role:', error);
                return interaction.reply({ content: '❌ Database error while saving the role reward.', ephemeral: true });
            }
        }

        if (sub === 'remove') {
            const level = interaction.options.getInteger('level');
            try {
                await db.query('DELETE FROM guild_level_roles WHERE guild_id = $1 AND level = $2', [guildId, level]);
                await logAction(interaction.guild, `⚙️ ${interaction.user} removed the role reward for level ${level}.`);
                return interaction.reply({ content: `✅ Level ${level} no longer grants a role automatically.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error removing level role:', error);
                return interaction.reply({ content: '❌ Database error while removing the role reward.', ephemeral: true });
            }
        }

        if (sub === 'list') {
            try {
                const { rows } = await db.query('SELECT level, role_id FROM guild_level_roles WHERE guild_id = $1 ORDER BY level ASC', [guildId]);
                if (rows.length === 0) {
                    return interaction.reply({ content: 'No level-role rewards configured yet.', ephemeral: true });
                }
                const list = rows.map(r => `Level ${r.level} → <@&${r.role_id}>`).join('\n');
                return interaction.reply({ content: `**Level-role rewards:**\n${list}`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error listing level roles:', error);
                return interaction.reply({ content: '❌ Database error while listing role rewards.', ephemeral: true });
            }
        }
    },

    async handleFunSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const enabled = interaction.options.getBoolean('enabled');

        try {
            await db.query(
                `INSERT INTO guild_settings (guild_id, mention_replies_enabled) VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET mention_replies_enabled = $2`,
                [interaction.guild.id, enabled]
            );
            await logAction(interaction.guild, `⚙️ ${interaction.user} ${enabled ? 'enabled' : 'disabled'} Astra's mention/name replies.`);
            return interaction.reply({ content: `✅ Astra will ${enabled ? 'now' : 'no longer'} reply when @mentioned or called by name.`, ephemeral: true });
        } catch (error) {
            console.error('❌ Error saving fun settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
        }
    },

    async handleEconomySubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const enabled = interaction.options.getBoolean('enabled');
        const currencyName = interaction.options.getString('currency_name');
        const currencySymbol = interaction.options.getString('currency_symbol');
        const dailyMin = interaction.options.getInteger('daily_min');
        const dailyMax = interaction.options.getInteger('daily_max');
        const streakBonus = interaction.options.getInteger('daily_streak_bonus');

        if (dailyMin && dailyMax && dailyMin > dailyMax) {
            return interaction.reply({ content: '❌ `daily_min` can\'t be greater than `daily_max`.', ephemeral: true });
        }

        try {
            await db.query(`
                INSERT INTO guild_settings (guild_id, economy_enabled, currency_name, currency_symbol, daily_min, daily_max, daily_streak_bonus)
                VALUES ($1, $2, COALESCE($3, 'Coins'), COALESCE($4, '🪙'), COALESCE($5, 50), COALESCE($6, 150), COALESCE($7, 10))
                ON CONFLICT (guild_id) DO UPDATE SET
                    economy_enabled = EXCLUDED.economy_enabled,
                    currency_name = COALESCE($3, guild_settings.currency_name),
                    currency_symbol = COALESCE($4, guild_settings.currency_symbol),
                    daily_min = COALESCE($5, guild_settings.daily_min),
                    daily_max = COALESCE($6, guild_settings.daily_max),
                    daily_streak_bonus = COALESCE($7, guild_settings.daily_streak_bonus);
            `, [guildId, enabled, currencyName, currencySymbol, dailyMin, dailyMax, streakBonus]);

            await logAction(interaction.guild, `⚙️ ${interaction.user} ${enabled ? 'enabled' : 'disabled'} the economy system.`);
            return interaction.reply({ content: `✅ Economy system ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
        } catch (error) {
            console.error('❌ Error saving economy settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
        }
    },

    async handleLeaveSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const messageRaw = interaction.options.getString('message');
        const message = messageRaw ? messageRaw.replace(/\\n/g, '\n') : null;

        try {
            const existing = await getSettings(guildId);
            const channelId = channel ? channel.id : (existing ? existing.leave_channel_id : null);

            if (enabled && !channelId) {
                return interaction.reply({ content: '❌ Pick a `channel` the first time you enable leave messages.', ephemeral: true });
            }

            await db.query(`
                INSERT INTO guild_settings (guild_id, leave_enabled, leave_channel_id, leave_message)
                VALUES ($1, $2, $3, COALESCE($4, '**{username}** has left the server. We''re now at {membercount} members.'))
                ON CONFLICT (guild_id) DO UPDATE SET
                    leave_enabled = EXCLUDED.leave_enabled,
                    leave_channel_id = COALESCE($3, guild_settings.leave_channel_id),
                    leave_message = COALESCE($4, guild_settings.leave_message);
            `, [guildId, enabled, channelId, message]);

            await logAction(interaction.guild, `⚙️ ${interaction.user} ${enabled ? 'enabled' : 'disabled'} leave messages${channel ? ` in ${channel}` : ''}.`);

            if (!enabled) {
                return interaction.reply({ content: '✅ Leave messages turned off.', ephemeral: true });
            }
            return interaction.reply({ content: `✅ Leave messages enabled in <#${channelId}>.`, ephemeral: true });
        } catch (error) {
            console.error('❌ Error saving leave settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
        }
    },

    async handleTicketsSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const ticketChannel = interaction.options.getChannel('ticket_channel');
        const ticketCategory = interaction.options.getChannel('ticket_category');
        const logChannel = interaction.options.getChannel('log_channel');
        const artistSetupCategory = interaction.options.getChannel('artist_setup_category');

        try {
            await db.query(`
                INSERT INTO guild_settings (guild_id, ticket_channel_id, ticket_category_id, log_channel_id, artist_setup_category_id)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (guild_id) DO UPDATE SET
                    ticket_channel_id = EXCLUDED.ticket_channel_id,
                    ticket_category_id = EXCLUDED.ticket_category_id,
                    log_channel_id = COALESCE(EXCLUDED.log_channel_id, guild_settings.log_channel_id),
                    artist_setup_category_id = COALESCE(EXCLUDED.artist_setup_category_id, guild_settings.artist_setup_category_id);
            `, [guildId, ticketChannel.id, ticketCategory.id, logChannel ? logChannel.id : null, artistSetupCategory ? artistSetupCategory.id : null]);

            const result = await module.exports.postTicketPanel(ticketChannel);
            await logAction(interaction.guild, `⚙️ ${interaction.user} updated ticket settings (panel: ${ticketChannel}, category: ${ticketCategory}).`);

            await interaction.editReply({
                content: `${result.message}\n📁 New tickets will be created under: ${ticketCategory}\n\nNow register artists with \`/artist add\` or \`/config artist-roles add\`, then have them run \`/panel\` to set up their ToS, won't-do list, and pricing.`
            });
        } catch (error) {
            console.error('❌ Database save error:', error);
            await interaction.editReply({ content: '❌ An error occurred while saving ticket configuration.' });
        }
    },

    // --- SHARED: posts the "Open a Ticket" panel to a channel. Used by
    // /config tickets above and the website's "Post Panel to Discord" button.
    async postTicketPanel(ticketChannel) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Open a Commission Ticket')
            .setDescription('Click below and pick an artist to open a private ticket with them.')
            .setColor('#2b2d31')
            .setFooter({ text: 'Astra' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('astra_ticket_open').setLabel('Open a Ticket').setStyle(ButtonStyle.Success)
        );

        await ticketChannel.send({ embeds: [embed], components: [row] });
        return { ok: true, message: `✅ **Ticket panel posted to ${ticketChannel}!**` };
    },

    async handleArtistRolesSubcommand(interaction, sub) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const guildId = interaction.guild.id;

        if (sub === 'add') {
            const role = interaction.options.getRole('role');
            try {
                await db.query(
                    `INSERT INTO guild_artist_roles (guild_id, role_id, added_by) VALUES ($1, $2, $3)
                     ON CONFLICT (guild_id, role_id) DO NOTHING`,
                    [guildId, role.id, interaction.user.id]
                );
                await logAction(interaction.guild, `⚙️ ${interaction.user} gave ${role} automatic artist status.`);
                return interaction.reply({ content: `✅ Anyone with ${role} can now self-manage a commission panel via \`/panel\`.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error adding artist role:', error);
                return interaction.reply({ content: '❌ Database error while adding the role.', ephemeral: true });
            }
        }

        if (sub === 'remove') {
            const role = interaction.options.getRole('role');
            try {
                await db.query('DELETE FROM guild_artist_roles WHERE guild_id = $1 AND role_id = $2', [guildId, role.id]);
                await logAction(interaction.guild, `⚙️ ${interaction.user} revoked automatic artist status from ${role}.`);
                return interaction.reply({ content: `✅ ${role} no longer grants automatic artist status.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error removing artist role:', error);
                return interaction.reply({ content: '❌ Database error while removing the role.', ephemeral: true });
            }
        }

        if (sub === 'list') {
            try {
                const { rows } = await db.query('SELECT role_id FROM guild_artist_roles WHERE guild_id = $1', [guildId]);
                if (rows.length === 0) {
                    return interaction.reply({ content: 'No artist roles configured — artists must be added individually via `/artist add`.', ephemeral: true });
                }
                const list = rows.map(r => `<@&${r.role_id}>`).join('\n');
                return interaction.reply({ content: `**Roles that grant automatic artist status:**\n${list}`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error listing artist roles:', error);
                return interaction.reply({ content: '❌ Database error while listing roles.', ephemeral: true });
            }
        }
    },

    async handleAntiscamSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({
                content: '❌ You need Administrator permission or an Astra-authorized role to do this.',
                ephemeral: true
            });
        }

        const guildId = interaction.guild.id;
        const enabled = interaction.options.getBoolean('enabled');
        const action = interaction.options.getString('action') ?? 'log';
        const minAgeHours = interaction.options.getInteger('min_age_hours') ?? 24;
        const requireNoAvatar = interaction.options.getBoolean('require_no_avatar') ?? true;

        try {
            await db.query(`
                INSERT INTO guild_settings (guild_id, antiscam_enabled, antiscam_action, antiscam_min_age_hours, antiscam_require_no_avatar)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (guild_id)
                DO UPDATE SET
                    antiscam_enabled = EXCLUDED.antiscam_enabled,
                    antiscam_action = EXCLUDED.antiscam_action,
                    antiscam_min_age_hours = EXCLUDED.antiscam_min_age_hours,
                    antiscam_require_no_avatar = EXCLUDED.antiscam_require_no_avatar;
            `, [guildId, enabled, action, minAgeHours, requireNoAvatar]);

            if (!enabled) {
                await logAction(interaction.guild, `⚙️ ${interaction.user} turned off anti-scam checks.`);
                return interaction.reply({ content: '✅ Anti-scam checks turned off.', ephemeral: true });
            }

            const avatarNote = requireNoAvatar ? ', with no custom avatar,' : '';
            const actionNote = action === 'kick' ? 'kicked automatically' : 'flagged in your log channel for review';
            await logAction(interaction.guild, `⚙️ ${interaction.user} enabled anti-scam checks (accounts under ${minAgeHours}h${avatarNote} will be ${actionNote}).`);
            return interaction.reply({
                content: `✅ Anti-scam checks enabled. Accounts younger than ${minAgeHours}h${avatarNote} will be ${actionNote}.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('❌ Error saving antiscam settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
        }
    },

    async handleLanguageSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const language = interaction.options.getString('language');
        try {
            await db.query(
                `INSERT INTO guild_settings (guild_id, language) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET language = $2`,
                [interaction.guild.id, language]
            );
            const label = language === 'pt-br' ? 'Português (Brasil)' : 'English';
            await logAction(interaction.guild, `🌐 ${interaction.user} changed Astra's language to ${label}.`);
            return interaction.reply({ content: `✅ Astra will now use **${label}** for member-facing messages in this server.`, ephemeral: true });
        } catch (error) {
            console.error('❌ Error saving language:', error);
            return interaction.reply({ content: '❌ Database error while saving.', ephemeral: true });
        }
    },

    async handleVerificationSubcommand(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({
                content: '❌ You need Administrator permission or an Astra-authorized role to do this. Ask a server admin to run `/config admins add`.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const verifyChannel = interaction.options.getChannel('verify_channel');
        const memberRole = interaction.options.getRole('member_role');
        const rulesChannel = interaction.options.getChannel('rules_channel');
        const rulesRole = interaction.options.getRole('rules_role');
        const verifyRole = interaction.options.getRole('verify_role');
        const logChannel = interaction.options.getChannel('log_channel');
        const logChannelId = logChannel ? logChannel.id : null;
        const autoKick = interaction.options.getBoolean('auto_kick') ?? false;
        const autoKickDays = interaction.options.getInteger('auto_kick_days') ?? 2;

        // The two-step gate only makes sense if all three pieces are present.
        // If someone provides rules_channel without both roles (or vice
        // versa), that's a config mistake — reject it clearly instead of
        // silently running in a half-configured state.
        const dualRolePieces = [rulesChannel, rulesRole, verifyRole].filter(Boolean).length;
        if (dualRolePieces > 0 && dualRolePieces < 3) {
            return interaction.editReply({
                content: '❌ To enable the two-step gate, you must set `rules_channel`, `rules_role`, AND `verify_role` together. Leave all three out to use single-step verification instead.'
            });
        }

        const title = interaction.options.getString('title') || '🔒 Verification System — Astra';
        const descriptionRaw = interaction.options.getString('description') ||
            (rulesChannel
                ? 'You\'ve accepted the rules — click below to finish verifying.'
                : 'To ensure server security and unlock all channels, click the **Verify** button below.');
        const description = descriptionRaw.replace(/\\n/g, '\n');

        try {
            const joinLeaveLogs = interaction.options.getBoolean('joinleave_logs') ?? true;

            await db.query(`
                INSERT INTO guild_settings (
                    guild_id, verify_channel_id, member_role_id, log_channel_id,
                    embed_title, embed_description, rules_channel_id, rules_role_id, verify_role_id,
                    auto_kick_enabled, auto_kick_days, joinleave_log_enabled
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (guild_id)
                DO UPDATE SET 
                    verify_channel_id = EXCLUDED.verify_channel_id,
                    member_role_id = EXCLUDED.member_role_id,
                    log_channel_id = EXCLUDED.log_channel_id,
                    embed_title = EXCLUDED.embed_title,
                    embed_description = EXCLUDED.embed_description,
                    rules_channel_id = EXCLUDED.rules_channel_id,
                    rules_role_id = EXCLUDED.rules_role_id,
                    verify_role_id = EXCLUDED.verify_role_id,
                    auto_kick_enabled = EXCLUDED.auto_kick_enabled,
                    auto_kick_days = EXCLUDED.auto_kick_days,
                    joinleave_log_enabled = EXCLUDED.joinleave_log_enabled;
            `, [
                guildId, verifyChannel.id, memberRole.id, logChannelId,
                title, description,
                rulesChannel ? rulesChannel.id : null,
                rulesRole ? rulesRole.id : null,
                verifyRole ? verifyRole.id : null,
                autoKick, autoKickDays, joinLeaveLogs
            ]);

            const result = await module.exports.postVerificationPanel(interaction.guild, {
                verify_channel_id: verifyChannel.id, member_role_id: memberRole.id,
                embed_title: title, embed_description: description,
                rules_channel_id: rulesChannel ? rulesChannel.id : null,
                rules_role_id: rulesRole ? rulesRole.id : null,
                verify_role_id: verifyRole ? verifyRole.id : null,
            });

            let replyContent = result.message;
            if (autoKick) {
                replyContent += `\n⏱️ Auto-kick enabled — members without ${memberRole} after ${autoKickDays} day(s) will be removed (bots and admins are exempt).`;
            }

            await logAction(interaction.guild, `⚙️ ${interaction.user} updated verification settings (final role: ${memberRole}).`);
            await interaction.editReply({ content: replyContent });

        } catch (error) {
            console.error('❌ Database save error:', error);
            await interaction.editReply({ content: '❌ An error occurred while saving configurations to the database.' });
        }
    },

    // --- SHARED: actually posts the verification panel message(s) to Discord.
    // Used by the /config verification command above, AND by the website's
    // "Post Panel to Discord" button (index.js) — previously the website
    // only ever saved settings to the database and never actually sent
    // anything to Discord, which is what made "setup via the site" feel
    // broken even though the data was technically saved correctly.
    async postVerificationPanel(guild, settings) {
        const lang = settings.language || 'en';
        const verifyChannel = await guild.channels.fetch(settings.verify_channel_id).catch(() => null);
        if (!verifyChannel) return { ok: false, message: '❌ Could not find the verify channel — check it still exists.' };

        const title = settings.embed_title || '🔒 Verification System — Astra';
        const description = settings.embed_description || 'To ensure server security and unlock all channels, click the **Verify** button below.';

        if (settings.rules_channel_id && settings.rules_role_id && settings.verify_role_id) {
            const rulesChannel = await guild.channels.fetch(settings.rules_channel_id).catch(() => null);
            if (!rulesChannel) return { ok: false, message: '❌ Could not find the rules channel — check it still exists.' };

            const rulesEmbed = new EmbedBuilder()
                .setTitle(t(lang, 'panel.rules_title'))
                .setDescription(t(lang, 'panel.rules_description'))
                .setColor('#2b2d31')
                .setFooter({ text: t(lang, 'panel.step1_footer') });

            const rulesRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('astra_rules_accept').setLabel(t(lang, 'panel.i_agree')).setStyle(ButtonStyle.Secondary)
            );
            await rulesChannel.send({ embeds: [rulesEmbed], components: [rulesRow] });

            const verifyInstructions = new EmbedBuilder()
                .setTitle(title)
                .setDescription(`${description}\n\n${t(lang, 'panel.step2_instructions')}`)
                .setColor('#2b2d31')
                .setFooter({ text: t(lang, 'panel.step2_footer') });
            await verifyChannel.send({ embeds: [verifyInstructions] });

            return { ok: true, message: `✅ **Verification panels posted!**\n📜 Chat A (button) sent to: ${rulesChannel}\n💬 Chat B (types \`!verify\`) sent to: ${verifyChannel}` };
        }

        const verifyEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor('#2b2d31')
            .setFooter({ text: 'Astra' });

        const verifyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('member_verify_button').setLabel(t(lang, 'panel.verify_button')).setStyle(ButtonStyle.Success)
        );
        await verifyChannel.send({ embeds: [verifyEmbed], components: [verifyRow] });

        return { ok: true, message: `✅ **Verify panel posted to ${verifyChannel}!**` };
    },

    async handleAdminsSubcommand(interaction, sub) {
        // Deliberately gated by isServerAdministrator, not isAstraAdmin — see
        // permissions.js. Only real Administrators/the owner can decide who
        // else gets to configure Astra, so a role can never grant itself or
        // others more access than it was given.
        if (!(await isServerAdministrator(interaction.member))) {
            return interaction.reply({
                content: '❌ Only server Administrators (or the server owner) can manage who has access to configure Astra.',
                ephemeral: true
            });
        }

        const guildId = interaction.guild.id;

        if (sub === 'add') {
            const role = interaction.options.getRole('role');
            try {
                await db.query(
                    `INSERT INTO guild_admin_roles (guild_id, role_id, added_by) VALUES ($1, $2, $3)
                     ON CONFLICT (guild_id, role_id) DO NOTHING`,
                    [guildId, role.id, interaction.user.id]
                );
                await logAction(interaction.guild, `🔐 ${interaction.user} granted ${role} permission to configure Astra.`);
                return interaction.reply({ content: `✅ ${role} can now configure Astra (\`/config verification\`).`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error adding admin role:', error);
                return interaction.reply({ content: '❌ Database error while adding the role.', ephemeral: true });
            }
        }

        if (sub === 'remove') {
            const role = interaction.options.getRole('role');
            try {
                await db.query('DELETE FROM guild_admin_roles WHERE guild_id = $1 AND role_id = $2', [guildId, role.id]);
                await logAction(interaction.guild, `🔐 ${interaction.user} revoked ${role}'s permission to configure Astra.`);
                return interaction.reply({ content: `✅ ${role} can no longer configure Astra.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error removing admin role:', error);
                return interaction.reply({ content: '❌ Database error while removing the role.', ephemeral: true });
            }
        }

        if (sub === 'list') {
            try {
                const { rows } = await db.query('SELECT role_id FROM guild_admin_roles WHERE guild_id = $1', [guildId]);
                if (rows.length === 0) {
                    return interaction.reply({ content: 'No roles are currently authorized — only real Administrators can configure Astra right now.', ephemeral: true });
                }
                const list = rows.map(r => `<@&${r.role_id}>`).join('\n');
                return interaction.reply({ content: `**Roles authorized to configure Astra:**\n${list}`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error listing admin roles:', error);
                return interaction.reply({ content: '❌ Database error while listing roles.', ephemeral: true });
            }
        }
    },

    // --- BUTTON INTERACTIONS HANDLER ---
    async handleButton(interaction) {
        const guild = interaction.guild;

        // ACTION: RULES "I Agree" BUTTON (Role A)
        if (interaction.customId === 'astra_rules_accept') {
            try {
                const settings = await getSettings(guild.id);
                if (!settings || !settings.rules_role_id) {
                    return interaction.reply({ content: "Server not configured.", ephemeral: true });
                }

                const member = interaction.member;

                // Already fully verified — nothing to do. This is the actual
                // fix for "the button should know I'm done": Discord buttons
                // can't be disabled per-user (the message is shared by
                // everyone who can see the channel), so instead of trying to
                // grey it out, we just short-circuit here before touching
                // any roles again.
                if (settings.member_role_id && member.roles.cache.has(settings.member_role_id)) {
                    return interaction.reply({ content: t(settings.language, 'verify.already_verified'), ephemeral: true });
                }

                if (!member.roles.cache.has(settings.rules_role_id)) {
                    await member.roles.add(settings.rules_role_id);
                }

                const fullyVerified = await checkAndGrantFinalRole(member, settings);

                if (fullyVerified) {
                    return interaction.reply({ content: t(settings.language, 'verify.you_are_verified'), ephemeral: true });
                }

                const verifyChannelMention = settings.verify_channel_id ? `<#${settings.verify_channel_id}>` : 'the verification channel';
                return interaction.reply({ content: t(settings.language, 'verify.go_to_verify_channel', { channel: verifyChannelMention }), ephemeral: true });
            } catch (error) {
                console.error(error);
                if (!interaction.replied) await interaction.reply({ content: "Error while processing your request.", ephemeral: true });
            }
            return;
        }

        // ACTION: VERIFY BUTTON (Role B, or legacy direct grant)
        if (interaction.customId === 'member_verify_button') {
            try {
                const settings = await getSettings(guild.id);

                if (!settings || !settings.member_role_id) {
                    return interaction.reply({ content: "Server not configured.", ephemeral: true });
                }

                const member = interaction.member;

                // Already fully verified — same short-circuit as the rules
                // button, for servers still on legacy single-step mode too.
                if (member.roles.cache.has(settings.member_role_id)) {
                    return interaction.reply({ content: t(settings.language, 'verify.already_verified'), ephemeral: true });
                }

                // Legacy single-step mode: no dual-role gate configured, so
                // the verify button grants the final role directly.
                if (!settings.rules_role_id || !settings.verify_role_id) {
                    if (!member.roles.cache.has(settings.member_role_id)) {
                        await member.roles.add(settings.member_role_id);
                    }
                    return interaction.reply({ content: "Verified", ephemeral: true });
                }

                // Two-step mode
                if (!member.roles.cache.has(settings.verify_role_id)) {
                    await member.roles.add(settings.verify_role_id);
                }

                const fullyVerified = await checkAndGrantFinalRole(member, settings);

                if (fullyVerified) {
                    return interaction.reply({ content: t(settings.language, 'verify.you_are_verified'), ephemeral: true });
                }

                const rulesChannelMention = settings.rules_channel_id ? `<#${settings.rules_channel_id}>` : 'the rules channel';
                return interaction.reply({ content: t(settings.language, 'verify.go_to_rules_channel', { channel: rulesChannelMention }), ephemeral: true });
            } catch (error) {
                console.error(error);
                if (!interaction.replied) await interaction.reply({ content: "Error during verification.", ephemeral: true });
            }
            return;
        }
    },

    async handleMenu(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "This menu isn't wired up yet.", ephemeral: true }).catch(() => {});
        }
    },

    // --- CHAT B MESSAGE MODERATION ("!verify" only) ---
    // Called from index.js on messageCreate. Only acts inside the configured
    // verify_channel, and only when rules_channel is also set (dual-role
    // mode) — in legacy single-step mode, verify_channel still uses the
    // button, so it's left alone here. Needs the bot to have Manage Messages
    // in that channel to delete other members' messages.
    async executeMessage(message) {
        const settings = await getSettings(message.guild.id);
        if (!settings || !settings.rules_channel_id || !settings.verify_role_id) return;
        if (message.channel.id !== settings.verify_channel_id) return;

        const isVerifyCommand = message.content.trim().toLowerCase() === '!verify';

        if (!isVerifyCommand) {
            await message.delete().catch(() => {});
            const warning = await message.channel.send(t(settings.language, 'verify.type_verify_warning', { user: message.author.toString() })).catch(() => null);
            if (warning) setTimeout(() => warning.delete().catch(() => {}), 5000);
            return;
        }

        try {
            const member = message.member;

            // Same short-circuit as the buttons — if they somehow still have
            // access to this channel after being fully verified, don't
            // re-process anything.
            if (settings.member_role_id && member.roles.cache.has(settings.member_role_id)) {
                await message.delete().catch(() => {});
                const already = await message.channel.send(t(settings.language, 'verify.already_verified', {}) + ` ${member}`).catch(() => null);
                if (already) setTimeout(() => already.delete().catch(() => {}), 5000);
                return;
            }

            if (!member.roles.cache.has(settings.verify_role_id)) {
                await member.roles.add(settings.verify_role_id);
            }

            const fullyVerified = await checkAndGrantFinalRole(member, settings);
            await message.delete().catch(() => {});

            const confirmation = await message.channel.send(
                fullyVerified
                    ? t(settings.language, 'verify.welcome', { user: member.toString() })
                    : t(settings.language, 'verify.step2_done_wait_step1', { user: member.toString(), rulesChannel: `<#${settings.rules_channel_id}>` })
            ).catch(() => null);
            if (confirmation) setTimeout(() => confirmation.delete().catch(() => {}), 8000);
        } catch (error) {
            console.error('❌ Error handling !verify:', error);
        }
    },

    // --- AUTO-KICK SWEEP ---
    // Called on an interval from index.js. Removes members who joined more
    // than auto_kick_days ago and still don't hold the final member_role —
    // i.e. never finished verification. Bots, the server owner, and anyone
    // with Astra access (real Administrators or an authorized role) are
    // always exempt, regardless of settings.
    async runAutoKickSweep(client) {
        for (const [, guild] of client.guilds.cache) {
            try {
                const settings = await getSettings(guild.id);
                if (!settings || !settings.auto_kick_enabled || !settings.member_role_id) continue;

                const days = settings.auto_kick_days || 2;
                const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

                const members = await guild.members.fetch();
                const logChannel = settings.log_channel_id
                    ? await guild.channels.fetch(settings.log_channel_id).catch(() => null)
                    : null;

                for (const [, member] of members) {
                    if (member.user.bot) continue;
                    if (member.id === guild.ownerId) continue;
                    if (member.roles.cache.has(settings.member_role_id)) continue;
                    if (!member.joinedTimestamp || member.joinedTimestamp > cutoff) continue;
                    if (await isServerAdministrator(member)) continue;
                    if (await isAstraAdmin(member)) continue;

                    try {
                        await member.kick('Astra: never completed verification within the grace period.');
                        if (logChannel) {
                            await logChannel.send(`👢 Kicked ${member.user.tag} (${member.id}) — never completed verification (joined ${days}+ days ago).`).catch(() => {});
                        }
                    } catch (kickErr) {
                        console.error(`❌ Failed to auto-kick ${member.id} in ${guild.id}:`, kickErr.message);
                    }
                }
            } catch (guildErr) {
                console.error(`❌ Auto-kick sweep failed for guild ${guild.id}:`, guildErr.message);
            }
        }
    },

    // --- ANTI-SCAM CHECK ---
    // Called from index.js on guildMemberAdd, before the welcome ping.
    // Flags the classic scam-bot signature: an account created very recently
    // that also has no custom avatar. Deliberately conservative by default
    // (requires BOTH signals, not just account age alone) since a brand-new
    // Discord account with a default avatar is also just... a new user.
    // Returns true if the member was kicked, so index.js can skip the
    // welcome ping for them.
    async checkScamSignals(member) {
        try {
            const settings = await getSettings(member.guild.id);
            if (!settings || !settings.antiscam_enabled) return false;

            const accountAgeMs = Date.now() - member.user.createdTimestamp;
            const minAgeMs = (settings.antiscam_min_age_hours || 24) * 60 * 60 * 1000;
            const tooNew = accountAgeMs < minAgeMs;
            const hasDefaultAvatar = member.user.avatar === null;

            const suspicious = settings.antiscam_require_no_avatar
                ? (tooNew && hasDefaultAvatar)
                : tooNew;

            if (!suspicious) return false;

            const logChannel = settings.log_channel_id
                ? await member.guild.channels.fetch(settings.log_channel_id).catch(() => null)
                : null;

            const ageHours = Math.round(accountAgeMs / (60 * 60 * 1000));

            if (settings.antiscam_action === 'kick') {
                await member.kick('Astra: flagged as a likely scam/spam account (new account, no avatar).');
                if (logChannel) {
                    await logChannel.send(`🚫 Kicked ${member.user.tag} (${member.id}) on join — account is ${ageHours}h old${hasDefaultAvatar ? ' with no avatar' : ''}.`).catch(() => {});
                }
                return true;
            }

            if (logChannel) {
                await logChannel.send(`⚠️ ${member.user.tag} (${member.id}) just joined and looks suspicious — account is ${ageHours}h old${hasDefaultAvatar ? ', default avatar' : ''}. Review manually.`).catch(() => {});
            }
            return false;
        } catch (error) {
            console.error('❌ Error checking scam signals:', error);
            return false;
        }
    },

    // --- NEW MEMBER WELCOME PING ---
    // Called from index.js on guildMemberAdd. Points brand-new members at
    // the rules channel (or verify channel, if rules isn't configured) right
    // away, since a bot can't force-navigate a user's client to a channel.
    async handleNewMember(member) {
        try {
            const settings = await getSettings(member.guild.id);
            if (!settings) return;

            const targetChannelId = settings.rules_channel_id || settings.verify_channel_id;
            if (!targetChannelId) return;

            const channel = await member.guild.channels.fetch(targetChannelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const nextStep = settings.rules_channel_id
                ? `read the rules and click **I Agree**`
                : `click **Verify**`;

            const welcome = await channel.send(`👋 Welcome ${member}! Please ${nextStep} above to get access to the rest of the server.`);
            // Keep the channel tidy — this is a one-time nudge, not a permanent post.
            setTimeout(() => welcome.delete().catch(() => {}), 30_000);
        } catch (error) {
            console.error('❌ Error sending welcome ping:', error);
        }
    },

    // --- PUBLIC WELCOME MESSAGE ---
    // Called from index.js on guildMemberAdd, alongside (not instead of)
    // handleNewMember's rules/verify nudge and checkScamSignals. This is the
    // member-facing "Loritta-style" welcome post — a permanent message in a
    // dedicated channel the admin picks via /config welcome or the website,
    // separate from the verification flow entirely.
    async sendWelcomeMessage(member) {
        try {
            const settings = await getSettings(member.guild.id);
            if (!settings || !settings.welcome_enabled || !settings.welcome_channel_id) return;

            const channel = await member.guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const template = settings.welcome_message || 'Welcome {user} to **{server}**! You\'re member #{membercount}.';
            const text = fillTemplate(template, {
                user: member.toString(),
                username: member.user.username,
                server: member.guild.name,
                membercount: member.guild.memberCount
            });

            if (settings.welcome_card_enabled === false) {
                await channel.send(text);
                return;
            }

            const embed = new EmbedBuilder()
                .setDescription(text)
                .setColor('#57F287')
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setFooter({ text: `Member #${member.guild.memberCount}` })
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error sending welcome message:', error);
        }
    },

    // --- PUBLIC LEAVE MESSAGE ---
    // Called from index.js on guildMemberRemove. Same deal as above but for
    // departures — separate from the admin-only joinleave_log_enabled log.
    async sendLeaveMessage(member) {
        try {
            const settings = await getSettings(member.guild.id);
            if (!settings || !settings.leave_enabled || !settings.leave_channel_id) return;

            const channel = await member.guild.channels.fetch(settings.leave_channel_id).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const user = member.user;
            const template = settings.leave_message || '**{username}** has left the server. We\'re now at {membercount} members.';
            const text = fillTemplate(template, {
                user: user ? user.toString() : 'Someone',
                username: user ? user.username : 'Someone',
                server: member.guild.name,
                membercount: member.guild.memberCount
            });

            const embed = new EmbedBuilder()
                .setDescription(text)
                .setColor('#ED4245')
                .setTimestamp();
            if (user) embed.setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }));

            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error sending leave message:', error);
        }
    }
};