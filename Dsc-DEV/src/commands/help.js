const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAstraAdmin, isServerAdministrator } = require('../permissions');
const { t } = require('../i18n');
const db = require('../database');

async function getGuildLanguage(guildId) {
    const { rows } = await require('../database').query('SELECT language FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0]?.language;
}

module.exports = {
    // --- /about — a friendly, short pitch for anyone (not admin-gated).
    // Exists because "run /help and read every command" is a lot to throw
    // at someone who just wants to know what this bot even does.
    aboutData: new SlashCommandBuilder()
        .setName('about')
        .setDescription('What Astra does, in plain terms'),

    async executeSlashAbout(interaction) {
        const lang = await getGuildLanguage(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: '🛡️ Astra', iconURL: interaction.client.user.displayAvatarURL() })
            .setColor('#5865F2')
            .setDescription(t(lang, 'about.description'))
            .setFooter({ text: t(lang, 'about.footer'), iconURL: interaction.client.user.displayAvatarURL() });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    // --- /quickstart — numbered first-time setup walkthrough for admins.
    // The config surface (verification, anti-scam, tickets, artists,
    // admin roles) is genuinely a lot to land on cold — this exists so
    // there's one obvious place to start instead of guessing which
    // command to run first.
    quickstartData: new SlashCommandBuilder()
        .setName('quickstart')
        .setDescription('First-time setup walkthrough for admins'),

    async executeSlashQuickstart(interaction) {
        const { isAstraAdmin } = require('../permissions');
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to see this.', ephemeral: true });
        }

        const lang = await getGuildLanguage(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: t(lang, 'quickstart.title'), iconURL: interaction.client.user.displayAvatarURL() })
            .setColor('#5865F2')
            .setDescription(t(lang, 'quickstart.intro'))
            .addFields(
                { name: t(lang, 'quickstart.step1_title'), value: t(lang, 'quickstart.step1_desc') },
                { name: t(lang, 'quickstart.step2_title'), value: t(lang, 'quickstart.step2_desc') },
                { name: t(lang, 'quickstart.step3_title'), value: t(lang, 'quickstart.step3_desc') },
                { name: t(lang, 'quickstart.step4_title'), value: t(lang, 'quickstart.step4_desc') },
                { name: t(lang, 'quickstart.step5_title'), value: t(lang, 'quickstart.step5_desc') }
            )
            .setFooter({ text: t(lang, 'quickstart.footer'), iconURL: interaction.client.user.displayAvatarURL() });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List what Astra can do'),

    async executeSlash(interaction) {
        const admin = await isAstraAdmin(interaction.member);
        const superAdmin = await isServerAdministrator(interaction.member);
        // Artists see their /panel section too, not just admins.
        const artist = admin || await require('./tickets').isArtist(interaction.member);
        const lang = await getGuildLanguage(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: t(lang, 'help.title'), iconURL: interaction.client.user.displayAvatarURL() })
            .setColor('#5865F2')
            .setDescription(t(lang, 'help.intro'));

        // Everyone
        embed.addFields(
            { name: `👤 ${t(lang, 'help.everyone')}`, value: t(lang, 'help.everyone_body') },
            { name: `⭐ ${t(lang, 'help.levels')}`, value: t(lang, 'help.levels_body') },
            { name: `💰 ${t(lang, 'help.economy')}`, value: t(lang, 'help.economy_body') },
            { name: `💬 ${t(lang, 'help.fun')}`, value: t(lang, 'help.fun_body') }
        );

        if (artist) {
            embed.addFields({ name: `🎨 ${t(lang, 'help.artists')}`, value: t(lang, 'help.artist_body') });
        }

        if (admin) {
            embed.addFields(
                { name: t(lang, 'help.newhere'), value: t(lang, 'help.newhere_body') },
                { name: `🛠️ ${t(lang, 'help.admin_setup')}`, value: t(lang, 'help.admin_setup_body') },
                { name: `🏘️ ${t(lang, 'help.admin_community')}`, value: t(lang, 'help.admin_community_body') }
            );
        }

        if (superAdmin) {
            embed.addFields({ name: `👑 ${t(lang, 'help.superadmins')}`, value: t(lang, 'help.superadmin_body') });
        }

        embed.setFooter({
            text: admin ? t(lang, 'help.footer_admin') : t(lang, 'help.footer_member'),
            iconURL: interaction.client.user.displayAvatarURL()
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};