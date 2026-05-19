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
                    .setDescription(
                        'Welcome to **v14rtz**! Please read our community guidelines carefully before verifying:\n\n' +
                        // 📋 COLE SUAS REGRAS ABAIXO (Pode adicionar ou alterar as linhas como quiser):
                        '1️⃣ **Be respectful:** Treat all members and the artist with kindness. No hate speech, harassment, or toxicity.\n' +
                        '2️⃣ **No NSFW content:** Keep all discussions and media safe for work (SFW) throughout the server channels.\n' +
                        '3️⃣ **No Spam or Self-Promotion:** Do not flood channels or advertise without explicit authorization.\n' +
                        '4️⃣ **Commission Policy:** Respect turnaround times and guidelines detailed inside the tickets.\n\n' +
                        'By clicking the button below, you confirm that you have read and agree to all our terms and community rules.'
                    )
                    .setColor('#2ECC71');

                await message.channel.send({ embeds: [embedRegras], components: [botaoVerificar] });
                try { await message.delete(); } catch (e) {}
            } catch (error) { console.error('❌ Erro no !setupverify:', error); }
        }
    }
};