// --- /invite ---
// Open to everyone, in servers and in direct messages with Astra. It points to
// the invite link and the website, so a DM with Astra never leads anywhere
// else. Registered globally (not per server), see index.js.

const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionContextType,
} = require('discord.js');

const data = new SlashCommandBuilder()
    .setName('invite').setDescription('Add Astra to your server or open her website.')
    .setDescriptionLocalizations({ 'pt-BR': 'Adicione a Astra ao seu servidor ou abra o site dela.' })
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

const TEXT = {
    en: { title: 'Astra', body: 'Astra is a Discord bot with verification, tickets, levels, a shop and a web dashboard. Add her to your server or open the website.', add: 'Add Astra', site: 'Website' },
    pt: { title: 'Astra', body: 'A Astra é um bot de Discord com verificação, tickets, níveis, loja e um painel na web. Adicione ela ao seu servidor ou abra o site.', add: 'Adicionar a Astra', site: 'Site' },
};

function buildReply(locale, { inviteUrl, siteUrl }) {
    const t = String(locale || '').toLowerCase().startsWith('pt') ? TEXT.pt : TEXT.en;
    const embed = new EmbedBuilder().setColor('#22E5FF').setTitle(t.title).setDescription(t.body);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t.add).setURL(inviteUrl),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t.site).setURL(siteUrl),
    );
    return { embeds: [embed], components: [row], ephemeral: true };
}

async function execute(interaction, links) {
    return interaction.reply(buildReply(interaction.locale, links));
}

// Plain-text answer for strangers who write to Astra in a DM.
function strangerText({ inviteUrl, siteUrl }) {
    return `👋 I live in servers, so most of what I do happens there. Add me: ${inviteUrl}\nWebsite: ${siteUrl}\n\nEu vivo em servidores, então quase tudo acontece lá. Me adicione: ${inviteUrl}\nSite: ${siteUrl}`;
}

module.exports = { data, execute, buildReply, strangerText };