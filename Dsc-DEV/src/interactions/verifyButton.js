const db = require('../database');

// Configuração dos nomes exatos dos cargos
const CARGO_TEXTO = "🔖";       
const CARGO_BOTAO = "📜✅";     
const CARGO_DEFINITIVO = "🕳️"; 

async function checarDuplaVerificacao(member, guild) {
    const userId = member.id;

    try {
        // No Postgres, usamos $1 em vez de ?
        const { rows } = await db.query('SELECT * FROM membros_verificacao WHERE user_id = $1', [userId]);
        if (rows.length === 0) return;

        const dados = rows[0];

        if (dados.digitou_verify === 1 && dados.clicou_botao === 1) {
            const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO);
            const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO);
            const cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO);

            if (!cargoT || !cargoB || !cargoD) {
                console.error("❌ [Postgres/Discord] Erro: Cargos não encontrados.");
                return;
            }

            await db.query('UPDATE membros_verificacao SET verificado_final = 1 WHERE user_id = $1', [userId]);

            await member.roles.add(cargoD);
            await member.roles.remove([cargoT.id, cargoB.id]);
            
            console.log(`🎉 [Banco de Dados] ${member.user.tag} verificado definitivo!`);
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
            const cargo = guild.roles.cache.find(r => r.name === CARGO_TEXTO);
            const cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO);

            if (!cargo || !cargoD) {
                return message.channel.send(`⚠️ Technical Error: Verification roles missing.`);
            }

            if (message.member.roles.cache.has(cargoD.id)) {
                const msgJaVerificado = await message.channel.send(`ℹ️ ${message.author}, you are already fully verified!`);
                setTimeout(() => { try { message.delete(); msgJaVerificado.delete(); } catch(e){} }, 3000);
                return;
            }

            // Lógica do Postgres para "INSERT ou UPDATE" (UPSERT)
            await db.query(
                `INSERT INTO membros_verificacao (user_id, digitou_verify) 
                 VALUES ($1, 1) 
                 ON CONFLICT (user_id) 
                 DO UPDATE SET digitou_verify = 1`,
                [userId]
            );

            await message.member.roles.add(cargo);
            
            const msgSucesso = await message.channel.send(`✅ ${message.author} verified! [1/2] Now, make sure to read the rules and click the green button.`);
            
            await checarDuplaVerificacao(message.member, guild);

            setTimeout(() => { try { message.delete(); msgSucesso.delete(); } catch (e) {} }, 5000);

        } catch (error) {
            console.error('❌ Erro no !verify:', error);
            message.channel.send('❌ Failed to process text verification data.');
        }
    },

    async handleButton(interaction) {
        if (interaction.customId !== 'botao_verificar_membro') return;

        try {
            const guild = interaction.guild;
            const member = interaction.member;
            const userId = member.id;
            const cargo = guild.roles.cache.find(r => r.name === CARGO_BOTAO);
            const cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO);

            if (!cargo || !cargoD) {
                return await interaction.reply({ content: `⚠️ Technical Error: Roles missing.`, ephemeral: true });
            }

            if (member.roles.cache.has(cargoD.id)) {
                return await interaction.reply({ content: 'You are already fully verified!', ephemeral: true });
            }

            // Lógica do Postgres para "INSERT ou UPDATE" (UPSERT)
            await db.query(
                `INSERT INTO membros_verificacao (user_id, clicou_botao) 
                 VALUES ($1, 1) 
                 ON CONFLICT (user_id) 
                 DO UPDATE SET clicou_botao = 1`,
                [userId]
            );

            await member.roles.add(cargo);
            
            await interaction.reply({ content: `🎉 Rules accepted! [2/2] If you have already typed \`!verify\`, the server will unlock!`, ephemeral: true });

            await checarDuplaVerificacao(member, guild);

        } catch (error) {
            console.error('❌ Erro no botão:', error);
            await interaction.reply({ content: 'Failed to process rules verification data.', ephemeral: true });
        }
    }
};