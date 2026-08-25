const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelType, PermissionFlagsBits
} = require('discord.js');
const db = require('../database');
const { isAstraAdmin } = require('../permissions');

const DEFAULT_TOS = 'By opening a ticket, you agree to pay as arranged before or during work, allow reasonable time for completion, and understand revisions beyond what\'s offered may cost extra.';
const DEFAULT_WONTDO = 'NSFW/R18 content, hate symbols or extremist imagery, real-person likeness without consent, heavy mecha/vehicles.';
const PRICING_CATEGORIES = ['Headshot', 'Bust', 'Full Body', 'Colored', 'Flat / Lineart'];
const DEFAULT_PRICE = 'Message me for pricing';

// --- SHARED HELPERS ---

async function isArtist(member) {
    if (!member || !member.guild) return false;

    const { rows: roleRows } = await db.query('SELECT role_id FROM guild_artist_roles WHERE guild_id = $1', [member.guild.id]);
    if (roleRows.some(r => member.roles.cache.has(r.role_id))) return true;

    const { rows } = await db.query('SELECT 1 FROM artists WHERE guild_id = $1 AND user_id = $2', [member.guild.id, member.id]);
    return rows.length > 0;
}

async function ensureArtistRow(guildId, userId) {
    await db.query(
        `INSERT INTO artists (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`,
        [guildId, userId]
    );
}

