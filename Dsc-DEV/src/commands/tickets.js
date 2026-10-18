const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelType, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder
} = require('discord.js');
const db = require('../database');
const { isAstraAdmin, isServerAdministrator } = require('../permissions');
const { t } = require('../i18n');
const { logAction } = require('./config');

const DEFAULT_TOS = 'By opening a ticket, you agree to pay as arranged before or during work, allow reasonable time for completion, and understand revisions beyond what\'s offered may cost extra.';
const DEFAULT_WONTDO = 'NSFW/R18 content, hate symbols or extremist imagery, real-person likeness without consent, heavy mecha/vehicles.';
const DEFAULT_ASKME = 'Feel free to ask about styles, turnaround time, or anything not covered here!';
const PRICING_CATEGORIES = ['Headshot', 'Bust', 'Full Body', 'Colored', 'Flat / Lineart'];
const DEFAULT_PRICE = 'Message me for pricing';

const CLOSE_REASON_MIN = 10;
const CLOSE_REASON_MAX = 300;
const CLOSE_RETRY_MS = 10 * 60 * 1000; // how long the opener waits after a declined request

// --- SHARED HELPERS ---

// Who may close a ticket and answer close requests: the ticket's artist, the server
// owner / a Discord Administrator, and the server's ticket staff (middleman) role.
// An Astra Admin role on its own is deliberately NOT enough: it does not see tickets.
async function isTicketStaff(member, ticket) {
    if (!member || !ticket) return false;
    if (member.id === ticket.artist_id) return true;
    if (await isServerAdministrator(member)) return true;
    const gs = (await db.query('SELECT ticket_staff_role_id FROM guild_settings WHERE guild_id = $1', [ticket.guild_id])).rows[0];
    return !!(gs?.ticket_staff_role_id && member.roles?.cache?.has(gs.ticket_staff_role_id));
}

// Ticket events (opened / middleman called / closed) go to the server owner by DM
// and, when one is set, to the log channel. Never the conversation itself.
async function ticketLog(guild, text) {
    try {
        const gs = (await db.query('SELECT log_channel_id FROM guild_settings WHERE guild_id = $1', [guild.id])).rows[0];
        if (gs?.log_channel_id) {
            const ch = await guild.channels.fetch(gs.log_channel_id).catch(() => null);
            if (ch) await ch.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
        }
        const owner = await guild.fetchOwner().catch(() => null);
        if (owner) await owner.send({ content: `**${guild.name}**\n${text}`, allowedMentions: { parse: [] } }).catch(() => {});
    } catch (e) { console.error('⚠️ Ticket log failed:', e.message); }
}

async function isArtist(member) {
    if (!member || !member.guild) return false;

    const { rows: roleRows } = await db.query('SELECT role_id FROM guild_artist_roles WHERE guild_id = $1', [member.guild.id]);
    if (roleRows.some(r => member.roles.cache.has(r.role_id))) return true;

    const { rows } = await db.query('SELECT 1 FROM artists WHERE guild_id = $1 AND user_id = $2', [member.guild.id, member.id]);
    return rows.length > 0;
}

