const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../database');

// FIX: removed the in-memory `pendingVerifications` Set entirely.
// It reset on every restart/redeploy, which meant users who clicked the
// button (step 1) but hadn't yet typed !verify (step 2) before a restart
// would get stuck in a loop. Pending state now lives in the
// pending_verifications table (created in database.js) and survives restarts.

module.exports = {
    // --- 1. SLASH COMMAND DATA (/config) ---
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure Astra channels and roles for this server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
        ),

    // --- 2. SLASH COMMAND HANDLER ---
    async executeSlash(interaction) {
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

    // --- 3. TEXT COMMAND HANDLER (!setupverify, !verify) ---
    async executeMessage(message) {
        const isOwner = message.author.id === message.guild.ownerId;
        const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

        // ACTION: 2-STEP VERIFICATION COMMAND (!verify)
        if (message.content.toLowerCase() === '!verify') {
            try {
                const { rows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [message.guild.id]);
                if (rows.length === 0 || !rows[0].member_role_id) return;

                if (rows[0].two_step_enabled) {
                    // FIX: check the DB for pending state instead of an in-memory Set
                    const { rows: pendingRows } = await db.query(
                        'SELECT 1 FROM pending_verifications WHERE guild_id = $1 AND user_id = $2',
                        [message.guild.id, message.author.id]
                    );
                    const hasPending = pendingRows.length > 0;

                    if (hasPending) {
                        const role = await message.guild.roles.fetch(rows[0].member_role_id);
                        if (role && !message.member.roles.cache.has(role.id)) {
                            await message.member.roles.add(role);
                        }

                        // FIX: clear pending state in the DB, not a Set
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
                }
            } catch (error) { console.error(error); }
            return;
        }

        if (!isOwner && !isAdmin) return;

        if (message.content === '!setupverify') {
            try {
                const verificationButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('member_verify_button')
                        .setLabel('Read the Rules')
                        .setStyle(ButtonStyle.Secondary)
                );

                const rulesEmbed = new EmbedBuilder()
                    .setTitle('🔐 Verification Gate')
                    .setDescription('By clicking the button below, you confirm that you have read and agree to all the server rules listed above.')
                    .setColor('#2ECC71');

                await message.channel.send({ embeds: [rulesEmbed], components: [verificationButton] });
                try { await message.delete(); } catch (e) {}
            } catch (error) { console.error('❌ Error in !setupverify:', error); }
        }
    },

    // --- 4. BUTTON INTERACTIONS HANDLER ---
    async handleButton(interaction) {
        const guild = interaction.guild;
        const user = interaction.user;

        // ACTION: VERIFICATION BUTTON CLICK
        if (interaction.customId === 'member_verify_button') {
            try {
                const { rows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [guild.id]);

                if (rows.length === 0 || !rows[0].member_role_id) {
                    return interaction.reply({ content: "Server not configured.", ephemeral: true });
                }

                if (rows[0].two_step_enabled) {
                    // FIX: persist pending state to the DB instead of an in-memory Set
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
    },

    // FIX: index.js's interactionCreate handler calls coreFeature.handleMenu(interaction)
    // for select-menu interactions, but this method never existed, so any select-menu
    // interaction would throw "handleMenu is not a function". Added a safe no-op stub —
    // replace with real logic if/when you add a select menu, or remove the call in
    // index.js if you don't use one.
    async handleMenu(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "This menu isn't wired up yet.", ephemeral: true }).catch(() => {});
        }
    }
};