async function getArtistProfile(guildId, userId) {
    const { rows } = await db.query('SELECT tos_text, wontdo_text FROM artists WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    return rows[0] || { tos_text: null, wontdo_text: null };
}

async function getArtistPricing(guildId, userId) {
    const { rows } = await db.query(
        'SELECT category, price FROM artist_pricing WHERE guild_id = $1 AND user_id = $2 ORDER BY sort_order ASC',
        [guildId, userId]
    );
    const priceMap = new Map(rows.map(r => [r.category, r.price]));
    return PRICING_CATEGORIES.map(category => ({ category, price: priceMap.get(category) || DEFAULT_PRICE }));
}

// Merges explicitly-added artists (the `artists` table) with anyone
// currently holding a configured artist role, deduplicated. Capped at 25
// since that's Discord's hard limit on select menu options.
async function getArtistList(guild) {
    const artistMap = new Map();

    const { rows: explicitRows } = await db.query('SELECT user_id FROM artists WHERE guild_id = $1', [guild.id]);
    for (const row of explicitRows) {
        const member = await guild.members.fetch(row.user_id).catch(() => null);
        if (member) artistMap.set(member.id, member.displayName);
    }

    const { rows: roleRows } = await db.query('SELECT role_id FROM guild_artist_roles WHERE guild_id = $1', [guild.id]);
    if (roleRows.length > 0) {
        const members = await guild.members.fetch().catch(() => new Map());
        for (const [, member] of members) {
            if (roleRows.some(r => member.roles.cache.has(r.role_id))) {
                artistMap.set(member.id, member.displayName);
            }
        }
    }

    return Array.from(artistMap.entries()).slice(0, 25);
}

function buildPanelEmbed(artistMember, profile, pricing) {
    const pricingLines = pricing.map(p => `**${p.category}:** ${p.price}`).join('\n');
    return new EmbedBuilder()
        .setTitle(`🎨 Commission Info — ${artistMember.displayName}`)
        .addFields(
            { name: '📜 Terms of Service', value: profile.tos_text || DEFAULT_TOS },
            { name: '🚫 Won\'t Do', value: profile.wontdo_text || DEFAULT_WONTDO },
            { name: '💰 Pricing', value: pricingLines }
        )
        .setColor('#2b2d31')
        .setFooter({ text: 'Astra Ticket System' });
}

module.exports = {
    isArtist,

    // --- /artist (admin-managed registration) ---
    artistData: new SlashCommandBuilder()
        .setName('artist')
        .setDescription('Manage which members are registered as commission artists')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Register a member as an artist')
                .addUserOption(o => o.setName('user').setDescription('Member to register').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Unregister an artist')
                .addUserOption(o => o.setName('user').setDescription('Member to unregister').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all registered artists')),

    async executeSlashArtist(interaction) {
        if (!(await isAstraAdmin(interaction.member))) {
            return interaction.reply({ content: '❌ You need Administrator permission or an Astra-authorized role to do this.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'add') {
            const user = interaction.options.getUser('user');
            try {
                await db.query(
                    `INSERT INTO artists (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`,
                    [guildId, user.id]
                );
                return interaction.reply({ content: `✅ ${user} is now a registered artist. They can run \`/panel\` to customize their ToS, won't-do list, and pricing.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error adding artist:', error);
                return interaction.reply({ content: '❌ Database error while adding the artist.', ephemeral: true });
            }
        }

        if (sub === 'remove') {
            const user = interaction.options.getUser('user');
            try {
                await db.query('DELETE FROM artists WHERE guild_id = $1 AND user_id = $2', [guildId, user.id]);
                await db.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2', [guildId, user.id]);
                return interaction.reply({ content: `✅ ${user} is no longer a registered artist.`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error removing artist:', error);
                return interaction.reply({ content: '❌ Database error while removing the artist.', ephemeral: true });
            }
        }

        if (sub === 'list') {
            try {
                const artistList = await getArtistList(interaction.guild);
                if (artistList.length === 0) {
                    return interaction.reply({ content: 'No artists are registered yet — use `/artist add` or grant an artist role.', ephemeral: true });
                }
                const list = artistList.map(([id]) => `<@${id}>`).join('\n');
                return interaction.reply({ content: `**Registered artists:**\n${list}`, ephemeral: true });
            } catch (error) {
                console.error('❌ Error listing artists:', error);
                return interaction.reply({ content: '❌ Database error while listing artists.', ephemeral: true });
            }
        }
    },

    // --- /panel (artist self-service, or admin editing on an artist's behalf) ---
    panelData: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Manage a commission panel (ToS, won\'t-do list, pricing)')
        .addSubcommand(sub =>
            sub.setName('set-tos')
                .setDescription('Set your Terms of Service text')
                .addStringOption(o => o.setName('text').setDescription('New ToS text').setRequired(true))
                .addUserOption(o => o.setName('artist').setDescription('(Admins only) edit another artist\'s panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('set-wontdo')
                .setDescription('Set your Won\'t Do list')
                .addStringOption(o => o.setName('text').setDescription('New won\'t-do text').setRequired(true))
                .addUserOption(o => o.setName('artist').setDescription('(Admins only) edit another artist\'s panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('set-price')
                .setDescription('Set the price for one category')
                .addStringOption(o => o.setName('category').setDescription('Pricing category').setRequired(true)
                    .addChoices(...PRICING_CATEGORIES.map(c => ({ name: c, value: c }))))
                .addStringOption(o => o.setName('amount').setDescription('e.g. $25, 2000 JPY, "Not offered"').setRequired(true))
                .addUserOption(o => o.setName('artist').setDescription('(Admins only) edit another artist\'s panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Reset part of your panel back to the default template')
                .addStringOption(o => o.setName('what').setDescription('What to reset').setRequired(true)
                    .addChoices(
                        { name: 'Terms of Service', value: 'tos' },
                        { name: 'Won\'t Do list', value: 'wontdo' },
                        { name: 'Pricing', value: 'pricing' },
                        { name: 'Everything', value: 'all' }
                    ))
                .addUserOption(o => o.setName('artist').setDescription('(Admins only) reset another artist\'s panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('preview')
                .setDescription('See how your panel looks to ticket-openers')
                .addUserOption(o => o.setName('artist').setDescription('Preview another artist\'s panel').setRequired(false))),

    async executeSlashPanel(interaction) {
        const sub = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('artist');

        // Editing someone else's panel requires real admin access. Editing
        // your own requires being a registered artist.
        if (targetUser) {
            if (!(await isAstraAdmin(interaction.member))) {
                return interaction.reply({ content: '❌ Only Astra Admins can edit another artist\'s panel.', ephemeral: true });
            }
        } else if (sub !== 'preview') {
            if (!(await isArtist(interaction.member))) {
                return interaction.reply({ content: '❌ You\'re not a registered artist. Ask an admin to run `/artist add`, or check if you\'re missing the artist role.', ephemeral: true });
            }
        }

        const artistUser = targetUser || interaction.user;
        const guildId = interaction.guild.id;

        if (sub === 'preview') {
            const artistMember = await interaction.guild.members.fetch(artistUser.id).catch(() => null);
            if (!artistMember) return interaction.reply({ content: '❌ Could not find that member in this server.', ephemeral: true });
            const profile = await getArtistProfile(guildId, artistUser.id);
            const pricing = await getArtistPricing(guildId, artistUser.id);
            return interaction.reply({ embeds: [buildPanelEmbed(artistMember, profile, pricing)], ephemeral: true });
        }

        try {
            await ensureArtistRow(guildId, artistUser.id);

            if (sub === 'set-tos') {
                const text = interaction.options.getString('text');
                await db.query('UPDATE artists SET tos_text = $1 WHERE guild_id = $2 AND user_id = $3', [text, guildId, artistUser.id]);
                return interaction.reply({ content: `✅ ToS updated for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'set-wontdo') {
                const text = interaction.options.getString('text');
                await db.query('UPDATE artists SET wontdo_text = $1 WHERE guild_id = $2 AND user_id = $3', [text, guildId, artistUser.id]);
                return interaction.reply({ content: `✅ Won't-do list updated for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'set-price') {
                const category = interaction.options.getString('category');
                const amount = interaction.options.getString('amount');
                const sortOrder = PRICING_CATEGORIES.indexOf(category);
                await db.query(
                    `INSERT INTO artist_pricing (guild_id, user_id, category, price, sort_order) VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (guild_id, user_id, category) DO UPDATE SET price = EXCLUDED.price`,
                    [guildId, artistUser.id, category, amount, sortOrder]
                );
                return interaction.reply({ content: `✅ ${category} price set to "${amount}" for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'reset') {
                const what = interaction.options.getString('what');
                if (what === 'tos' || what === 'all') {
                    await db.query('UPDATE artists SET tos_text = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
                }
                if (what === 'wontdo' || what === 'all') {
                    await db.query('UPDATE artists SET wontdo_text = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
                }
                if (what === 'pricing' || what === 'all') {
                    await db.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
                }
                return interaction.reply({ content: `✅ Reset (${what}) for ${artistUser}.`, ephemeral: true });
            }
        } catch (error) {
            console.error('❌ Error updating panel:', error);
            return interaction.reply({ content: '❌ Database error while saving.', ephemeral: true });
        }
    },

    // --- TICKET BUTTON/SELECT-MENU FLOW ---

    async handleButton(interaction) {
        if (interaction.customId === 'astra_ticket_open') {
            const artistList = await getArtistList(interaction.guild);
            if (artistList.length === 0) {
                return interaction.reply({ content: 'No artists are currently taking tickets — check back later.', ephemeral: true });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId('astra_ticket_artist_select')
                .setPlaceholder('Choose an artist')
                .addOptions(artistList.map(([id, name]) => ({ label: name, value: id })));

            return interaction.reply({ content: 'Who would you like to open a ticket with?', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        }

        if (interaction.customId === 'astra_ticket_close') {
            const { rows } = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [interaction.channel.id]);
            const ticket = rows[0];
            if (!ticket) return interaction.reply({ content: '❌ This doesn\'t look like an active ticket channel.', ephemeral: true });

            const canClose = interaction.user.id === ticket.user_id
                || interaction.user.id === ticket.artist_id
                || await isAstraAdmin(interaction.member);

            if (!canClose) {
                return interaction.reply({ content: '❌ Only the ticket opener, the artist, or an admin can close this.', ephemeral: true });
            }

            await interaction.reply({ content: '🔒 Closing this ticket in 5 seconds...' });

            const settings = (await db.query('SELECT log_channel_id FROM guild_settings WHERE guild_id = $1', [interaction.guild.id])).rows[0];
            if (settings?.log_channel_id) {
                const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id).catch(() => null);
                if (logChannel) {
                    await logChannel.send(`🎫 Ticket closed: #${interaction.channel.name} (opener: <@${ticket.user_id}>, artist: <@${ticket.artist_id}>, closed by: ${interaction.user})`).catch(() => {});
                }
            }

            await db.query('DELETE FROM tickets WHERE channel_id = $1', [interaction.channel.id]);
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'astra_ticket_artist_select') return;

        const artistId = interaction.values[0];
        const guild = interaction.guild;

        const settingsRows = (await db.query('SELECT ticket_category_id, log_channel_id FROM guild_settings WHERE guild_id = $1', [guild.id])).rows;
        const settings = settingsRows[0];
        if (!settings || !settings.ticket_category_id) {
            return interaction.update({ content: '❌ Tickets aren\'t configured yet — ask an admin to run `/config tickets`.', components: [] });
        }

        const artistMember = await guild.members.fetch(artistId).catch(() => null);
        if (!artistMember) {
            return interaction.update({ content: '❌ That artist is no longer in the server.', components: [] });
        }

        await interaction.update({ content: `Opening your ticket with ${artistMember}...`, components: [] });

        try {
            const overwrites = [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: artistId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ];

            const { rows: adminRoleRows } = await db.query('SELECT role_id FROM guild_admin_roles WHERE guild_id = $1', [guild.id]);
            for (const row of adminRoleRows) {
                overwrites.push({ id: row.role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            }

            const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
            const ticketChannel = await guild.channels.create({
                name: channelName,
                parent: settings.ticket_category_id,
                permissionOverwrites: overwrites,
            });

            await db.query(
                'INSERT INTO tickets (channel_id, guild_id, user_id, artist_id) VALUES ($1, $2, $3, $4)',
                [ticketChannel.id, guild.id, interaction.user.id, artistId]
            );

            const profile = await getArtistProfile(guild.id, artistId);
            const pricing = await getArtistPricing(guild.id, artistId);
            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('astra_ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `${interaction.user} — welcome! ${artistMember} will be with you shortly.`,
                embeds: [buildPanelEmbed(artistMember, profile, pricing)],
                components: [closeRow]
            });

            if (settings.log_channel_id) {
                const logChannel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
                if (logChannel) {
                    await logChannel.send(`🎫 Ticket opened: ${ticketChannel} (opener: ${interaction.user}, artist: ${artistMember})`).catch(() => {});
                }
            }
        } catch (error) {
            console.error('❌ Error creating ticket channel:', error);
            await interaction.followUp({ content: '❌ Something went wrong creating your ticket channel. An admin may need to check my permissions (Manage Channels).', ephemeral: true }).catch(() => {});
        }
    }
};