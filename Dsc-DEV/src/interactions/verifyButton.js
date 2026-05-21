const db = require('../database');

// Fallbacks by name (in case the server hasn't been configured via /config yet)
const CARGO_TEXTO_FALLBACK = "🔖";        
const CARGO_BOTAO_FALLBACK = "📜✅";     
const CARGO_DEFINITIVO_FALLBACK = "🕳️"; 

async function checarDuplaVerificacao(member, guild) {
    const userId = member.id;
    const guildId = guild.id;

    try {
        // 1. Fetch verification data for the user
        const { rows: membroRows } = await db.query('SELECT * FROM membros_verificacao WHERE user_id = $1', [userId]);
        if (membroRows.length === 0) return;

        const dados = membroRows[0];

        // SEGURANÇA: Se já estiver verificado, não faz nada para evitar flicker de cargos
        if (dados.verificado_final === 1) return;

        if (dados.digitou_verify === 1 && dados.clicou_botao === 1) {
            
            // 2. Fetch configured role for this server from DB
            const { rows: configRows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guildId]);
            
            let cargoD;

            if (configRows.length > 0 && configRows[0].member_role_id) {
                // If found in DB, fetch by ID
                cargoD = guild.roles.cache.get(configRows[0].member_role_id);
            } else {
                // If not configured via slash command, use fallback by name
                cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
            }

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
            
            // Check if server has custom role in DB
            const { rows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guild.id]);
            let cargoD;

            if (rows.length > 0 && rows[0].member_role_id) {
                cargoD = guild.roles.cache.get(rows[0].member_role_id);
            } else {
                cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
            }

            const cargoT = guild.roles.cache.find(r => r.name === CARGO_TEXTO_FALLBACK);

            // Check if already fully verified
            if (cargoD && message.member.roles.cache.has(cargoD.id)) {
                const msgJaVerificado = await message.channel.send(`ℹ️ ${message.author}, you are already fully verified!`);
                setTimeout(() => { try { message.delete(); msgJaVerificado.delete(); } catch(e){} }, 3000);
                return;
            }

            // Register step 1 in DB
            await db.query(
                `INSERT INTO membros_verificacao (user_id, digitou_verify) 
                  VALUES ($1, 1) 
                  ON CONFLICT (user_id) 
                  DO UPDATE SET digitou_verify = 1`,
                [userId]
            );

            if (cargoT && !message.member.roles.cache.has(cargoT.id)) {
                await message.member.roles.add(cargoT);
            }
            
            const msgSucesso = await message.channel.send(`✅ ${message.author} verified! [1/2] Now, make sure to read the rules and click the green button.`);
            
            await checarDuplaVerificacao(message.member, guild);

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

            // Check if server has custom role in DB
            const { rows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guild.id]);
            let cargoD;

            if (rows.length > 0 && rows[0].member_role_id) {
                cargoD = guild.roles.cache.get(rows[0].member_role_id);
            } else {
                cargoD = guild.roles.cache.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
            }

            const cargoB = guild.roles.cache.find(r => r.name === CARGO_BOTAO_FALLBACK);

            // Check if already fully verified
            if (cargoD && member.roles.cache.has(cargoD.id)) {
                return await interaction.reply({ content: 'You are already fully verified!', ephemeral: true });
            }

            // Register step 2 in DB
            await db.query(
                `INSERT INTO membros_verificacao (user_id, clicou_botao) 
                  VALUES ($1, 1) 
                  ON CONFLICT (user_id) 
                  DO UPDATE SET clicou_botao = 1`,
                [userId]
            );

            if (cargoB && !member.roles.cache.has(cargoB.id)) {
                await member.roles.add(cargoB);
            }
            
            await interaction.reply({ content: `🎉 Rules accepted! [2/2] If you have already typed \`!verify\`, the server will unlock!`, ephemeral: true });

            await checarDuplaVerificacao(member, guild);

        } catch (error) {
            console.error('❌ Error on button:', error);
            await interaction.reply({ content: 'Failed to process rules verification data.', ephemeral: true });
        }
    }
};