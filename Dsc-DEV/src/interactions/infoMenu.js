const { EmbedBuilder } = require('discord.js');

module.exports = {
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