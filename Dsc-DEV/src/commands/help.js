const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAstraAdmin, isServerAdministrator } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List what Astra can do'),

    async executeSlash(interaction) {
        const admin = await isAstraAdmin(interaction.member);
        const superAdmin = await isServerAdministrator(interaction.member);

        const embed = new EmbedBuilder()
            .setTitle('🤖 Astra — Commands')
            .setColor('#2b2d31')
            .setDescription(
                'Click **I Agree** in the rules channel, then type `!verify` in the verify channel ' +
                '(or vice versa) to unlock the rest of the server. Anything else typed in the verify ' +
                'channel gets removed with a reminder.'
            );

        if (admin) {
            const adminCommands = [
                '`/config verification` — Set up the rules/verify channels, buttons, and required roles.',
                '`/config antiscam` — Flag or auto-kick likely scam/spam accounts on join.',
                '`/config tickets` — Set up the commission ticket panel and category.',
                '`/config artist-roles add/remove/list` — Roles that automatically count as artists.',
                '`/artist add/remove/list` — Register individual artists.',
            ];
            embed.addFields({ name: 'Astra Admins', value: adminCommands.join('\n') });
        }

        if (admin) {
            const artistCommands = [
                '`/panel set-tos` / `set-wontdo` / `set-price` — Customize your commission panel.',
                '`/panel reset` — Reset part of your panel back to Astra\'s default template.',
                '`/panel preview` — See how your panel looks to ticket-openers.',
            ];
            embed.addFields({ name: 'Artists', value: artistCommands.join('\n') });
        }

        if (superAdmin) {
            const ownerCommands = [
                '`/config admins add role:@Role` — Grant a role permission to configure Astra.',
                '`/config admins remove role:@Role` — Revoke a role\'s permission to configure Astra.',
                '`/config admins list` — See which roles currently have access.',
            ];
            embed.addFields({ name: 'Server Administrators', value: ownerCommands.join('\n') });
        }

        if (!admin) {
            embed.setFooter({ text: 'Some commands are hidden — ask a server admin for access if you need to configure Astra.' });
        }

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};