// The server's first configured artist role (never a powerful one) that Astra is
// allowed to hand out. Registering an artist gives it, un-registering takes it back.
async function primaryArtistRole(guild) {
    const { isPowerfulRole } = require('../permissions');
    const { rows } = await db.query('SELECT role_id FROM guild_artist_roles WHERE guild_id = $1', [guild.id]);
    return rows.map((r) => guild.roles.cache.get(r.role_id)).find((r) => r && r.editable && !r.managed && !isPowerfulRole(r)) || null;
}
async function grantArtistRole(guild, userId) {
    try {
        const role = await primaryArtistRole(guild);
        const member = role && await guild.members.fetch(userId).catch(() => null);
        if (member && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Astra: registered artist');
        return role;
    } catch (e) { console.error('❌ Could not give the artist role:', e.message); return null; }
}
async function revokeArtistRole(guild, userId) {
    try {
        const role = await primaryArtistRole(guild);
        const member = role && await guild.members.fetch(userId).catch(() => null);
        if (member && member.roles.cache.has(role.id)) await member.roles.remove(role, 'Astra: no longer a registered artist');
        return role;
    } catch (e) { console.error('❌ Could not take the artist role:', e.message); return null; }
}

async function ensureArtistRow(guildId, userId) {
    await db.query(
        `INSERT INTO artists (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`,
        [guildId, userId]
    );
}

async function getArtistProfile(guildId, userId) {
    const { rows } = await db.query(
        `SELECT tos_text, wontdo_text, askme_text, banner_url,
                link_portfolio, link_twitter, link_instagram, link_other, link_other_label
         FROM artists WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId]
    );
    return rows[0] || {
        tos_text: null, wontdo_text: null, askme_text: null, banner_url: null,
        link_portfolio: null, link_twitter: null, link_instagram: null, link_other: null, link_other_label: null
    };
}

// Only accepts http(s) URLs — Discord's Link-style buttons and embed
// image/URL fields reject anything else anyway, but checking here lets us
// give a clear error instead of a cryptic Discord API rejection.
function isValidUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

// Up to 4 Link-style buttons (Portfolio, Twitter/X, Instagram, and a
// free-label "Other" slot), built from whichever of an artist's link
// fields are actually set. Returns null if none are set, so callers can
// skip adding an empty row.
function buildArtistLinkRow(profile) {
    const buttons = [];
    if (profile.link_portfolio) {
        buttons.push(new ButtonBuilder().setLabel('Portfolio').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(profile.link_portfolio));
    }
    if (profile.link_twitter) {
        buttons.push(new ButtonBuilder().setLabel('Twitter / X').setEmoji('🐦').setStyle(ButtonStyle.Link).setURL(profile.link_twitter));
    }
    if (profile.link_instagram) {
        buttons.push(new ButtonBuilder().setLabel('Instagram').setEmoji('📸').setStyle(ButtonStyle.Link).setURL(profile.link_instagram));
    }
    if (profile.link_other) {
        buttons.push(new ButtonBuilder().setLabel((profile.link_other_label || 'More').slice(0, 80)).setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(profile.link_other));
    }
    if (buttons.length === 0) return null;
    return new ActionRowBuilder().addComponents(buttons);
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
    const embed = new EmbedBuilder()
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
    if (profile.banner_url) embed.setImage(profile.banner_url);
    return embed;
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
        new ButtonBuilder().setCustomId('astra_panel_edit_askme').setLabel('Edit Ask Me').setEmoji('🙋').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('astra_panel_edit_banner').setLabel('Edit Banner').setEmoji('🖼️').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('astra_panel_edit_links').setLabel('Edit Links').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
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

// Checks for an existing open ticket, but doesn't trust the database row
// blindly — if the channel was deleted by hand (dragged to trash, cleaned
// up manually) instead of via the Close Ticket button, the row would
// otherwise linger forever and permanently block that user from opening a
// new ticket. This confirms the channel is actually still there before
// treating it as a real block, and quietly cleans up the stale row if not.
async function findRealOpenTicket(guild, userId) {
    const { rows } = await db.query('SELECT channel_id FROM tickets WHERE guild_id = $1 AND user_id = $2', [guild.id, userId]);
    if (rows.length === 0) return null;

    const channel = await guild.channels.fetch(rows[0].channel_id).catch(() => null);
    if (channel) return rows[0].channel_id;

    // Channel's gone — the row was stale. Clean it up and report "no open ticket".
    await db.query('DELETE FROM tickets WHERE guild_id = $1 AND user_id = $2', [guild.id, userId]);
    return null;
}

// Shared close logic — used by the in-channel Close Ticket button AND the
// remote close buttons in /tickets. Returns { ok, message } rather than
// replying directly, so both callers can wrap it in their own interaction
// response.
async function closeTicketByChannelId(guild, channelId, closedByUser, options = {}) {
    const { rows } = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channelId]);
    const ticket = rows[0];
    if (!ticket) return { ok: false, message: '❌ That ticket is already closed.' };

    // The person who opened a ticket cannot close it themselves: they ask, with a
    // reason, and the artist or an admin decides (see requestClose / approve below).
    if (!(await isTicketStaff(options.member || null, ticket))) {
        return { ok: false, message: '❌ Only the ticket\'s artist or an admin can close this. If you opened it, press Close Ticket inside the ticket and give a reason.' };
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);

    const why = ticket.close_reason ? `, reason: ${String(ticket.close_reason).slice(0, 300)}` : '';
    await ticketLog(guild, `🎫 Ticket closed: #${channel ? channel.name : 'unknown'} (opener: <@${ticket.user_id}>, artist: <@${ticket.artist_id}>, closed by: ${closedByUser}${why})`);

    // A copy of the conversation goes privately to the artist before the channel is deleted.
    if (channel && channel.messages) await deliverTranscript(guild, channel, ticket, closedByUser);

    await db.query('DELETE FROM tickets WHERE channel_id = $1', [channelId]);
    if (channel) setTimeout(() => channel.delete().catch(() => {}), 5000);

    return { ok: true, message: `✅ Closed <#${channelId}>.` };
}

const TRANSCRIPT_MAX_MESSAGES = 3000;
const TRANSCRIPT_MAX_CHARS = 7_000_000; // stays well under Discord's attachment limit
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// Reads the ticket channel (oldest first) and writes it as a plain text file.
// Nothing is stored: the file is only sent to the artist when the ticket closes.
async function buildTranscript(channel, ticket, { guild, closedBy, reason }) {
    const all = [];
    let before;
    while (all.length < TRANSCRIPT_MAX_MESSAGES) {
        const batch = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 }).catch(() => null);
        if (!batch || batch.size === 0) break;
        all.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = [];
    for (const m of all) {
        if (m.system) continue;
        const name = m.member?.displayName || m.author?.username || 'unknown';
        const head = `[${stamp(m.createdTimestamp)}] ${name} (${m.author?.id || '?'}): `;
        const body = String(m.cleanContent || m.content || '').replace(/\r/g, '');
        const extra = [];
        for (const a of m.attachments?.values?.() || []) extra.push(`[attachment] ${a.name || 'file'} ${a.url || ''}`.trim());
        for (const e of m.embeds || []) if (e.title || e.description) extra.push(`[embed] ${[e.title, e.description].filter(Boolean).join(' - ').slice(0, 300)}`);
        const text = [body, ...extra].filter(Boolean).join('\n').split('\n').join('\n    ');
        if (text) lines.push(head + text);
    }

    const header = [
        `Ticket transcript - #${channel.name || 'ticket'}`,
        `Server: ${guild.name}`,
        `Opened by: ${ticket.user_id}`,
        `Artist: ${ticket.artist_id}`,
        `Opened: ${ticket.created_at ? stamp(new Date(ticket.created_at).getTime()) : 'unknown'}`,
        `Closed: ${stamp(Date.now())} by ${closedBy?.username || closedBy?.id || 'unknown'}`,
        `Close reason: ${ticket.close_reason || '-'}`,
        `Messages: ${lines.length}`,
        '(Attachment links may stop working after a while, since Discord removes files from deleted channels.)',
        '', '',
    ].join('\n');
    let text = header + lines.join('\n');
    if (text.length > TRANSCRIPT_MAX_CHARS) text = text.slice(0, TRANSCRIPT_MAX_CHARS) + '\n[transcript cut: too long]';
    return { text, count: lines.length };
}

// Sends the transcript privately to the ticket's artist. If their DMs are closed it
// goes to the server owner instead; either way it never blocks closing.
async function deliverTranscript(guild, channel, ticket, closedBy) {
    try {
        const { text, count } = await buildTranscript(channel, ticket, { guild, closedBy, reason: ticket.close_reason });
        if (count === 0) return;
        const file = () => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${String(channel.name || 'ticket').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.txt` });
        const note = `📄 Transcript of **#${channel.name || 'ticket'}** in **${guild.name}**: ${count} message(s), closed by ${closedBy?.username || 'staff'}.`;
        let sent = false;
        try {
            const user = await (guild.client || channel.client).users.fetch(ticket.artist_id);
            await user.send({ content: note, files: [file()] });
            sent = true;
        } catch (_) { /* DMs closed or user gone */ }
        if (!sent) {
            // The artist can't be reached: the server owner gets it (the log channel is visible to staff, so not there).
            const owner = await guild.fetchOwner().catch(() => null);
            if (owner) await owner.send({ content: `${note} (The artist's DMs are closed, so it is sent to you.)`, files: [file()] }).catch(() => {});
        }
    } catch (e) {
        console.error('❌ Ticket transcript failed:', e.message);
    }
}

// The opener or the artist asks for the server's ticket staff (middleman) to join.
// Only then does that role get to see this ticket.
async function callMiddleman(interaction) {
    const lang = await getGuildLanguage(interaction.guild.id);
    const { rows } = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [interaction.channel.id]);
    const ticket = rows[0];
    if (!ticket) return interaction.reply({ content: '❌ This doesn\'t look like an active ticket channel.', ephemeral: true });
    if (interaction.user.id !== ticket.user_id && interaction.user.id !== ticket.artist_id) {
        return interaction.reply({ content: t(lang, 'tickets.middleman_parties_only'), ephemeral: true });
    }
    if (ticket.staff_called) return interaction.reply({ content: t(lang, 'tickets.middleman_already'), ephemeral: true });
    const gs = (await db.query('SELECT ticket_staff_role_id FROM guild_settings WHERE guild_id = $1', [interaction.guild.id])).rows[0];
    const role = gs?.ticket_staff_role_id && interaction.guild.roles.cache.get(gs.ticket_staff_role_id);
    if (!role) return interaction.reply({ content: t(lang, 'tickets.middleman_none'), ephemeral: true });

    await interaction.channel.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    await db.query('UPDATE tickets SET staff_called = TRUE WHERE channel_id = $1', [ticket.channel_id]);
    await interaction.reply({ content: t(lang, 'tickets.middleman_called', { user: interaction.user.toString(), role: `<@&${role.id}>` }), allowedMentions: { roles: [role.id] } });
    await ticketLog(interaction.guild, `🎫 Middleman called in ${interaction.channel} by ${interaction.user}`);
}

// The opener asked to close: show the artist/admin the reason with Approve / Keep open.
async function requestClose(interaction, reason) {
    const lang = await getGuildLanguage(interaction.guild.id);
    const { rows } = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [interaction.channel.id]);
    const ticket = rows[0];
    if (!ticket) return interaction.reply({ content: '❌ This doesn\'t look like an active ticket channel.', ephemeral: true });
    if (interaction.user.id !== ticket.user_id) return interaction.reply({ content: t(lang, 'tickets.close_only_staff'), ephemeral: true });
    const problem = closeRequestProblem(ticket, lang);
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    const text = String(reason || '').trim().replace(/\s+/g, ' ');
    if (text.length < CLOSE_REASON_MIN) return interaction.reply({ content: t(lang, 'tickets.close_reason_short', { min: CLOSE_REASON_MIN }), ephemeral: true });

    const embed = new EmbedBuilder().setColor('#F59E0B')
        .setTitle(t(lang, 'tickets.close_request_title'))
        .setDescription(t(lang, 'tickets.close_request_body', { user: `<@${ticket.user_id}>`, reason: text.slice(0, CLOSE_REASON_MAX) }));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('astra_ticket_close_approve').setLabel(t(lang, 'tickets.close_approve_button')).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('astra_ticket_close_deny').setLabel(t(lang, 'tickets.close_deny_button')).setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: t(lang, 'tickets.close_sent'), ephemeral: true });
    const msg = await interaction.channel.send({
        content: `<@${ticket.artist_id}>`, embeds: [embed], components: [row],
        allowedMentions: { users: [ticket.artist_id] },
    });
    await db.query(
        'UPDATE tickets SET close_reason = $2, close_requested_at = NOW(), close_message_id = $3, close_denied_at = NULL WHERE channel_id = $1',
        [ticket.channel_id, text.slice(0, CLOSE_REASON_MAX), msg.id]
    );
}

