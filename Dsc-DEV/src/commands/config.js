const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { isServerAdministrator, isAstraAdmin } = require('../permissions');

// Builds the small interactive 2FA setup panel (embed + buttons).
// Used by both /setup (ephemeral) and "!setup 2fa" (a normal message that
// only the invoker can operate).
function buildSetupPanel(twoStepEnabled) {
    const embed = new EmbedBuilder()
        .setTitle('⚙️ Astra — Verification Setup')
        .setDescription(
            'Two-step verification requires users to click the button **and** type `!verify`, ' +
            'which helps filter out simple auto-clicker bots.\n\n' +
            `**Current status:** ${twoStepEnabled ? '🟢 Enabled' : '🔴 Disabled'}`
        )
        .setColor(twoStepEnabled ? '#2ECC71' : '#E74C3C')
        .setFooter({ text: 'Only server admins or Astra-authorized roles can use this panel.' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('astra_2fa_enable')
            .setLabel('Enable 2FA')
            .setStyle(ButtonStyle.Success)
            .setDisabled(twoStepEnabled),
        new ButtonBuilder()
            .setCustomId('astra_2fa_disable')
            .setLabel('Disable 2FA')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!twoStepEnabled)
    );

    return { embeds: [embed], components: [row] };
}

async function getTwoStepStatus(guildId) {
    const { rows } = await db.query('SELECT two_step_enabled FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0]?.two_step_enabled || false;
}

module.exports = {
    buildSetupPanel,
    getTwoStepStatus,

    // --- SLASH COMMAND DATA (/setup) ---
    // Deliberately no setDefaultMemberPermissions here — Astra-authorized
    // roles (tracked in guild_admin_roles) may not hold real Administrator
    // permission, and Discord hides commands restricted that way from anyone
    // lacking the permission, regardless of what our own isAstraAdmin() check
    // says. So the command stays visible to everyone; access is enforced
    // inside executeSetupSlash instead.
    setupData: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Open Astra\'s interactive setup panel (2FA toggle, etc.)'),

    // --- SLASH COMMAND DATA (/config) ---
    // Same reasoning as above: no setDefaultMemberPermissions restriction.
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure Astra channels, roles, and admin access for this server.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('verification')
                .setDescription('Configure the verification system')
                .addChannelOption(option =>
                    option.setName('verify_channel')
                        .setDescription('Channel where the verification button will be placed')
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('member_role')
                        .setDescription('Role granted upon verification')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('log_channel')
                        .setDescription('Channel to log verifications')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Embed title (Optional)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Rules text (Use \\n for a new line. Optional)')
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
    },

    async handleVerificationSubcommand(interaction) {
        // Verification setup is available to true Administrators AND
        // Astra-authorized roles — it's day-to-day config, not access control.
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
        const logChannel = interaction.options.getChannel('log_channel');
        const logChannelId = logChannel ? logChannel.id : null;

        const title = interaction.options.getString('title') || '🔒 Verification System — Astra';
        const descriptionRaw = interaction.options.getString('description') || 'To ensure server security and unlock all channels, click the **Read the Rules** button below.';
        const description = descriptionRaw.replace(/\\n/g, '\n');

        try {
            await db.query(`
                INSERT INTO guild_settings (guild_id, verify_channel_id, member_role_id, log_channel_id, embed_title, embed_description)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (guild_id)
                DO UPDATE SET 
                    verify_channel_id = EXCLUDED.verify_channel_id,
                    member_role_id = EXCLUDED.member_role_id,
                    log_channel_id = EXCLUDED.log_channel_id,
                    embed_title = EXCLUDED.embed_title,
                    embed_description = EXCLUDED.embed_description;
            `, [guildId, verifyChannel.id, memberRole.id, logChannelId, title, description]);

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor('#2b2d31')
                .setFooter({ text: 'Astra Security System' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('member_verify_button')
                    .setLabel('Read the Rules')
                    .setStyle(ButtonStyle.Secondary)
            );

            await verifyChannel.send({ embeds: [embed], components: [row] });

            await interaction.editReply({
                content: `✅ **Astra successfully configured!**\n📍 Panel sent to: ${verifyChannel}\n🛡️ Role defined: ${memberRole}`,
            });

        } catch (error) {
            console.error('❌ Database save error:', error);
            await interaction.editReply({ content: '❌ An error occurred while saving configurations to the database.' });
        }
    },

    async handleAdminsSubcommand(interaction, sub) {
        // FIX/DESIGN NOTE: this is intentionally gated by isServerAdministrator,
        // NOT isAstraAdmin. Only real Administrators/the owner can decide who
        // else gets to configure Astra. If this were gated by isAstraAdmin
        // instead, any role you'd granted access to could add more roles
        // (including itself at a "higher" tier) — that's the privilege
        // escalation this whole feature exists to prevent.
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
                return interaction.reply({ content: `✅ ${role} can now configure Astra (\`/setup\`, \`/config verification\`).`, ephemeral: true });
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

    // --- /setup SLASH COMMAND HANDLER (ephemeral 2FA panel) ---
    async executeSetupSlash(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({
                content: '❌ You need Administrator permission or an Astra-authorized role to do this.',
                ephemeral: true
            });
        }

        const status = await getTwoStepStatus(interaction.guild.id);
        return interaction.reply({ ...buildSetupPanel(status), ephemeral: true });
    },

    // --- "!verify" TEXT COMMAND HANDLER (2FA step 2) ---
    async executeMessage(message) {
        if (message.content.toLowerCase() !== '!verify') return;

        try {
            const { rows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [message.guild.id]);
            if (rows.length === 0 || !rows[0].member_role_id) return;
            if (!rows[0].two_step_enabled) return;

            const { rows: pendingRows } = await db.query(
                'SELECT 1 FROM pending_verifications WHERE guild_id = $1 AND user_id = $2',
                [message.guild.id, message.author.id]
            );

            if (pendingRows.length > 0) {
                const role = await message.guild.roles.fetch(rows[0].member_role_id);
                if (role && !message.member.roles.cache.has(role.id)) {
                    await message.member.roles.add(role);
                }

                await db.query(
                    'DELETE FROM pending_verifications WHERE guild_id = $1 AND user_id = $2',
                    [message.guild.id, message.author.id]
                );

                const reply = await message.reply('Verified');
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                message.delete().catch(() => {});
            } else {
                const reply = await message.reply('You must read and agree to the rules by clicking the button first.');
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                message.delete().catch(() => {});
            }
        } catch (error) {
            console.error(error);
        }
    },

    // --- "!setup 2fa" TEXT COMMAND HANDLER ---
    async executeSetupText(message) {
        if (!(await isAstraAdmin(message.member))) {
            const reply = await message.reply('❌ You need Administrator permission or an Astra-authorized role to do this.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            message.delete().catch(() => {});
            return;
        }

        const status = await getTwoStepStatus(message.guild.id);
        const panelMessage = await message.channel.send(buildSetupPanel(status));
        message.delete().catch(() => {});

        // Only the person who ran the command can operate this panel, and it
        // self-destructs after 60s of inactivity so it doesn't linger in chat.
        const collector = panelMessage.createMessageComponentCollector({ time: 60_000 });

        collector.on('collect', async btnInteraction => {
            if (btnInteraction.user.id !== message.author.id) {
                return btnInteraction.reply({ content: "This panel isn't yours — run `!setup 2fa` yourself.", ephemeral: true });
            }
            await module.exports.handleButton(btnInteraction);
        });

        collector.on('end', () => {
            panelMessage.delete().catch(() => {});
        });
    },

    // --- BUTTON INTERACTIONS HANDLER ---
    async handleButton(interaction) {
        const guild = interaction.guild;
        const user = interaction.user;

        // ACTION: VERIFICATION BUTTON CLICK (public button, anyone can click)
        if (interaction.customId === 'member_verify_button') {
            try {
                const { rows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [guild.id]);

                if (rows.length === 0 || !rows[0].member_role_id) {
                    return interaction.reply({ content: "Server not configured.", ephemeral: true });
                }

                if (rows[0].two_step_enabled) {
                    await db.query(
                        `INSERT INTO pending_verifications (guild_id, user_id) VALUES ($1, $2)
                         ON CONFLICT (guild_id, user_id) DO NOTHING`,
                        [guild.id, user.id]
                    );
                    return interaction.reply({ content: "Step 1 complete. Now type `!verify` in the chat to receive your role.", ephemeral: true });
                } else {
                    const role = await guild.roles.fetch(rows[0].member_role_id);
                    if (!role) return interaction.reply({ content: "Role not found.", ephemeral: true });

                    if (!interaction.member.roles.cache.has(role.id)) {
                        await interaction.member.roles.add(role);
                    }

                    await interaction.reply({ content: "Verified", ephemeral: true });
                }
            } catch (error) {
                console.error(error);
                if (!interaction.replied) await interaction.reply({ content: "Error during verification.", ephemeral: true });
            }
            return;
        }

        // ACTION: 2FA TOGGLE BUTTONS (setup panel — admin-gated)
        if (interaction.customId === 'astra_2fa_enable' || interaction.customId === 'astra_2fa_disable') {
            // Re-check permission at click time, not just when the panel opened —
            // roles can change in between, especially on a long-lived panel.
            if (!(await isAstraAdmin(interaction.member))) {
                return interaction.reply({ content: '❌ You no longer have permission to do this.', ephemeral: true });
            }

            const enable = interaction.customId === 'astra_2fa_enable';
            try {
                await db.query(
                    `INSERT INTO guild_settings (guild_id, two_step_enabled) VALUES ($1, $2)
                     ON CONFLICT (guild_id) DO UPDATE SET two_step_enabled = $2`,
                    [guild.id, enable]
                );

                const status = await getTwoStepStatus(guild.id);
                // interaction.update() works whether the panel came from an
                // ephemeral /setup reply or a normal "!setup 2fa" message.
                await interaction.update(buildSetupPanel(status));
            } catch (error) {
                console.error('❌ Error toggling 2FA:', error);
                if (!interaction.replied) await interaction.reply({ content: '❌ Database error while updating 2FA.', ephemeral: true });
            }
            return;
        }
    },

    async handleMenu(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "This menu isn't wired up yet.", ephemeral: true }).catch(() => {});
        }
    }
};