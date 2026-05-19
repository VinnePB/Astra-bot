const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    async execute(message) {
        const eDono = message.author.id === message.guild.ownerId;
        const eAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!eDono && !eAdmin) return;

        // --- PAINEL DE TICKETS COMMISSIONS ---
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
            } catch (error) { console.error('❌ Erro no !setup:', error); }
        }

        // --- MURAL DE VERIFICAÇÃO (Regras) ---
        if (message.content === '!setupverify') {
            try {
                const botaoVerificar = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('botao_verificar_membro')
                        .setLabel('✅ Agree & Verify')
                        .setStyle(ButtonStyle.Success)
                );

                const embedRegras = new EmbedBuilder()
                    .setTitle('📜 Server Rules & Terms of Service')
                    .setDescription('Welcome to **v14rtz**! To get access to the rest of the server channels, please read our rules and guidelines.\n\n' +
                                    '• Be polite and respectful to everyone.\n' +
                                    '• No NSFW content outside designated areas (if any).\n' +
                                    '• Respect the artist turnaround time and policies.\n\n' +
                                    'By clicking the button below or typing `!verify`, you agree to our Terms of Service and community guidelines.')
                    .setColor('#2ECC71');

                await message.channel.send({ embeds: [embedRegras], components: [botaoVerificar] });
                try { await message.delete(); } catch (e) {}
            } catch (error) { console.error('❌ Erro no !setupverify:', error); }
        }
    }
};