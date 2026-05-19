// Configuração dos nomes exatos dos cargos
const CARGO_TEXTO = "🔖";       // Ganho via !verify
const CARGO_BOTAO = "📜✅";     // Ganho via botão das regras
const CARGO_DEFINITIVO = "🕳️"; // Cargo final que libera o servidor

// Função interna que roda automaticamente para checar a dupla verificação
async function checarDuplaVerificacao(member, guild) {
    const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO);
    const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO);
    const cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO);

    if (!cargoT || !cargoB || !cargoD) {
        console.error("❌ [Erro Técnico] Um dos três cargos de verificação não foi encontrado no servidor.");
        return;
    }

    // Verifica se o membro possui os dois cargos temporários simultaneamente
    const temTexto = member.roles.cache.has(cargoT.id);
    const temBotao = member.roles.cache.has(cargoB.id);

    if (temTexto && temBotao) {
        try {
            // 1. Adiciona o cargo definitivo 🕳️
            await member.roles.add(cargoD);
            
            // 2. Remove os cargos de emojis temporários para limpar o perfil do usuário
            await member.roles.remove([cargoT.id, cargoB.id]);
            
            console.log(`🎉 [Dupla Verificação] ${member.user.tag} passou no portão com sucesso e ganhou o cargo ${CARGO_DEFINITIVO}!`);
        } catch (error) {
            console.error(`❌ Erro ao promover membro verificado:`, error);
        }
    }
}

module.exports = {
    // 1️⃣ ETAPA: Comando por Texto (!verify)
    async handleTextVerify(message) {
        if (message.content !== '!verify') return;

        try {
            const guild = message.guild;
            const cargo = guild.roles.cache.find(r => r.name === CARGO_TEXTO);
            const cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO);

            if (!cargo || !cargoD) {
                return message.channel.send(`⚠️ Technical Error: Verification roles missing in server config.`);
            }

            // Se o cara já tem o cargo final 🕳️, avisa e apaga a mensagem
            if (message.member.roles.cache.has(cargoD.id)) {
                const msgJaVerificado = await message.channel.send(`ℹ️ ${message.author}, you are already fully verified!`);
                setTimeout(() => { try { message.delete(); msgJaVerificado.delete(); } catch(e){} }, 3000);
                return;
            }

            // Adiciona o primeiro selo (Texto)
            await message.member.roles.add(cargo);
            
            const msgSucesso = await message.channel.send(`✅ ${message.author} verified! [1/2] Now, make sure to read the rules and click the green button to fully unlock the server.`);
            
            // Roda a checa automática instantaneamente
            await checarDuplaVerificacao(message.member, guild);

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
            const guild = interaction.guild;
            const member = interaction.member;
            const cargo = guild.roles.cache.find(r => r.name === CARGO_BOTAO);
            const cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO);

            if (!cargo || !cargoD) {
                return await interaction.reply({ content: `⚠️ Technical Error: Verification roles missing in server config.`, ephemeral: true });
            }

            if (member.roles.cache.has(cargoD.id)) {
                return await interaction.reply({ content: 'You are already fully verified and have access to the server!', ephemeral: true });
            }

            // Adiciona o segundo selo (Botão)
            await member.roles.add(cargo);
            
            // Envia uma resposta temporária/efêmera avisando que o clique contou
            await interaction.reply({ content: `🎉 Rules accepted! [2/2] If you have already typed \`!verify\` in the verification channel, the server will unlock now!`, ephemeral: true });

            // Roda a checa automática instantaneamente
            await checarDuplaVerificacao(member, guild);

        } catch (error) {
            console.error('❌ Erro na verificação por botão:', error);
            await interaction.reply({ content: 'Failed to assign the rules verification role.', ephemeral: true });
        }
    }
};