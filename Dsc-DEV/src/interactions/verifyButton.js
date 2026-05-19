const NOME_CARGO_VERIFICADO = "🕳️"; 

module.exports = {
    // Cuida do clique no botão verde do painel de regras
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
    },

    // Cuida do comando por texto !verify alternativo
    async handleTextVerify(message) {
        if (message.content !== '!verify') return;

        try {
            const cargo = message.guild.roles.cache.find(r => r.name === NOME_CARGO_VERIFICADO);
            if (!cargo) {
                return message.channel.send(`⚠️ Erro: O cargo com o nome exato "${NOME_CARGO_VERIFICADO}" não foi encontrado no servidor.`);
            }

            await message.member.roles.add(cargo);
            
            const msgSucesso = await message.channel.send(`✅ ${message.author}, você foi verificado com sucesso! Os canais foram liberados.`);
            setTimeout(() => {
                try { message.delete(); msgSucesso.delete(); } catch (e) {}
            }, 4000);

        } catch (error) {
            console.error('❌ Erro ao verificar por texto:', error);
            message.channel.send('❌ Não consegui te dar o cargo.');
        }
    }
};