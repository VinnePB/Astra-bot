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
            .setColor('#2b2d31');

        const everyone = [
            '`!verify` — Complete step 2 of verification after clicking the button (only needed if 2FA is enabled).',
        ];
        embed.addFields({ name: 'Everyone', value: everyone.join('\n') });

        if (admin) {
            const adminCommands = [
                '`/setup` — Open the 2FA setup panel.',
                '`!setup 2fa` — Same panel, as a text command.',
                '`/config verification` — Configure the verification channel, role, and message.',
            ];
            embed.addFields({ name: 'Astra Admins', value: adminCommands.join('\n') });
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