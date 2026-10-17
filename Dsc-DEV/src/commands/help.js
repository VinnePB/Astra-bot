const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
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

    // Three pages behind buttons: what she does, a setup tutorial, and a
    // member guide. One embed would blow past Discord's size limits.
    buildAboutPage(client, lang, page) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: '🛡️ Astra', iconURL: client.user.displayAvatarURL() })
            .setColor('#5865F2')
            .setFooter({ text: t(lang, 'about.footer'), iconURL: client.user.displayAvatarURL() });

        if (page === 'setup') {
            embed.setTitle(t(lang, 'about.setup_title')).setDescription(t(lang, 'about.setup_intro'));
            for (let i = 1; i <= 7; i++) {
                embed.addFields({ name: t(lang, `about.s${i}_title`), value: t(lang, `about.s${i}_body`) });
            }
        } else if (page === 'members') {
            embed.setTitle(t(lang, 'about.m_title'));
            for (let i = 1; i <= 4; i++) {
                embed.addFields({ name: t(lang, `about.m${i}_title`), value: t(lang, `about.m${i}_body`) });
            }
        } else {
            embed.setDescription(t(lang, 'about.description')).addFields(
                { name: t(lang, 'about.f_safety_title'), value: t(lang, 'about.f_safety_body') },
                { name: t(lang, 'about.f_art_title'), value: t(lang, 'about.f_art_body') },
                { name: t(lang, 'about.f_community_title'), value: t(lang, 'about.f_community_body') },
                { name: t(lang, 'about.f_fun_title'), value: t(lang, 'about.f_fun_body') }
            );
        }
        return embed;
    },

    buildAboutRow(lang, current) {
        const btn = (page, labelKey) => new ButtonBuilder()
            .setCustomId(`astra_about_${page}`)
            .setLabel(t(lang, labelKey))
            .setStyle(page === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(page === current);
        return new ActionRowBuilder().addComponents(
            btn('overview', 'about.btn_overview'),
            btn('setup', 'about.btn_setup'),
            btn('members', 'about.btn_members')
        );
    },

    async executeSlashAbout(interaction) {
        const lang = await getGuildLanguage(interaction.guild.id);
        return interaction.reply({
            embeds: [this.buildAboutPage(interaction.client, lang, 'overview')],
            components: [this.buildAboutRow(lang, 'overview')],
            ephemeral: true
        });
    },

    // Page buttons on /about (customId astra_about_<page>).
    async handleAboutButton(interaction) {
        const page = interaction.customId.replace('astra_about_', '');
        const safe = ['overview', 'setup', 'members'].includes(page) ? page : 'overview';
        const lang = await getGuildLanguage(interaction.guild.id);
        return interaction.update({
            embeds: [this.buildAboutPage(interaction.client, lang, safe)],
            components: [this.buildAboutRow(lang, safe)]
        });
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
                { name: t(lang, 'quickstart.step5_title'), value: t(lang, 'quickstart.step5_desc') },
                { name: t(lang, 'quickstart.step6_title'), value: t(lang, 'quickstart.step6_desc') },
                { name: t(lang, 'quickstart.step7_title'), value: t(lang, 'quickstart.step7_desc') }
            )
            .setFooter({ text: t(lang, 'quickstart.footer'), iconURL: interaction.client.user.displayAvatarURL() });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List what Astra can do'),

    // ---- /help: one section at a time, picked from a menu. Each person only
    // sees the sections that apply to them (admins see setup/community,
    // moderators see moderation, and so on). Permissions are re-checked every
    // time a section is opened, never trusted from the menu itself.
    async helpFlags(member) {
        const admin = await isAstraAdmin(member);
        const superAdmin = await isServerAdministrator(member);
        const artist = admin || await require('./tickets').isArtist(member);
        const p = member?.permissions;
        const mod = admin || !!(p && (p.has(PermissionFlagsBits.BanMembers) || p.has(PermissionFlagsBits.KickMembers)
            || p.has(PermissionFlagsBits.ModerateMembers) || p.has(PermissionFlagsBits.ManageMessages)));
        return { admin, superAdmin, artist, mod };
    },

    // [id, emoji, title key, body key(s), allowed?]
    helpSections(flags) {
        return [
            { id: 'basics',    emoji: '👤', title: 'help.everyone',        body: ['help.intro', 'help.everyone_body'], ok: true },
            { id: 'levels',    emoji: '⭐', title: 'help.levels',          body: ['help.levels_body'],     ok: true },
            { id: 'economy',   emoji: '💰', title: 'help.economy',         body: ['help.economy_body'],    ok: true },
            { id: 'fun',       emoji: '💬', title: 'help.fun',             body: ['help.fun_body'],        ok: true },
            { id: 'data',      emoji: '🔒', title: 'help.data',            body: ['help.data_body'],       ok: true },
            { id: 'artists',   emoji: '🎨', title: 'help.artists',         body: ['help.artist_body'],     ok: flags.artist },
            { id: 'moderation',emoji: '🛡️', title: 'help.moderation',      body: ['help.moderation_body'], ok: flags.mod },
            { id: 'setup',     emoji: '🛠️', title: 'help.admin_setup',     body: ['help.newhere_body', 'help.admin_setup_body'], ok: flags.admin },
            { id: 'community', emoji: '🏘️', title: 'help.admin_community', body: ['help.admin_community_body'], ok: flags.admin },
            { id: 'serveradmin',emoji: '👑', title: 'help.superadmins',    body: ['help.superadmin_body'], ok: flags.superAdmin },
        ].filter((x) => x.ok);
    },

    buildHelpPage(client, lang, sectionId, flags) {
        const sections = this.helpSections(flags);
        const section = sections.find((x) => x.id === sectionId);
        const embed = new EmbedBuilder()
            .setAuthor({ name: t(lang, 'help.title'), iconURL: client.user.displayAvatarURL() })
            .setColor('#5865F2')
            .setFooter({ text: (flags.admin ? t(lang, 'help.footer_admin') : t(lang, 'help.footer_member')), iconURL: client.user.displayAvatarURL() });

        if (!section) {
            embed.setDescription(t(lang, 'help.home_intro') + '\n\n' +
                sections.map((x) => `${x.emoji} **${t(lang, x.title)}**`).join('\n'));
        } else {
            embed.setTitle(`${section.emoji} ${t(lang, section.title)}`)
                .setDescription(section.body.map((k) => t(lang, k)).join('\n\n'));
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('astra_help_menu')
            .setPlaceholder(t(lang, 'help.menu_placeholder'))
            .addOptions([
                { label: t(lang, 'help.menu_home'), value: 'home', emoji: '🏠', default: !section },
                ...sections.map((x) => ({ label: t(lang, x.title).slice(0, 100), value: x.id, emoji: x.emoji, default: x.id === sectionId })),
            ]);
        return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
    },

    async executeSlash(interaction) {
        const lang = await getGuildLanguage(interaction.guild.id);
        const flags = await this.helpFlags(interaction.member);
        return interaction.reply({ ...this.buildHelpPage(interaction.client, lang, 'home', flags), ephemeral: true });
    },

    async handleHelpMenu(interaction) {
        const lang = await getGuildLanguage(interaction.guild.id);
        const flags = await this.helpFlags(interaction.member);
        const page = this.buildHelpPage(interaction.client, lang, interaction.values[0], flags);
        return interaction.update(page);
    }
};