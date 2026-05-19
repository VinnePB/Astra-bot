const NOME_CARGO_VERIFICADO = "🕳️"; 

module.exports = {
    // Cuida exclusivamente do clique no botão verde do painel de regras
    async handleButton(interaction) {
        if (interaction.customId !== 'botao_verificar_membro') return;

        try {
            const member = interaction.member;
            const cargo = interaction.guild.roles.cache.find(r => r.name === NOME_CARGO_VERIFICADO);

            if (!cargo) {
                return await interaction.reply({ content: `⚠️ Erro técnico: O cargo "${NOME_CARGO_VERIFICADO}" não existe neste servidor.`, ephemeral: true });
            }

            if (member.roles.cache.has(cargo.id)) {
                return await interaction.reply({ content: 'Você já está verificado e tem acesso ao servidor!', ephemeral: true });
            }

            await member.roles.add(cargo);
            await interaction.reply({ content: `🎉 Perfeito! O cargo **${NOME_CARGO_VERIFICADO}** foi adicionado e o servidor foi desbloqueado para você!`, ephemeral: true });

        } catch (error) {
            console.error('❌ Erro na verificação por botão:', error);
            await interaction.reply({ content: 'Não consegui adicionar o cargo de verificação.', ephemeral: true });
        }
    }
};