// Why the opener cannot ask right now (a request is already waiting, or one was just declined). null = fine.
function closeRequestProblem(ticket, lang) {
    if (ticket.close_message_id) return t(lang, 'tickets.close_pending');
    const denied = ticket.close_denied_at ? new Date(ticket.close_denied_at).getTime() : 0;
    const left = denied + CLOSE_RETRY_MS - Date.now();
    if (denied && left > 0) return t(lang, 'tickets.close_cooldown', { minutes: Math.max(1, Math.ceil(left / 60000)) });
    return null;
}

// The artist/admin pressed Approve or Keep open on a request.
async function answerCloseRequest(interaction, approve) {
    const lang = await getGuildLanguage(interaction.guild.id);
    const { rows } = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [interaction.channel.id]);
    const ticket = rows[0];
    if (!ticket) return interaction.reply({ content: t(lang, 'tickets.close_gone'), ephemeral: true });
    if (!(await isTicketStaff(interaction.member, ticket))) return interaction.reply({ content: t(lang, 'tickets.close_only_staff'), ephemeral: true });
    if (!ticket.close_message_id || ticket.close_message_id !== interaction.message.id) {
        return interaction.reply({ content: t(lang, 'tickets.close_gone'), ephemeral: true });
    }
    await interaction.update({ components: [] });
    if (approve) {
        await interaction.channel.send({ content: t(lang, 'tickets.close_approved', { staff: interaction.user.toString() }), allowedMentions: { parse: [] } });
        await closeTicketByChannelId(interaction.guild, interaction.channel.id, interaction.user, { member: interaction.member });
        return;
    }
    await db.query('UPDATE tickets SET close_message_id = NULL, close_requested_at = NULL, close_denied_at = NOW() WHERE channel_id = $1', [ticket.channel_id]);
    await interaction.channel.send({ content: t(lang, 'tickets.close_denied', { staff: interaction.user.toString() }), allowedMentions: { parse: [] } });
}

