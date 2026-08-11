const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../database'); 

// Armazena temporariamente quem clicou no botão (Step 1)
const pendingVerifications = new Set();

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
        
        const titulo = interaction.options.getString('title') || '🔒 Verification System — Astra';
        const descricaoRaw = interaction.options.getString('description') || 'To ensure server security and unlock all channels, click the **Read the Rules** button below.';
        const descricao = descricaoRaw.replace(/\\n/g, '\n');

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
            `, [guildId, verifyChannel.id, memberRole.id, logChannelId, titulo, descricao]);

            const embed = new EmbedBuilder()
                .setTitle(titulo)
                .setDescription(descricao)
                .setColor('#2b2d31')
                .setFooter({ text: 'Astra Security System' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('botao_verificar_membro')
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

    // --- 3. TEXT COMMAND HANDLER (!setup, !setupverify, !verify) ---
    async executeMessage(message) {
        const eDono = message.author.id === message.guild.ownerId;
        const eAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

        // AÇÃO: COMANDO DE VERIFICAÇÃO 2-STEP (!verify)
        if (message.content.toLowerCase() === '!verify') {
            try {
                const { rows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [message.guild.id]);
                if (rows.length === 0 || !rows[0].member_role_id) return;

                if (rows[0].two_step_enabled) {
                    if (pendingVerifications.has(message.author.id)) {
                        const role = await message.guild.roles.fetch(rows[0].member_role_id);
                        if (role && !message.member.roles.cache.has(role.id)) {
                            await message.member.roles.add(role);
                        }
                        
                        pendingVerifications.delete(message.author.id);
                        
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

        if (!eDono && !eAdmin) return;

        if (message.content === '!setup') {
            try {
                const botaoTicket = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('abrir_ticket_comissao')
                        .setLabel('📩 Open Ticket')
                        .setStyle(ButtonStyle.Primary)
                );

                const embedPainel = new EmbedBuilder()
                    .setTitle('🎨 v14rtz Commissions — Order Here')
                    .setDescription('Ready to request a headshot or PFP? Click the button below to open a private ticket and discuss your order directly!')
                    .setColor('#5865F2');

                await message.channel.send({ embeds: [embedPainel], components: [botaoTicket] });
                try { await message.delete(); } catch (e) {}
            } catch (error) { console.error('❌ Error in !setup:', error); }
        }

        if (message.content === '!setupverify') {
            try {
                const botaoVerificar = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('botao_verificar_membro')
                        .setLabel('Read the Rules')
                        .setStyle(ButtonStyle.Secondary)
                );

                const embedRegras = new EmbedBuilder()
                    .setTitle('🔐 Verification Gate')
                    .setDescription('By clicking the button below, you confirm that you have read and agree to all the server rules listed above.')
                    .setColor('#2ECC71');

                await message.channel.send({ embeds: [embedRegras], components: [botaoVerificar] });
                try { await message.delete(); } catch (e) {}
            } catch (error) { console.error('❌ Error in !setupverify:', error); }
        }
    },

    // --- 4. BUTTON INTERACTIONS HANDLER ---
    async handleButton(interaction) {
        const guild = interaction.guild;
        const user = interaction.user;

        // AÇÃO: CLIQUE NO BOTÃO DE VERIFICAÇÃO
        if (interaction.customId === 'member_verify_button') {
            try {
                const { rows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [guild.id]);
                
                if (rows.length === 0 || !rows[0].member_role_id) {
                    return interaction.reply({ content: "Server not configured.", ephemeral: true });
                }

                if (rows[0].two_step_enabled) {
                    pendingVerifications.add(user.id);
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

        // AÇÃO: ABRIR TICKET
        if (interaction.customId === 'abrir_ticket_comissao') {
            try { await interaction.deferReply({ ephemeral: true }); } catch (e) { return; }

            try {
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }
                    ],
                });

                const menuInfo = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('menu_info_ticket')
                        .setPlaceholder('📖 Select information you want to view...')
                        .addOptions(
                            new StringSelectMenuOptionBuilder().setLabel('Main Info & Guidelines').setValue('info_main').setDescription('General guidelines for Roblox avatars, OCs and Furries.').setEmoji('📋'),
                            new StringSelectMenuOptionBuilder().setLabel('Prices (Robux)').setValue('info_robux').setDescription('Prices for Lineart and Colored pieces via Roblox transfers.').setEmoji('🪙'),
                            new StringSelectMenuOptionBuilder().setLabel('Prices (USD / Cash)').setValue('info_usd').setDescription('Prices via Ko-fi or Stripe.').setEmoji('💵'),
                            new StringSelectMenuOptionBuilder().setLabel('Terms of Service & Rules').setValue('info_tos').setDescription('Turnaround policy, refunds, special offers and limits.').setEmoji('⚖️')
                        )
                );

                const botaoFechar = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('fechar_ticket_canal').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
                );

                const embedBoasVindas = new EmbedBuilder()
                    .setTitle(`🎨 Welcome to your Commission Ticket!`)
                    .setDescription(`Hello ${user}! To make our process smooth and organized, please follow the steps below:\n\n` +
                                    `🛠️ **How this ticket works:**\n` +
                                    `1️⃣ Use the **dropdown menu below** to browse through prices (Robux/USD), terms of service, and rules.\n` +
                                    `2️⃣ Once you choose your preferred payment method and style, **type your order details here** in the chat.\n` +
                                    `3️⃣ Send your character reference sheets, screenshots, and guidelines so I can review them!\n\n` +
                                    `📢 **Current Availability:**\n` +
                                    `> Only **Headshots / Profile Pictures (PFPs)** are available at this time. Waist-up and Full-body options are currently closed.`)
                    .addFields(
                        { name: '🤖 Roblox Avatars', value: '• Provide official Username.\n• Send screenshots from multiple PoVs.\n• Overly cluttered avatars will not be accepted.', inline: false },
                        { name: '🐾 OCs & Furries', value: '• Furry/anthro designs are welcome!\n• Provide character reference sheets.\n• Specify desired poses/expressions clearly.', inline: false }
                    )
                    .setColor('#5865F2');

                try {
                    await ticketChannel.send({ content: `${user}`, embeds: [embedBoasVindas], components: [menuInfo, botaoFechar] });
                } catch (errorEnvioMsg) {
                    return await interaction.editReply({ content: `Your ticket was created at ${ticketChannel}, but the panel failed to load.` });
                }

                await interaction.editReply({ content: `Your ticket has been created! Go to ${ticketChannel} to start.` });
            } catch (error) { 
                console.error(error);
                await interaction.editReply({ content: 'Something went wrong while creating your ticket.' }); 
            }
            return;
        }

        // AÇÃO: FECHAR TICKET
        if (interaction.customId === 'fechar_ticket_canal') {
            const eDono = interaction.user.id === guild.ownerId;
            const eAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!eDono && !eAdmin) {
                return await interaction.reply({ 
                    content: '❌ **Only Administrators** or the Server Owner can close and delete ticket channels.', 
                    ephemeral: true 
                });
            }

            try {
                await interaction.reply({ content: '⚠️ **Closing Ticket...** This channel will be permanently deleted in 5 seconds.' });
                setTimeout(async () => { try { await interaction.channel.delete(); } catch (e) {} }, 5000);
            } catch (error) { console.error(error); }
        }
    },

    // --- 5. SELECT MENU HANDLER ---
    async handleMenu(interaction) {
        if (interaction.customId !== 'menu_info_ticket') return;

        try {
            const opcaoSelecionada = interaction.values[0];
            let embedAtualizado = new EmbedBuilder().setColor('#5865F2');

            if (opcaoSelecionada === 'info_main') {
                embedAtualizado.setTitle(`📋 Main Info & Client Guidelines`).setDescription(`Guidelines to ensure a smooth process...\n\n• Practice patience and politeness.\n• Avoid rushing the artist.\n• Be specific with your vision.`)
                    .addFields({ name: '🤖 Roblox Avatars', value: '• Send screenshots from multiple PoVs.\n• Include official Username.', inline: true }, { name: '🐾 OCs & Furries', value: '• Furry designs welcome.\n• Specify poses/expressions.', inline: true });
            } else if (opcaoSelecionada === 'info_robux') {
                embedAtualizado.setTitle(`🪙 Payment Method: Robux`).setDescription(`Payments accepted directly through Roblox transfers (**0% fee**).`).addFields({ name: '✒️ Lineart', value: '• Headshot / PFP: **500 Robux**' }, { name: '🎨 Colored', value: '• Headshot / PFP: **800 Robux**' });
            } else if (opcaoSelecionada === 'info_usd') {
                embedAtualizado.setTitle(`💵 Payment Method: USD ($)`).setDescription(`Accepting Ko-fi or Stripe.`).addFields({ name: '✒️ Lineart', value: '• Headshot / PFP: **$5**' }, { name: '🎨 Colored', value: '• Headshot / PFP: **$8**' });
            } else if (opcaoSelecionada === 'info_tos') {
                embedAtualizado.setTitle(`⚖️ Terms of Service & Special Offers`)
                    .addFields(
                        { name: '✨ Offers & Scene Rules', value: '• **Supporter Discount:** Active supporters receive a 5% discount.\n• **Additional Characters:** Extra fee applies.\n• **Couples / Ships:** Increments base price.' },
                        { name: '⏳ Turnaround & Academic Policy', value: '• Due to college commitments, allow **7 to 10 days** to start, and **1 to 3 weeks** to finish once active work begins.' },
                        { name: '❌ No-Refund & Limits', value: '• **No-Refund:** Active once sketch phase begins.\n• **Will NOT Draw:** NSFW, Real people, highly detailed backgrounds.' }
                    );
            }

            await interaction.update({ embeds: [embedAtualizado] });
        } catch (error) { console.error(error); }
    }
};