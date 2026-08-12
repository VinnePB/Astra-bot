const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { isServerAdministrator, isAstraAdmin } = require('../permissions');

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
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
        ),

    // --- SLASH COMMAND HANDLER ---
    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false);
        const group = interaction.options.getSubcommandGroup(false);

        if (group === 'admins') {
            return this.handleAdminsSubcommand(interaction, sub);
        }

        if (sub === 'verification') {
            return this.handleVerificationSubcommand(interaction);
        }

        if (sub === 'antiscam') {
            return this.handleAntiscamSubcommand(interaction);
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
                return interaction.reply({ content: '✅ Anti-scam checks turned off.', ephemeral: true });
            }

            const avatarNote = requireNoAvatar ? ', with no custom avatar,' : '';
            const actionNote = action === 'kick' ? 'kicked automatically' : 'flagged in your log channel for review';
            return interaction.reply({
                content: `✅ Anti-scam checks enabled. Accounts younger than ${minAgeHours}h${avatarNote} will be ${actionNote}.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('❌ Error saving antiscam settings:', error);
            return interaction.reply({ content: '❌ Database error while saving settings.', ephemeral: true });
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
            await db.query(`
                INSERT INTO guild_settings (
                    guild_id, verify_channel_id, member_role_id, log_channel_id,
                    embed_title, embed_description, rules_channel_id, rules_role_id, verify_role_id,
                    auto_kick_enabled, auto_kick_days
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
                    auto_kick_days = EXCLUDED.auto_kick_days;
            `, [
                guildId, verifyChannel.id, memberRole.id, logChannelId,
                title, description,
                rulesChannel ? rulesChannel.id : null,
                rulesRole ? rulesRole.id : null,
                verifyRole ? verifyRole.id : null,
                autoKick, autoKickDays
            ]);

            let replyContent;

            if (rulesChannel) {
                // DUAL-ROLE MODE — Chat A gets the button, Chat B is
                // text-only: no button, just instructions. The actual
                // moderation (deleting off-topic messages, warning users,
                // and granting verify_role_id on "!verify") happens in
                // executeMessage() below, not here.
                const rulesEmbed = new EmbedBuilder()
                    .setTitle('📜 Rules Acknowledgement')
                    .setDescription('By clicking below, you confirm you\'ve read and agree to follow the rules above.')
                    .setColor('#2b2d31')
                    .setFooter({ text: 'Astra Security System — Step 1 of 2' });

                const rulesRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('astra_rules_accept')
                        .setLabel('I Agree')
                        .setStyle(ButtonStyle.Secondary)
                );

                await rulesChannel.send({ embeds: [rulesEmbed], components: [rulesRow] });

                const verifyInstructions = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(`${description}\n\nType \`!verify\` in this channel to complete step 2. Anything else you type here will be removed.`)
                    .setColor('#2b2d31')
                    .setFooter({ text: 'Astra Security System — Step 2 of 2' });

                await verifyChannel.send({ embeds: [verifyInstructions] });

                replyContent = `✅ **Astra successfully configured!**\n📜 Chat A (button) sent to: ${rulesChannel}\n💬 Chat B (types \`!verify\`) sent to: ${verifyChannel}\n🔗 Both ${rulesRole} and ${verifyRole} are required for ${memberRole}.`;
            } else {
                // LEGACY SINGLE-STEP MODE — verify_channel gets a button that
                // grants member_role_id directly. Kept for servers that
                // haven't configured the dual-role gate.
                const verifyEmbed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(description)
                    .setColor('#2b2d31')
                    .setFooter({ text: 'Astra Security System' });

                const verifyRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('member_verify_button')
                        .setLabel('Verify')
                        .setStyle(ButtonStyle.Success)
                );

                await verifyChannel.send({ embeds: [verifyEmbed], components: [verifyRow] });
                replyContent = `✅ **Astra successfully configured!**\n📍 Verify panel sent to: ${verifyChannel}\n🛡️ Final role: ${memberRole}`;
            }

            if (autoKick) {
                replyContent += `\n⏱️ Auto-kick enabled — members without ${memberRole} after ${autoKickDays} day(s) will be removed (bots and admins are exempt).`;
            }

            await interaction.editReply({ content: replyContent });

        } catch (error) {
            console.error('❌ Database save error:', error);
            await interaction.editReply({ content: '❌ An error occurred while saving configurations to the database.' });
        }
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
                    return interaction.reply({ content: "✅ You're already verified — nothing more to do!", ephemeral: true });
                }

                if (!member.roles.cache.has(settings.rules_role_id)) {
                    await member.roles.add(settings.rules_role_id);
                }

                const fullyVerified = await checkAndGrantFinalRole(member, settings);

                if (fullyVerified) {
                    return interaction.reply({ content: "✅ You're verified! Enjoy the server.", ephemeral: true });
                }

                const verifyChannelMention = settings.verify_channel_id ? `<#${settings.verify_channel_id}>` : 'the verification channel';
                return interaction.reply({ content: `✅ Rules accepted. Now head to ${verifyChannelMention} to finish verifying.`, ephemeral: true });
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
                    return interaction.reply({ content: "✅ You're already verified — nothing more to do!", ephemeral: true });
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
                    return interaction.reply({ content: "✅ You're verified! Enjoy the server.", ephemeral: true });
                }

                const rulesChannelMention = settings.rules_channel_id ? `<#${settings.rules_channel_id}>` : 'the rules channel';
                return interaction.reply({ content: `✅ Step complete. Now head to ${rulesChannelMention} and click **I Agree** to finish verifying.`, ephemeral: true });
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
            const warning = await message.channel.send(`Hey ${message.author}, please type \`!verify\` here.`).catch(() => null);
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
                const already = await message.channel.send(`✅ ${member}, you're already verified!`).catch(() => null);
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
                    ? `✅ ${member} is verified! Welcome to the server.`
                    : `✅ ${member}, step 2 complete. Head to <#${settings.rules_channel_id}> and click **I Agree** to finish.`
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
    }
};