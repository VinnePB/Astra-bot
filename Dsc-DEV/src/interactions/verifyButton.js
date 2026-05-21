const db = require('../database');

// Fallbacks antigos por nome (caso o servidor não tenha sido configurado via /config ainda)
const CARGO_TEXTO_FALLBACK = "🔖";       
const CARGO_BOTAO_FALLBACK = "📜✅";     
const CARGO_DEFINITIVO_FALLBACK = "🕳️"; 

async function checarDuplaVerificacao(member, guild) {
    const userId = member.id;
    const guildId = guild.id;

    try {
        // 1. Busca os dados da dupla verificação do usuário
        const { rows: membroRows } = await db.query('SELECT * FROM membros_verificacao WHERE user_id = $1', [userId]);
        if (membroRows.length === 0) return;

        const dados = membroRows[0];

        if (dados.digitou_verify === 1 && dados.clicou_botao === 1) {
            
            // 2. Busca o cargo configurado para este servidor no banco
            const { rows: configRows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guildId]);
            
            let cargoD;

            if (configRows.length > 0 && configRows[0].member_role_id) {
                // Se achou no banco, busca pelo ID direto (muito mais seguro)
                cargoD = guild.roles.cache.get(configRows[0].member_role_id);
            } else {
                // Se não configurou via slash command, usa o fallback por nome antigo
                cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
            }

            // Busca os cargos temporários por nome para remoção
            const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO_FALLBACK);
            const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO_FALLBACK);

            if (!cargoD) {
                console.error(`❌ [Postgres/Discord] Erro: Cargo definitivo não encontrado no servidor ${guildId}.`);
                return;
            }

            // Atualiza o status do usuário no banco
            await db.query('UPDATE membros_verificacao SET verificado_final = 1 WHERE user_id = $1', [userId]);

            // Aplica o cargo definitivo e remove os provisórios
            await member.roles.add(cargoD);
            
            const cargosRemover = [];
            if (cargoT && member.roles.cache.has(cargoT.id)) cargosRemover.push(cargoT.id);
            if (cargoB && member.roles.cache.has(cargoB.id)) cargosRemover.push(cargoB.id);
            
            if (cargosRemover.length > 0) {
                await member.roles.remove(cargosRemover);
            }
            
            console.log(`🎉 [Banco de Dados] ${member.user.tag} verificado definitivo no servidor ${guild.name}!`);
        }
    } catch (error) {
        console.error(`❌ Erro na checagem do banco para ${userId}:`, error);
    }
}

module.exports = {
    async handleTextVerify(message) {
        if (message.content !== '!verify') return;

        try {
            const guild = message.guild;
            const userId = message.author.id;
            
            // Verifica se o servidor já tem cargo personalizado no banco
            const { rows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guild.id]);
            let cargoD;

            if (rows.length > 0 && rows[0].member_role_id) {
                cargoD = guild.roles.cache.get(rows[0].member_role_id);
            } else {
                cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
            }

            const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO_FALLBACK);

            if (cargoD && message.member.roles.cache.has(cargoD.id)) {
                const msgJaVerificado = await message.channel.send(`ℹ️ ${message.author}, you are already fully verified!`);
                setTimeout(() => { try { message.delete(); msgJaVerificado.delete(); } catch(e){} }, 3000);
                return;
            }

            // Registra o passo 1 no banco
            await db.query(
                `INSERT INTO membros_verificacao (user_id, digitou_verify) 
                 VALUES ($1, 1) 
                 ON CONFLICT (user_id) 
                 DO UPDATE SET digitou_verify = 1`,
                [userId]
            );

            if (cargoT) {
                await message.member.roles.add(cargoT);
            }
            
            const msgSucesso = await message.channel.send(`✅ ${message.author} verified! [1/2] Now, make sure to read the rules and click the green button.`);
            
            await checarDuplaVerificacao(message.member, guild);

            setTimeout(() => { try { message.delete(); msgSucesso.delete(); } catch (e) {} }, 5000);

        } catch (error) {
            console.error('❌ Erro no !verify:', error);
            message.channel.send('❌ Failed to process text verification data.');
        }
    },

    async handleButton(interaction) {
        // ID sincronizado com o que definimos no Slash Command /config
        if (interaction.customId !== 'btn_verificar_membro') return;

        try {
            const guild = interaction.guild;
            const member = interaction.member;
            const userId = member.id;

            // Verifica se o servidor já tem cargo personalizado no banco
            const { rows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guild.id]);
            let cargoD;

            if (rows.length > 0 && rows[0].member_role_id) {
                cargoD = guild.roles.cache.get(rows[0].member_role_id);
            } else {
                cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
            }

            const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO_FALLBACK);

            if (cargoD && member.roles.cache.has(cargoD.id)) {
                return await interaction.reply({ content: 'You are already fully verified!', ephemeral: true });
            }

            // Registra o passo 2 no banco
            await db.query(
                `INSERT INTO membros_verificacao (user_id, clicou_botao) 
                 VALUES ($1, 1) 
                 ON CONFLICT (user_id) 
                 DO UPDATE SET clicou_botao = 1`,
                [userId]
            );

            if (cargoB) {
                await member.roles.add(cargoB);
            }
            
            await interaction.reply({ content: `🎉 Rules accepted! [2/2] If you have already typed \`!verify\`, the server will unlock!`, ephemeral: true });

            await checarDuplaVerificacao(member, guild);

        } catch (error) {
            console.error('❌ Erro no botão:', error);
            await interaction.reply({ content: 'Failed to process rules verification data.', ephemeral: true });
        }
    }
};