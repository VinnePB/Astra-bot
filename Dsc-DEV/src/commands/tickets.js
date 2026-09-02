const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelType, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const db = require('../database');
const { isAstraAdmin } = require('../permissions');
const { t } = require('../i18n');

const DEFAULT_TOS = 'By opening a ticket, you agree to pay as arranged before or during work, allow reasonable time for completion, and understand revisions beyond what\'s offered may cost extra.';
const DEFAULT_WONTDO = 'NSFW/R18 content, hate symbols or extremist imagery, real-person likeness without consent, heavy mecha/vehicles.';
const DEFAULT_ASKME = 'Feel free to ask about styles, turnaround time, or anything not covered here!';
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
    const { rows } = await db.query('SELECT tos_text, wontdo_text, askme_text FROM artists WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    return rows[0] || { tos_text: null, wontdo_text: null, askme_text: null };
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
async function getGuildLanguage(guildId) {
    const { rows } = await db.query('SELECT language FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0]?.language;
}

async function getArtistList(guild) {    const artistMap = new Map();

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
        .setThumbnail(artistMember.displayAvatarURL())
        .addFields(
            { name: '📜 Terms of Service', value: profile.tos_text || DEFAULT_TOS },
            { name: '🚫 Won\'t Do', value: profile.wontdo_text || DEFAULT_WONTDO },
            { name: '🙋 Ask Me About', value: profile.askme_text || DEFAULT_ASKME },
            { name: '💰 Pricing', value: pricingLines }
        )
        .setColor('#2b2d31')
        .setFooter({ text: 'Astra' });
}

// Creates (or recreates, if the channel was deleted) an artist's private
// setup channel — visible only to that artist and Astra Admin roles.
// Posts the interactive editor panel. Safe to call repeatedly: if a
// channel is already recorded and still exists, it's left alone.
async function ensureArtistSetupChannel(guild, userId) {
    const settingsRows = (await db.query('SELECT artist_setup_category_id FROM guild_settings WHERE guild_id = $1', [guild.id])).rows;
    const categoryId = settingsRows[0]?.artist_setup_category_id;
    if (!categoryId) return null; // not configured — nothing to do

    const { rows } = await db.query('SELECT setup_channel_id FROM artists WHERE guild_id = $1 AND user_id = $2', [guild.id, userId]);
    const existingChannelId = rows[0]?.setup_channel_id;
    if (existingChannelId) {
        const existing = await guild.channels.fetch(existingChannelId).catch(() => null);
        if (existing) return existing; // already has a live channel
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;

    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];
    const { rows: adminRoleRows } = await db.query('SELECT role_id FROM guild_admin_roles WHERE guild_id = $1', [guild.id]);
    for (const row of adminRoleRows) {
        overwrites.push({ id: row.role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }

    const channelName = `artist-setup-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
    const channel = await guild.channels.create({
        name: channelName,
        parent: categoryId,
        permissionOverwrites: overwrites,
    });

    await ensureArtistRow(guild.id, userId);
    await db.query('UPDATE artists SET setup_channel_id = $1 WHERE guild_id = $2 AND user_id = $3', [channel.id, guild.id, userId]);

    const embed = new EmbedBuilder()
        .setTitle('🎨 Your Commission Panel')
        .setDescription('This is your private setup space — only you and server admins can see it. Use the buttons below to customize what clients see when they open a ticket with you. Anything you don\'t set falls back to Astra\'s default text.')
        .setColor('#2b2d31')
        .setFooter({ text: 'Astra' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('astra_panel_edit_tos').setLabel('Edit ToS').setEmoji('📜').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('astra_panel_edit_wontdo').setLabel('Edit Won\'t Do').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('astra_panel_edit_askme').setLabel('Edit Ask Me').setEmoji('🙋').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('astra_panel_edit_pricing').setLabel('Edit Pricing').setEmoji('💰').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('astra_panel_preview').setLabel('Preview').setEmoji('👀').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('astra_panel_reset').setLabel('Reset All').setEmoji('♻️').setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: `${member}`, embeds: [embed], components: [row1, row2] });
    return channel;
}

function buildPricingModal(existingPricing) {
    const modal = new ModalBuilder().setCustomId('astra_panel_modal_pricing').setTitle('Edit Pricing');
    for (let i = 0; i < PRICING_CATEGORIES.length; i++) {
        const category = PRICING_CATEGORIES[i];
        const existing = existingPricing.find(p => p.category === category);
        const input = new TextInputBuilder()
            .setCustomId(`price_${i}`)
            .setLabel(category)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(50)
            .setPlaceholder(DEFAULT_PRICE);
        if (existing && existing.price !== DEFAULT_PRICE) input.setValue(existing.price);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    return modal;
}

module.exports = {
    isArtist,
    ensureArtistSetupChannel,

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
                .setDescription('List all registered artists'))
        .addSubcommand(sub =>
            sub.setName('setup-channel')
                .setDescription('(Re)create an artist\'s private setup channel')
                .addUserOption(o => o.setName('user').setDescription('Artist').setRequired(true))),

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

                let channelNote = ' They can run `/panel` to customize their ToS, won\'t-do list, and pricing.';
                const setupChannel = await ensureArtistSetupChannel(interaction.guild, user.id).catch(err => {
                    console.error('❌ Error creating artist setup channel:', err);
                    return null;
                });
                if (setupChannel) channelNote = ` I've also created a private setup channel for them: ${setupChannel}.`;

                return interaction.reply({ content: `✅ ${user} is now a registered artist.${channelNote}`, ephemeral: true });
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

        if (sub === 'setup-channel') {
            const user = interaction.options.getUser('user');
            try {
                await interaction.deferReply({ ephemeral: true });
                const channel = await ensureArtistSetupChannel(interaction.guild, user.id);
                if (!channel) {
                    return interaction.editReply({ content: '❌ Couldn\'t create it — make sure `/config tickets artist_setup_category` is set, and that this member is actually in the server.' });
                }
                return interaction.editReply({ content: `✅ Setup channel ready: ${channel}` });
            } catch (error) {
                console.error('❌ Error creating setup channel:', error);
                return interaction.editReply({ content: '❌ Something went wrong. Check that Astra has Manage Channels permission.' });
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
            sub.setName('set-askme')
                .setDescription('Set what people can ask you about')
                .addStringOption(o => o.setName('text').setDescription('New ask-me text').setRequired(true))
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
                        { name: 'Ask Me About', value: 'askme' },
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

            if (sub === 'set-askme') {
                const text = interaction.options.getString('text');
                await db.query('UPDATE artists SET askme_text = $1 WHERE guild_id = $2 AND user_id = $3', [text, guildId, artistUser.id]);
                return interaction.reply({ content: `✅ Ask-me text updated for ${artistUser}.`, ephemeral: true });
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
                if (what === 'askme' || what === 'all') {
                    await db.query('UPDATE artists SET askme_text = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
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
            const lang = await getGuildLanguage(interaction.guild.id);

            // Spam guard: one open ticket per user at a time, regardless of
            // which artist it's with.
            const { rows: existingTickets } = await db.query(
                'SELECT channel_id FROM tickets WHERE guild_id = $1 AND user_id = $2',
                [interaction.guild.id, interaction.user.id]
            );
            if (existingTickets.length > 0) {
                return interaction.reply({ content: t(lang, 'tickets.already_open', { channel: `<#${existingTickets[0].channel_id}>` }), ephemeral: true });
            }

            const artistList = await getArtistList(interaction.guild);
            if (artistList.length === 0) {
                return interaction.reply({ content: t(lang, 'tickets.no_artists'), ephemeral: true });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId('astra_ticket_artist_select')
                .setPlaceholder('Choose an artist')
                .addOptions(artistList.map(([id, name]) => ({ label: name, value: id })));

            return interaction.reply({ content: t(lang, 'tickets.choose_artist'), components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
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

            const lang = await getGuildLanguage(interaction.guild.id);
            await interaction.reply({ content: t(lang, 'tickets.closing') });

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

        // --- PRIVATE ARTIST SETUP CHANNEL BUTTONS ---
        if (interaction.customId.startsWith('astra_panel_')) {
            const guildId = interaction.guild.id;
            const { rows } = await db.query('SELECT * FROM artists WHERE guild_id = $1 AND setup_channel_id = $2', [guildId, interaction.channel.id]);
            const artistRow = rows[0];

            // Only the artist this channel belongs to, or an Astra Admin, can use these buttons.
            const allowed = (artistRow && interaction.user.id === artistRow.user_id) || await isAstraAdmin(interaction.member);
            if (!allowed) {
                return interaction.reply({ content: '❌ This isn\'t your setup channel.', ephemeral: true });
            }

            const artistId = artistRow ? artistRow.user_id : interaction.user.id;

            if (interaction.customId === 'astra_panel_edit_tos') {
                const modal = new ModalBuilder().setCustomId('astra_panel_modal_tos').setTitle('Edit Terms of Service');
                const input = new TextInputBuilder().setCustomId('text').setLabel('Terms of Service')
                    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
                    .setValue(artistRow?.tos_text || '').setPlaceholder(DEFAULT_TOS);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }

            if (interaction.customId === 'astra_panel_edit_wontdo') {
                const modal = new ModalBuilder().setCustomId('astra_panel_modal_wontdo').setTitle('Edit Won\'t Do List');
                const input = new TextInputBuilder().setCustomId('text').setLabel('Won\'t Do')
                    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
                    .setValue(artistRow?.wontdo_text || '').setPlaceholder(DEFAULT_WONTDO);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }

            if (interaction.customId === 'astra_panel_edit_askme') {
                const modal = new ModalBuilder().setCustomId('astra_panel_modal_askme').setTitle('Edit Ask Me About');
                const input = new TextInputBuilder().setCustomId('text').setLabel('Ask Me About')
                    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
                    .setValue(artistRow?.askme_text || '').setPlaceholder(DEFAULT_ASKME);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }

            if (interaction.customId === 'astra_panel_edit_pricing') {
                const pricing = await getArtistPricing(guildId, artistId);
                return interaction.showModal(buildPricingModal(pricing));
            }

            if (interaction.customId === 'astra_panel_preview') {
                const member = await interaction.guild.members.fetch(artistId).catch(() => null);
                if (!member) return interaction.reply({ content: '❌ Could not find your member profile.', ephemeral: true });
                const profile = await getArtistProfile(guildId, artistId);
                const pricing = await getArtistPricing(guildId, artistId);
                return interaction.reply({ embeds: [buildPanelEmbed(member, profile, pricing)], ephemeral: true });
            }

            if (interaction.customId === 'astra_panel_reset') {
                await db.query('UPDATE artists SET tos_text = NULL, wontdo_text = NULL, askme_text = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistId]);
                await db.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2', [guildId, artistId]);
                return interaction.reply({ content: '♻️ Your panel has been reset to Astra\'s defaults.', ephemeral: true });
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'astra_ticket_artist_select') return;

        const artistId = interaction.values[0];
        const guild = interaction.guild;
        const lang = await getGuildLanguage(guild.id);

        const { rows: existingTickets } = await db.query(
            'SELECT channel_id FROM tickets WHERE guild_id = $1 AND user_id = $2',
            [guild.id, interaction.user.id]
        );
        if (existingTickets.length > 0) {
            return interaction.update({ content: t(lang, 'tickets.already_open', { channel: `<#${existingTickets[0].channel_id}>` }), components: [] });
        }

        const settingsRows = (await db.query('SELECT ticket_category_id, log_channel_id FROM guild_settings WHERE guild_id = $1', [guild.id])).rows;
        const settings = settingsRows[0];
        if (!settings || !settings.ticket_category_id) {
            return interaction.update({ content: '❌ Tickets aren\'t configured yet — ask an admin to run `/config tickets`.', components: [] });
        }

        const artistMember = await guild.members.fetch(artistId).catch(() => null);
        if (!artistMember) {
            return interaction.update({ content: '❌ That artist is no longer in the server.', components: [] });
        }

        await interaction.update({ content: t(lang, 'tickets.opening', { artist: artistMember.toString() }), components: [] });

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
                content: t(lang, 'tickets.welcome', { user: interaction.user.toString(), artist: artistMember.toString() }),
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
    },

    async handleModalSubmit(interaction) {
        if (!interaction.customId.startsWith('astra_panel_modal_')) return;

        const guildId = interaction.guild.id;
        const { rows } = await db.query('SELECT user_id FROM artists WHERE guild_id = $1 AND setup_channel_id = $2', [guildId, interaction.channel.id]);
        const artistId = rows[0]?.user_id || interaction.user.id;

        try {
            if (interaction.customId === 'astra_panel_modal_tos') {
                const text = interaction.fields.getTextInputValue('text').trim();
                await db.query('UPDATE artists SET tos_text = $1 WHERE guild_id = $2 AND user_id = $3', [text || null, guildId, artistId]);
                return interaction.reply({ content: '✅ Terms of Service updated.', ephemeral: true });
            }

            if (interaction.customId === 'astra_panel_modal_wontdo') {
                const text = interaction.fields.getTextInputValue('text').trim();
                await db.query('UPDATE artists SET wontdo_text = $1 WHERE guild_id = $2 AND user_id = $3', [text || null, guildId, artistId]);
                return interaction.reply({ content: '✅ Won\'t-do list updated.', ephemeral: true });
            }

            if (interaction.customId === 'astra_panel_modal_askme') {
                const text = interaction.fields.getTextInputValue('text').trim();
                await db.query('UPDATE artists SET askme_text = $1 WHERE guild_id = $2 AND user_id = $3', [text || null, guildId, artistId]);
                return interaction.reply({ content: '✅ Ask-me text updated.', ephemeral: true });
            }

            if (interaction.customId === 'astra_panel_modal_pricing') {
                for (let i = 0; i < PRICING_CATEGORIES.length; i++) {
                    const category = PRICING_CATEGORIES[i];
                    const value = interaction.fields.getTextInputValue(`price_${i}`).trim();
                    if (!value) {
                        await db.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2 AND category = $3', [guildId, artistId, category]);
                    } else {
                        await db.query(
                            `INSERT INTO artist_pricing (guild_id, user_id, category, price, sort_order) VALUES ($1, $2, $3, $4, $5)
                             ON CONFLICT (guild_id, user_id, category) DO UPDATE SET price = EXCLUDED.price`,
                            [guildId, artistId, category, value, i]
                        );
                    }
                }
                return interaction.reply({ content: '✅ Pricing updated.', ephemeral: true });
            }
        } catch (error) {
            console.error('❌ Error saving panel modal:', error);
            return interaction.reply({ content: '❌ Database error while saving.', ephemeral: true });
        }
    }
};