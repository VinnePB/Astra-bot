const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

module.exports = {
    async handleButton(interaction) {
        const guild = interaction.guild;
        const user = interaction.user;

        // --- AÇÃO: ABRIR TICKET ---
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
                    return await interaction.editReply({ content: `Seu ticket foi criado em ${ticketChannel}, mas falhei ao colocar o painel lá dentro.` });
                }

                await interaction.editReply({ content: `Your ticket has been created! Go to ${ticketChannel} to start.` });
            } catch (error) { 
                console.error(error);
                await interaction.editReply({ content: 'Something went wrong while creating your ticket.' }); 
            }
        }

        // --- AÇÃO: FECHAR TICKET (Protegido: Apenas Admin ou Dono) ---
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
    }
};