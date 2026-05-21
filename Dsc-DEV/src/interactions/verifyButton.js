const db = require('../database');

// Fallbacks by name (in case the server hasn't been configured via /config yet)
const CARGO_TEXTO_FALLBACK = "🔖";        
const CARGO_BOTAO_FALLBACK = "📜✅";     
const CARGO_DEFINITIVO_FALLBACK = "🕳️"; 

async function checarVerificacao(member, guild) {
    const userId = member.id;
    const guildId = guild.id;

    try {
        // 1. Fetch verification data for the user from the database
        const { rows: membroRows } = await db.query('SELECT * FROM membros_verificacao WHERE user_id = $1', [userId]);
        
        // Se o usuário não existe no banco, não há nada para verificar
        if (membroRows.length === 0) return;

        const dados = membroRows[0];

        // SEGURANÇA: Se já estiver verificado, não faz nada para evitar flicker de cargos
        if (dados.verificado_final === 1) return;

        // 2. Fetch configured settings for this server from DB
        const { rows: configRows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [guildId]);
        
        // Define as configurações padrão caso não haja registro no banco
        const config = configRows.length > 0 ? configRows[0] : { member_role_id: null, two_step_enabled: false };

        // Define cargo final (id preferencial ou fallback)
        let cargoD;
        if (config.member_role_id) {
            cargoD = guild.roles.cache.get(config.member_role_id);
        } else {
            cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
        }

        // Verifica se o servidor exige 2 passos (2-step) ou apenas 1 passo
        // Se two_step_enabled for true, precisa de (digitou_verify == 1 E clicou_botao == 1)
        // Se for false, precisa apenas de (digitou_verify == 1)
        let podeVerificar = false;
        if (config.two_step_enabled === true || config.two_step_enabled === 1) {
            if (dados.digitou_verify === 1 && dados.clicou_botao === 1) {
                podeVerificar = true;
            }
        } else {
            if (dados.digitou_verify === 1) {
                podeVerificar = true;
            }
        }

        if (podeVerificar) {
            // Fetch temporary roles by name for removal
            const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO_FALLBACK);
            const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO_FALLBACK);

            if (!cargoD) {
                console.error(`❌ [Postgres/Discord] Error: Final role not found in server ${guildId}.`);
                return;
            }

            // Update user status in database
            await db.query('UPDATE membros_verificacao SET verificado_final = 1 WHERE user_id = $1', [userId]);

            // Apply final role and remove temporary ones
            // Ensure we don't re-add if they already have it
            if (!member.roles.cache.has(cargoD.id)) {
                await member.roles.add(cargoD);
            }
            
            const cargosRemover = [];
            if (cargoT && member.roles.cache.has(cargoT.id)) cargosRemover.push(cargoT.id);
            if (cargoB && member.roles.cache.has(cargoB.id)) cargosRemover.push(cargoB.id);
            
            if (cargosRemover.length > 0) {
                await member.roles.remove(cargosRemover);
            }
            
            console.log(`🎉 [Database] ${member.user.tag} fully verified in server ${guild.name}!`);
        }
    } catch (error) {
        console.error(`❌ Error checking database for ${userId}:`, error);
    }
}

module.exports = {
    async handleTextVerify(message) {
        if (message.content !== '!verify') return;

        try {
            const guild = message.guild;
            const userId = message.author.id;
            
            // Register step 1 in DB
            await db.query(
                `INSERT INTO membros_verificacao (user_id, digitou_verify) 
                  VALUES ($1, 1) 
                  ON CONFLICT (user_id) 
                  DO UPDATE SET digitou_verify = 1`,
                [userId]
            );

            // Adiciona cargo de texto (se existir)
            const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO_FALLBACK);
            if (cargoT && !message.member.roles.cache.has(cargoT.id)) {
                await message.member.roles.add(cargoT);
            }
            
            // Chama a função de checagem para ver se já libera o cargo definitivo
            await checarVerificacao(message.member, guild);

            const msgSucesso = await message.channel.send(`✅ ${message.author} verified! Now, make sure to read the rules and click the green button.`);
            
            setTimeout(() => { try { message.delete(); msgSucesso.delete(); } catch (e) {} }, 5000);

        } catch (error) {
            console.error('❌ Error on !verify:', error);
            message.channel.send('❌ Failed to process text verification data.');
        }
    },

    async handleButton(interaction) {
        if (interaction.customId !== 'botao_verificar_membro') return;

        try {
            const guild = interaction.guild;
            const member = interaction.member;
            const userId = member.id;

            // Register step 2 in DB
            await db.query(
                `INSERT INTO membros_verificacao (user_id, clicou_botao) 
                  VALUES ($1, 1) 
                  ON CONFLICT (user_id) 
                  DO UPDATE SET clicou_botao = 1`,
                [userId]
            );

            // Adiciona cargo de botão (se existir)
            const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO_FALLBACK);
            if (cargoB && !member.roles.cache.has(cargoB.id)) {
                await member.roles.add(cargoB);
            }
            
            await interaction.reply({ content: `🎉 Rules accepted! The server will unlock!`, ephemeral: true });

            // Chama a função de checagem para finalizar a verificação
            await checarVerificacao(member, guild);

        } catch (error) {
            console.error('❌ Error on button:', error);
            await interaction.reply({ content: 'Failed to process rules verification data.', ephemeral: true });
        }
    }
};