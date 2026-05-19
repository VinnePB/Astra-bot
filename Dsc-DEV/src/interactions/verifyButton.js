// Constantes configuradas com os emojis exatos para os nomes dos cargos
const CARGO_TEXTO = "🔖";   // Cargo ganho ao digitar !verify
const CARGO_BOTAO = "📜✅"; // Cargo ganho ao clicar no botão das regras

module.exports = {
    // 1️⃣ ETAPA: Comando por Texto (!verify)
    async handleTextVerify(message) {
        if (message.content !== '!verify') return;

        try {
            const cargo = message.guild.roles.cache.find(r => r.name === CARGO_TEXTO);
            if (!cargo) {
                return message.channel.send(`⚠️ Technical Error: The role "${CARGO_TEXTO}" was not found in this server.`);
            }

            if (message.member.roles.cache.has(cargo.id)) {
                const msgJaTem = await message.channel.send(`ℹ️ ${message.author}, you have already completed the text verification step!`);
                setTimeout(() => { try { message.delete(); msgJaTem.delete(); } catch(e){} }, 3000);
                return;
            }

            await message.member.roles.add(cargo);
            
            const msgSucesso = await message.channel.send(`✅ ${message.author} verified successfully! Don't forget to read the rules and click the button to unlock the server.`);
            setTimeout(() => {
                try { message.delete(); msgSucesso.delete(); } catch (e) {}
            }, 5000);

        } catch (error) {
            console.error('❌ Erro ao verificar por texto:', error);
            message.channel.send('❌ Failed to assign the text verification role.');
        }
    },

    // 2️⃣ ETAPA: Clique no Botão das Regras
    async handleButton(interaction) {
        if (interaction.customId !== 'botao_verificar_membro') return;

        try {
            const member = interaction.member;
            const cargo = interaction.guild.roles.cache.find(r => r.name === CARGO_BOTAO);

            if (!cargo) {
                return await interaction.reply({ content: `⚠️ Technical Error: The role "${CARGO_BOTAO}" does not exist in this server.`, ephemeral: true });
            }

            if (member.roles.cache.has(cargo.id)) {
                return await interaction.reply({ content: 'You have already confirmed that you read the rules!', ephemeral: true });
            }

            await member.roles.add(cargo);
            await interaction.reply({ content: `🎉 Rules accepted! The **${CARGO_BOTAO}** role has been added. If you have already typed \`!verify\`, the channels will unlock for you!`, ephemeral: true });

        } catch (error) {
            console.error('❌ Erro na verificação por botão:', error);
            await interaction.reply({ content: 'Failed to assign the rules verification role.', ephemeral: true });
        }
    }
};