// verifyButton.js snippet
async function handleButton(interaction) {
    // 1. MUST check ID immediately so this doesn't run for ticket buttons
    if (interaction.customId !== 'botao_verificar_membro') return; 

    try {
        const guild = interaction.guild;
        const member = interaction.member;

        // 2. Fetch config from DB
        const { rows } = await db.query('SELECT member_role_id FROM guild_settings WHERE guild_id = $1', [guild.id]);
        
        if (rows.length === 0 || !rows[0].member_role_id) {
            return interaction.reply({ content: "❌ Server not configured.", ephemeral: true });
        }

        const role = await guild.roles.fetch(rows[0].member_role_id);
        if (!role) return interaction.reply({ content: "❌ Role not found.", ephemeral: true });

        // 3. Add role
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role);
        }
        
        await interaction.reply({ content: "✅ Verified!", ephemeral: true });
    } catch (error) {
        console.error(error);
    }
}