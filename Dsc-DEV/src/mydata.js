// --- /mydata: see and delete your own data ---
//
//   /mydata view     a private file with everything Astra stores about you
//   /mydata delete   removes your levels, coins, pending verifications, tickets
//                    and artist profile in every server (asks you to confirm)
//
// Moderation cases are NOT removed here: they are a server's safety record
// (the Privacy Policy says so). To dispute one, contact the developer.

const {
    SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const db = require('../database');
const userdata = require('../userdata');

const data = new SlashCommandBuilder()
    .setName('mydata').setDescription('See or delete the data Astra stores about you.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('Get a private file with everything Astra stores about you'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete your levels, coins, tickets and artist profile (all servers)'));

async function lang(guildId) {
    try {
        const { rows } = await db.query('SELECT language FROM guild_settings WHERE guild_id = $1', [guildId]);
        return rows[0]?.language === 'pt-br';
    } catch (_) { return false; }
}

async function execute(interaction) {
    const pt = await lang(interaction.guild?.id);
    const tr = (en, ptText) => (pt ? ptText : en);
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'view') {
        const out = await userdata.exportUser(userId);
        const n = userdata.countRows(out);
        const file = new AttachmentBuilder(
            Buffer.from(JSON.stringify({ user_id: userId, exported_at: new Date().toISOString(), data: out }, null, 2)),
            { name: 'my-astra-data.json' }
        );
        return interaction.reply({
            content: tr(`📄 Astra stores **${n}** record(s) about you across all servers. The file is private to you.`, `📄 A Astra guarda **${n}** registro(s) sobre você em todos os servidores. O arquivo é privado, só você vê.`),
            files: [file], ephemeral: true,
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`astra_mydata_yes_${userId}`).setLabel(tr('Yes, delete my data', 'Sim, apagar meus dados')).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`astra_mydata_no_${userId}`).setLabel(tr('Cancel', 'Cancelar')).setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
        content: tr(
            '⚠️ This permanently deletes your **levels, coins, pending verifications, tickets and artist profile** in **every server**. Moderation records are kept as part of each server\'s safety record. This can\'t be undone.',
            '⚠️ Isso apaga permanentemente seus **níveis, moedas, verificações pendentes, tickets e perfil de artista** em **todos os servidores**. Registros de moderação são mantidos como parte do registro de segurança de cada servidor. Não dá para desfazer.'),
        components: [row], ephemeral: true,
    });
}

async function handleButton(interaction) {
    const [, , action, ownerId] = interaction.customId.split('_'); // astra_mydata_yes_<id>
    const pt = await lang(interaction.guild?.id);
    const tr = (en, ptText) => (pt ? ptText : en);
    if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: tr('❌ This isn\'t your request.', '❌ Este pedido não é seu.'), ephemeral: true });
    }
    if (action === 'no') {
        return interaction.update({ content: tr('Cancelled. Nothing was deleted.', 'Cancelado. Nada foi apagado.'), components: [] });
    }
    try {
        const counts = await userdata.deleteUser(ownerId, { moderation: false });
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        return interaction.update({ content: tr(`✅ Done. **${total}** record(s) deleted.`, `✅ Pronto. **${total}** registro(s) apagado(s).`), components: [] });
    } catch (err) {
        console.error('❌ /mydata delete failed:', err.message);
        return interaction.update({ content: tr('❌ Something went wrong and nothing was deleted. Please try again.', '❌ Algo deu errado e nada foi apagado. Tente novamente.'), components: [] });
    }
}

module.exports = { data, execute, handleButton };