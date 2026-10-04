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
        const { rows } = await db.query('SELECT language FROM guild_settings WHERE guild_id = $1', [interaction.guild.id]);
        const lang = rows[0]?.language;

        const embed = new EmbedBuilder()
            .setAuthor({ name: t(lang, 'help.title'), iconURL: interaction.client.user.displayAvatarURL() })
            .setColor('#5865F2')
            .setDescription(
                '🔐 **Verification:** click **I Agree** in the rules channel, then type `!verify` in the ' +
                'verify channel (or vice versa) to unlock the server. Anything else typed there gets removed.\n\n' +
                '🎫 **Tickets:** click **Open a Ticket** in the ticket channel and pick an artist to start a private commission chat.'
            );

        embed.addFields(
            { name: `👤 ${t(lang, 'help.everyone')}`, value: '`!verify` — Complete step 2 of verification.\n`/about` — What Astra does, in plain terms.\n`/help` — Show this menu.' }
        );

        if (admin) {
            embed.addFields({
                name: '🚀 New here?',
                value: 'Run `/quickstart` for a step-by-step first-time setup walkthrough.'
            });

            embed.addFields({
                name: `🎨 ${t(lang, 'help.artists')}`,
                value: [
                    '`/panel set-tos` — Set your Terms of Service.',
                    '`/panel set-wontdo` — Set your Won\'t Do list.',
                    '`/panel set-askme` — Set what people can ask you about.',
                    '`/panel set-price` — Set a price for one category.',
                    '`/panel reset` — Reset part of your panel to defaults.',
                    '`/panel preview` — See how your panel looks to clients.'
                ].join('\n')
            });

            embed.addFields({
                name: `🛠️ ${t(lang, 'help.admins')}`,
                value: [
                    '`/config verification` — Rules/verify channels, buttons, roles.',
                    '`/config antiscam` — Flag or auto-kick likely scam accounts.',
                    '`/config tickets` — Ticket panel, category, artist setup category.',
                    '`/config artist-roles` — Roles that auto-count as artists.',
                    '`/config language` — Switch Astra\'s language for this server.',
                    '`/artist add/remove/list` — Register individual artists.',
                    '`/artist setup-channel` — (Re)create an artist\'s private setup channel.'
                ].join('\n')
            });
        }

        if (superAdmin) {
            embed.addFields({
                name: `👑 ${t(lang, 'help.superadmins')}`,
                value: [
                    '`/config admins add` — Grant a role Astra-admin access.',
                    '`/config admins remove` — Revoke a role\'s Astra-admin access.',
                    '`/config admins list` — See which roles currently have access.'
                ].join('\n')
            });
        }

        embed.setFooter({
            text: admin ? 'Astra' : 'Some commands are hidden — ask a server admin for access.',
            iconURL: interaction.client.user.displayAvatarURL()
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};