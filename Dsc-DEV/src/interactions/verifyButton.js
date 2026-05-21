const db = require('../database');

// Fallbacks by name
const CARGO_TEXTO_FALLBACK = "🔖";
const CARGO_BOTAO_FALLBACK = "📜✅";
const CARGO_DEFINITIVO_FALLBACK = "🕳️";

async function checarVerificacao(member, guild) {
    const userId = member.id;
    const guildId = guild.id;

    try {
        // 1. Fetch verification data
        const { rows: membroRows } = await db.query('SELECT * FROM membros_verificacao WHERE user_id = $1', [userId]);
        if (membroRows.length === 0) return;

        const dados = membroRows[0];
        if (dados.verificado_final === 1) return;

        // 2. Fetch config settings
        const { rows: configRows } = await db.query('SELECT member_role_id, two_step_enabled FROM guild_settings WHERE guild_id = $1', [guildId]);
        const config = configRows.length > 0 ? configRows[0] : { member_role_id: null, two_step_enabled: false };

        // 3. Force fetch roles from API to ensure we have the latest list
        const roles = await guild.roles.fetch();
        
        // Debugging: Log names so you can see if the name match is failing
        // console.log("Roles found in server:", roles.map(r => r.name));

        let cargoD;
        if (config.member_role_id) {
            cargoD = roles.get(config.member_role_id);
        }
        
        // If no ID or not found, try fallback name
        if (!cargoD) {
            cargoD = roles.find(r => r.name === CARGO_DEFINITIVO_FALLBACK);
        }

        // Logic check
        let podeVerificar = false;
        if (config.two_step_enabled === true || config.two_step_enabled === 1) {
            if (dados.digitou_verify === 1 && dados.clicou_botao === 1) podeVerificar = true;
        } else {
            if (dados.digitou_verify === 1) podeVerificar = true;
        }

        if (podeVerificar) {
            if (!cargoD) {
                console.error(`❌ [Error] Final role not found! Searched for ID: ${config.member_role_id} or Name: "${CARGO_DEFINITIVO_FALLBACK}"`);
                return;
            }

            // Update database
            await db.query('UPDATE membros_verificacao SET verificado_final = 1 WHERE user_id = $1', [userId]);

            // Apply final role
            if (!member.roles.cache.has(cargoD.id)) {
                await member.roles.add(cargoD);
                console.log(`✅ Assigned role ${cargoD.name} to ${member.user.tag}`);
            }
            
            // Cleanup temp roles
            const cargoT = roles.find(r => r.name === CARGO_TEXTO_FALLBACK);
            const cargoB = roles.find(r => r.name === CARGO_BOTAO_FALLBACK);
            const cargosRemover = [];
            
            if (cargoT && member.roles.cache.has(cargoT.id)) cargosRemover.push(cargoT.id);
            if (cargoB && member.roles.cache.has(cargoB.id)) cargosRemover.push(cargoB.id);
            
            if (cargosRemover.length > 0) {
                await member.roles.remove(cargosRemover);
            }
            
            console.log(`🎉 [Database] ${member.user.tag} fully verified!`);
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
            
            await db.query(
                `INSERT INTO membros_verificacao (user_id, digitou_verify) 
                  VALUES ($1, 1) 
                  ON CONFLICT (user_id) 
                  DO UPDATE SET digitou_verify = 1`,
                [userId]
            );

            const roles = await guild.roles.fetch();
            const cargoT = roles.find(r => r.name === CARGO_TEXTO_FALLBACK);
            if (cargoT && !message.member.roles.cache.has(cargoT.id)) {
                await message.member.roles.add(cargoT);
            }
            
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

            await db.query(
                `INSERT INTO membros_verificacao (user_id, clicou_botao) 
                  VALUES ($1, 1) 
                  ON CONFLICT (user_id) 
                  DO UPDATE SET clicou_botao = 1`,
                [userId]
            );

            const roles = await guild.roles.fetch();
            const cargoB = roles.find(r => r.name === CARGO_BOTAO_FALLBACK);
            if (cargoB && !member.roles.cache.has(cargoB.id)) {
                await member.roles.add(cargoB);
            }
            
            await interaction.reply({ content: `🎉 Rules accepted! The server will unlock!`, ephemeral: true });

            await checarVerificacao(member, guild);

        } catch (error) {
            console.error('❌ Error on button:', error);
            await interaction.reply({ content: 'Failed to process rules verification data.', ephemeral: true });
        }
    }
};