module.exports = {
    _test: { close: closeTicketByChannelId, requestClose, answer: answerCloseRequest, buildTranscript, callMiddleman },
    isArtist,
    grantArtistRole,
    revokeArtistRole,
    DEFAULTS: { tos: DEFAULT_TOS, wontdo: DEFAULT_WONTDO, askme: DEFAULT_ASKME, price: DEFAULT_PRICE },
    PRICING_CATEGORIES,
    findRealOpenTicket,
    ensureArtistSetupChannel,

    // --- /tickets — see and manage tickets you're involved in, whether
    // you're the artist assigned to them or the person who opened them.
    // Replaces the old /myticket, which only checked tickets you'd
    // personally opened — useless to an artist checking what's waiting on
    // them. Each listed ticket gets its own Close button, so an artist
    // never has to go dig up a channel they lost track of.
    ticketsOverviewData: new SlashCommandBuilder()
        .setName('tickets')
        .setDescription('See tickets assigned to you or opened by you, and close them if needed'),

    async executeSlashTicketsOverview(interaction) {
        const guild = interaction.guild;
        const userId = interaction.user.id;

        const { rows: asArtistRaw } = await db.query('SELECT channel_id, user_id FROM tickets WHERE guild_id = $1 AND artist_id = $2', [guild.id, userId]);
        const { rows: asOpenerRaw } = await db.query('SELECT channel_id, artist_id FROM tickets WHERE guild_id = $1 AND user_id = $2', [guild.id, userId]);

        // Self-heal: drop rows whose channel no longer exists rather than
        // showing (and letting someone try to close) a phantom ticket.
        const asArtist = [];
        for (const row of asArtistRaw) {
            const ch = await guild.channels.fetch(row.channel_id).catch(() => null);
            if (ch) asArtist.push(row); else await db.query('DELETE FROM tickets WHERE channel_id = $1', [row.channel_id]);
        }
        const asOpener = [];
        for (const row of asOpenerRaw) {
            const ch = await guild.channels.fetch(row.channel_id).catch(() => null);
            if (ch) asOpener.push(row); else await db.query('DELETE FROM tickets WHERE channel_id = $1', [row.channel_id]);
        }

        if (asArtist.length === 0 && asOpener.length === 0) {
            return interaction.reply({ content: "You don't have any open tickets right now.", ephemeral: true });
        }

        let description = '';
        if (asArtist.length > 0) {
            description += '**Assigned to you as artist:**\n' + asArtist.map(r => `<#${r.channel_id}> — opened by <@${r.user_id}>`).join('\n') + '\n\n';
        }
        if (asOpener.length > 0) {
            description += '**Your own open ticket(s):**\n' + asOpener.map(r => `<#${r.channel_id}> — artist <@${r.artist_id}>`).join('\n');
            description += '\n*' + t(await getGuildLanguage(guild.id), 'tickets.opener_close_hint') + '*';
        }

        // Discord caps at 5 buttons/row and 5 rows — 25 tickets max, plenty
        // of headroom for this use case.
        const allChannelIds = asArtist.map(r => r.channel_id).slice(0, 25); // only the artist side can close from here
        const rows = [];
        for (let i = 0; i < allChannelIds.length; i += 5) {
            const chunk = allChannelIds.slice(i, i + 5);
            rows.push(new ActionRowBuilder().addComponents(
                chunk.map((channelId, idx) => new ButtonBuilder()
                    .setCustomId(`astra_ticket_remote_close_${channelId}`)
                    .setLabel(`Close #${i + idx + 1}`)
                    .setStyle(ButtonStyle.Danger))
            ));
        }

        return interaction.reply({ content: description, components: rows, ephemeral: true, allowedMentions: { parse: [] } });
    },

    // --- /artists — public, browsable artist directory. Anyone can run it:
    // it lists every registered artist and lets you pick one from a menu to
    // see their full commission panel (ToS, pricing, banner, links) privately.
    // Separate from the admin-only /artist add/remove/list on purpose.
    artistsDirectoryData: new SlashCommandBuilder()
        .setName('artists')
        .setDescription('Browse this server\'s commission artists and see their info'),

    async executeSlashArtistsDirectory(interaction) {
        const guild = interaction.guild;
        const lang = await getGuildLanguage(guild.id);

        await interaction.deferReply({ ephemeral: true });
        const artistList = await getArtistList(guild);
        if (artistList.length === 0) {
            return interaction.editReply({ content: t(lang, 'artists.empty') });
        }

        const settingsRows = (await db.query('SELECT ticket_channel_id FROM guild_settings WHERE guild_id = $1', [guild.id])).rows;
        const ticketChannelId = settingsRows[0]?.ticket_channel_id;

        const lines = artistList.map(([id]) => `🎨 <@${id}>`).join('\n');
        let description = `${lines}\n\n${t(lang, 'artists.pick_hint')}`;
        if (ticketChannelId) description += `\n${t(lang, 'artists.ticket_hint', { channel: `<#${ticketChannelId}>` })}`;

        const embed = new EmbedBuilder()
            .setTitle(t(lang, 'artists.title'))
            .setColor('#5865F2')
            .setDescription(description)
            .setFooter({ text: t(lang, 'artists.count', { count: artistList.length }) });
        const icon = guild.iconURL();
        if (icon) embed.setThumbnail(icon);

        const menu = new StringSelectMenuBuilder()
            .setCustomId('astra_artist_directory')
            .setPlaceholder(t(lang, 'artists.placeholder'))
            .addOptions(artistList.map(([id, name]) => ({ label: String(name).slice(0, 100), value: id })));

        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    },

    // Picking an artist replies with a NEW private message (instead of
    // editing the directory), so the menu stays usable to browse others.
    async handleArtistDirectorySelect(interaction) {
        const guild = interaction.guild;
        const lang = await getGuildLanguage(guild.id);
        const artistId = interaction.values[0];

        const artistMember = await guild.members.fetch(artistId).catch(() => null);
        if (!artistMember) {
            return interaction.reply({ content: t(lang, 'artists.not_found'), ephemeral: true });
        }

        const profile = await getArtistProfile(guild.id, artistId);
        const pricing = await getArtistPricing(guild.id, artistId);
        const linkRow = buildArtistLinkRow(profile);
        return interaction.reply({
            embeds: [buildPanelEmbed(artistMember, profile, pricing)],
            components: linkRow ? [linkRow] : [],
            ephemeral: true
        });
    },

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

                const artistRole = await grantArtistRole(interaction.guild, user.id);
                let channelNote = ' They can run `/panel` to customize their ToS, won\'t-do list, and pricing.' + (artistRole ? ` I gave them ${artistRole.name}.` : '');
                const setupChannel = await ensureArtistSetupChannel(interaction.guild, user.id).catch(err => {
                    console.error('❌ Error creating artist setup channel:', err);
                    return null;
                });
                if (setupChannel) channelNote = ` I've also created a private setup channel for them: ${setupChannel}.`;

                await logAction(interaction.guild, `🎨 ${interaction.user} registered ${user} as an artist.`);
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
                await revokeArtistRole(interaction.guild, user.id);
                await logAction(interaction.guild, `🎨 ${interaction.user} removed ${user} as a registered artist.`);
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
            sub.setName('set-banner')
                .setDescription('Set a banner image shown on your panel')
                .addStringOption(o => o.setName('url').setDescription('Direct image URL (https://...)').setRequired(true))
                .addUserOption(o => o.setName('artist').setDescription('(Admins only) edit another artist\'s panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('set-link')
                .setDescription('Set one of your panel\'s social/portfolio link buttons')
                .addStringOption(o => o.setName('platform').setDescription('Which link slot to set').setRequired(true)
                    .addChoices(
                        { name: 'Portfolio / Website', value: 'portfolio' },
                        { name: 'Twitter / X', value: 'twitter' },
                        { name: 'Instagram', value: 'instagram' },
                        { name: 'Other', value: 'other' }
                    ))
                .addStringOption(o => o.setName('url').setDescription('Link URL (https://...)').setRequired(true))
                .addStringOption(o => o.setName('label').setDescription('Button label — only used for "Other"').setRequired(false))
                .addUserOption(o => o.setName('artist').setDescription('(Admins only) edit another artist\'s panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('remove-link')
                .setDescription('Remove one of your panel\'s link buttons')
                .addStringOption(o => o.setName('platform').setDescription('Which link slot to clear').setRequired(true)
                    .addChoices(
                        { name: 'Portfolio / Website', value: 'portfolio' },
                        { name: 'Twitter / X', value: 'twitter' },
                        { name: 'Instagram', value: 'instagram' },
                        { name: 'Other', value: 'other' }
                    ))
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
                        { name: 'Banner Image', value: 'banner' },
                        { name: 'Links', value: 'links' },
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
            const linkRow = buildArtistLinkRow(profile);
            return interaction.reply({ embeds: [buildPanelEmbed(artistMember, profile, pricing)], components: linkRow ? [linkRow] : [], ephemeral: true });
        }

        try {
            await ensureArtistRow(guildId, artistUser.id);

            if (sub === 'set-tos') {
                const text = interaction.options.getString('text');
                await db.query('UPDATE artists SET tos_text = $1 WHERE guild_id = $2 AND user_id = $3', [text, guildId, artistUser.id]);
                await logAction(interaction.guild, `🎨 ${interaction.user} updated ${artistUser}'s Terms of Service.`);
                return interaction.reply({ content: `✅ ToS updated for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'set-wontdo') {
                const text = interaction.options.getString('text');
                await db.query('UPDATE artists SET wontdo_text = $1 WHERE guild_id = $2 AND user_id = $3', [text, guildId, artistUser.id]);
                await logAction(interaction.guild, `🎨 ${interaction.user} updated ${artistUser}'s Won't-Do list.`);
                return interaction.reply({ content: `✅ Won't-do list updated for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'set-askme') {
                const text = interaction.options.getString('text');
                await db.query('UPDATE artists SET askme_text = $1 WHERE guild_id = $2 AND user_id = $3', [text, guildId, artistUser.id]);
                await logAction(interaction.guild, `🎨 ${interaction.user} updated ${artistUser}'s Ask-Me text.`);
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
                await logAction(interaction.guild, `🎨 ${interaction.user} set ${artistUser}'s ${category} price to "${amount}".`);
                return interaction.reply({ content: `✅ ${category} price set to "${amount}" for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'set-banner') {
                const url = interaction.options.getString('url');
                if (!isValidUrl(url)) {
                    return interaction.reply({ content: '❌ That doesn\'t look like a valid URL — it needs to start with http:// or https://.', ephemeral: true });
                }
                await db.query('UPDATE artists SET banner_url = $1 WHERE guild_id = $2 AND user_id = $3', [url, guildId, artistUser.id]);
                await logAction(interaction.guild, `🎨 ${interaction.user} updated ${artistUser}'s panel banner.`);
                return interaction.reply({ content: `✅ Banner image updated for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'set-link') {
                const platform = interaction.options.getString('platform');
                const url = interaction.options.getString('url');
                const label = interaction.options.getString('label');
                if (!isValidUrl(url)) {
                    return interaction.reply({ content: '❌ That doesn\'t look like a valid URL — it needs to start with http:// or https://.', ephemeral: true });
                }
                if (platform === 'other') {
                    await db.query('UPDATE artists SET link_other = $1, link_other_label = $2 WHERE guild_id = $3 AND user_id = $4', [url, (label || 'More').slice(0, 30), guildId, artistUser.id]);
                } else {
                    const column = { portfolio: 'link_portfolio', twitter: 'link_twitter', instagram: 'link_instagram' }[platform];
                    await db.query(`UPDATE artists SET ${column} = $1 WHERE guild_id = $2 AND user_id = $3`, [url, guildId, artistUser.id]);
                }
                await logAction(interaction.guild, `🎨 ${interaction.user} updated ${artistUser}'s ${platform} link.`);
                return interaction.reply({ content: `✅ ${platform} link updated for ${artistUser}.`, ephemeral: true });
            }

            if (sub === 'remove-link') {
                const platform = interaction.options.getString('platform');
                if (platform === 'other') {
                    await db.query('UPDATE artists SET link_other = NULL, link_other_label = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
                } else {
                    const column = { portfolio: 'link_portfolio', twitter: 'link_twitter', instagram: 'link_instagram' }[platform];
                    await db.query(`UPDATE artists SET ${column} = NULL WHERE guild_id = $1 AND user_id = $2`, [guildId, artistUser.id]);
                }
                await logAction(interaction.guild, `🎨 ${interaction.user} removed ${artistUser}'s ${platform} link.`);
                return interaction.reply({ content: `✅ ${platform} link removed for ${artistUser}.`, ephemeral: true });
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
                if (what === 'banner' || what === 'all') {
                    await db.query('UPDATE artists SET banner_url = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
                }
                if (what === 'links' || what === 'all') {
                    await db.query('UPDATE artists SET link_portfolio = NULL, link_twitter = NULL, link_instagram = NULL, link_other = NULL, link_other_label = NULL WHERE guild_id = $1 AND user_id = $2', [guildId, artistUser.id]);
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
            // which artist it's with. Self-heals if the old ticket's
            // channel was deleted manually instead of via Close Ticket.
            const openChannelId = await findRealOpenTicket(interaction.guild, interaction.user.id);
            if (openChannelId) {
                return interaction.reply({ content: t(lang, 'tickets.already_open', { channel: `<#${openChannelId}>` }), ephemeral: true });
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
            const lang = await getGuildLanguage(interaction.guild.id);

            // The artist and admins close right away.
            if (await isTicketStaff(interaction.member, ticket)) {
                await interaction.reply({ content: t(lang, 'tickets.closing') });
                await closeTicketByChannelId(interaction.guild, interaction.channel.id, interaction.user, { member: interaction.member });
                return;
            }
            // The person who opened it must give a reason; the artist/admin decides.
            if (interaction.user.id === ticket.user_id) {
                const problem = closeRequestProblem(ticket, lang);
                if (problem) return interaction.reply({ content: problem, ephemeral: true });
                const modal = new ModalBuilder().setCustomId('astra_ticket_close_reason').setTitle(t(lang, 'tickets.close_modal_title').slice(0, 45));
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('reason').setLabel(t(lang, 'tickets.close_modal_label').slice(0, 45))
                        .setStyle(TextInputStyle.Paragraph).setMinLength(CLOSE_REASON_MIN).setMaxLength(CLOSE_REASON_MAX).setRequired(true)
                ));
                return interaction.showModal(modal);
            }
            return interaction.reply({ content: '❌ Only the ticket\'s artist or an admin can close this.', ephemeral: true });
        }

        if (interaction.customId === 'astra_ticket_middleman') return callMiddleman(interaction);

        if (interaction.customId === 'astra_ticket_close_approve' || interaction.customId === 'astra_ticket_close_deny') {
            return answerCloseRequest(interaction, interaction.customId === 'astra_ticket_close_approve');
        }

        if (interaction.customId.startsWith('astra_ticket_remote_close_')) {
            const channelId = interaction.customId.replace('astra_ticket_remote_close_', '');
            const result = await closeTicketByChannelId(interaction.guild, channelId, interaction.user, { member: interaction.member });
            return interaction.reply({ content: result.message, ephemeral: true });
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

            if (interaction.customId === 'astra_panel_edit_banner') {
                const modal = new ModalBuilder().setCustomId('astra_panel_modal_banner').setTitle('Edit Panel Banner');
                const input = new TextInputBuilder().setCustomId('url').setLabel('Banner Image URL')
                    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)
                    .setValue(artistRow?.banner_url || '').setPlaceholder('https://example.com/your-banner.png');
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }

            if (interaction.customId === 'astra_panel_edit_links') {
                const modal = new ModalBuilder().setCustomId('astra_panel_modal_links').setTitle('Edit Panel Links');
                const portfolioInput = new TextInputBuilder().setCustomId('portfolio').setLabel('Portfolio / Website URL')
                    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setValue(artistRow?.link_portfolio || '');
                const twitterInput = new TextInputBuilder().setCustomId('twitter').setLabel('Twitter / X URL')
                    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setValue(artistRow?.link_twitter || '');
                const instagramInput = new TextInputBuilder().setCustomId('instagram').setLabel('Instagram URL')
                    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setValue(artistRow?.link_instagram || '');
                const otherLabelInput = new TextInputBuilder().setCustomId('other_label').setLabel('Other Link — Button Label')
                    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30).setValue(artistRow?.link_other_label || '').setPlaceholder('e.g. Ko-fi, Vgen');
                const otherUrlInput = new TextInputBuilder().setCustomId('other_url').setLabel('Other Link — URL')
                    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setValue(artistRow?.link_other || '');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(portfolioInput),
                    new ActionRowBuilder().addComponents(twitterInput),
                    new ActionRowBuilder().addComponents(instagramInput),
                    new ActionRowBuilder().addComponents(otherLabelInput),
                    new ActionRowBuilder().addComponents(otherUrlInput)
                );
                return interaction.showModal(modal);
            }

            if (interaction.customId === 'astra_panel_preview') {
                const member = await interaction.guild.members.fetch(artistId).catch(() => null);
                if (!member) return interaction.reply({ content: '❌ Could not find your member profile.', ephemeral: true });
                const profile = await getArtistProfile(guildId, artistId);
                const pricing = await getArtistPricing(guildId, artistId);
                const linkRow = buildArtistLinkRow(profile);
                return interaction.reply({ embeds: [buildPanelEmbed(member, profile, pricing)], components: linkRow ? [linkRow] : [], ephemeral: true });
            }

            if (interaction.customId === 'astra_panel_reset') {
                await db.query(
                    `UPDATE artists SET tos_text = NULL, wontdo_text = NULL, askme_text = NULL, banner_url = NULL,
                        link_portfolio = NULL, link_twitter = NULL, link_instagram = NULL, link_other = NULL, link_other_label = NULL
                     WHERE guild_id = $1 AND user_id = $2`,
                    [guildId, artistId]
                );
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

        const openChannelId = await findRealOpenTicket(guild, interaction.user.id);
        if (openChannelId) {
            return interaction.update({ content: t(lang, 'tickets.already_open', { channel: `<#${openChannelId}>` }), components: [] });
        }

        const settingsRows = (await db.query('SELECT ticket_category_id, log_channel_id, ticket_staff_role_id FROM guild_settings WHERE guild_id = $1', [guild.id])).rows;
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

            // Tickets are private: only the opener and the artist (plus Discord Administrators,
            // who see every channel). Astra Admin roles are not added; the ticket staff role is
            // only added when one of the two asks for a middleman.

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
            const linkRow = buildArtistLinkRow(profile);
            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('astra_ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
            );
            // "Call middleman" only appears when the server has a ticket staff role set up.
            if (settings.ticket_staff_role_id && guild.roles.cache.has(settings.ticket_staff_role_id)) {
                closeRow.addComponents(new ButtonBuilder().setCustomId('astra_ticket_middleman').setLabel(t(lang, 'tickets.middleman_button')).setStyle(ButtonStyle.Primary));
            }

            await ticketChannel.send({
                content: t(lang, 'tickets.welcome', { user: interaction.user.toString(), artist: artistMember.toString() }) + '\n' + t(lang, 'tickets.transcript_notice'),
                embeds: [buildPanelEmbed(artistMember, profile, pricing)],
                components: linkRow ? [linkRow, closeRow] : [closeRow]
            });

            await ticketLog(guild, `🎫 Ticket opened: ${ticketChannel} (opener: ${interaction.user}, artist: ${artistMember})`);
        } catch (error) {
            console.error('❌ Error creating ticket channel:', error);
            await interaction.followUp({ content: '❌ Something went wrong creating your ticket channel. An admin may need to check my permissions (Manage Channels).', ephemeral: true }).catch(() => {});
        }
    },

    async handleModalSubmit(interaction) {
        if (interaction.customId === 'astra_ticket_close_reason') {
            return requestClose(interaction, interaction.fields.getTextInputValue('reason'));
        }
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

            if (interaction.customId === 'astra_panel_modal_banner') {
                const url = interaction.fields.getTextInputValue('url').trim();
                if (url && !isValidUrl(url)) {
                    return interaction.reply({ content: '❌ That doesn\'t look like a valid URL — it needs to start with http:// or https://. Nothing was saved.', ephemeral: true });
                }
                await db.query('UPDATE artists SET banner_url = $1 WHERE guild_id = $2 AND user_id = $3', [url || null, guildId, artistId]);
                return interaction.reply({ content: '✅ Banner updated.', ephemeral: true });
            }

            if (interaction.customId === 'astra_panel_modal_links') {
                const portfolio = interaction.fields.getTextInputValue('portfolio').trim();
                const twitter = interaction.fields.getTextInputValue('twitter').trim();
                const instagram = interaction.fields.getTextInputValue('instagram').trim();
                const otherLabel = interaction.fields.getTextInputValue('other_label').trim();
                const otherUrl = interaction.fields.getTextInputValue('other_url').trim();

                const invalid = [portfolio, twitter, instagram, otherUrl].some(u => u && !isValidUrl(u));
                if (invalid) {
                    return interaction.reply({ content: '❌ One or more links don\'t look like valid URLs (need to start with http:// or https://). Nothing was saved — try again.', ephemeral: true });
                }

                await db.query(
                    `UPDATE artists SET link_portfolio = $1, link_twitter = $2, link_instagram = $3, link_other = $4, link_other_label = $5
                     WHERE guild_id = $6 AND user_id = $7`,
                    [portfolio || null, twitter || null, instagram || null, otherUrl || null, otherUrl ? (otherLabel || 'More') : null, guildId, artistId]
                );
                return interaction.reply({ content: '✅ Links updated.', ephemeral: true });
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