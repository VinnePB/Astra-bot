const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const db = require('./database');
const configCommand = require('./commands/config');
const helpCommand = require('./commands/help');
const ticketsCommand = require('./commands/tickets');

process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('❌ Uncaught Exception:', error));

const app = express();
const PORT = process.env.PORT || 3000;

// REQUIRED behind Render's proxy — without this, Express can't correctly
// detect that the connection is HTTPS, which would silently break
// `cookie.secure: true` below (the cookie would never actually get set).
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

if (!process.env.SESSION_SECRET) {
    console.warn('⚠️  SESSION_SECRET is not set — using an insecure fallback value that is visible in this codebase. ' +
        'Set a real, random SESSION_SECRET in your environment variables (Render → Environment) before relying on this in production. ' +
        'Without it, anyone with a copy of this code could forge session cookies.');
}

app.use(session({
    store: new pgSession({
        pool: db.pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secret_DO_NOT_USE_IN_PRODUCTION',
    resave: false,
    saveUninitialized: false,
    rolling: true, // refreshes the cookie's expiry on every request, so an
                    // active user never gets logged out mid-use — only
                    // 30 days of total inactivity does that.
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: true,     // Render always serves this over HTTPS; requires trust proxy above to work correctly.
        httpOnly: true,   // blocks any client-side JS (including injected/XSS) from reading the cookie.
        sameSite: 'lax'   // blocks cross-site requests from using the cookie, while still allowing the Discord OAuth redirect back to this site.
    }
}));

// Discord access tokens expire (~7 days). Previously nothing refreshed
// them, so after expiry every Discord API call (guilds/channels/roles)
// silently started failing — the session cookie stayed "logged in" but the
// data behind it was stale/broken, which is what looked like the site
// losing sync with the real server. This refreshes proactively before
// that happens.
async function refreshDiscordToken(req) {
    if (!req.session.refreshToken) return false;
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: req.session.refreshToken,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        req.session.token = tokenResponse.data.access_token;
        req.session.refreshToken = tokenResponse.data.refresh_token;
        req.session.tokenExpiresAt = Date.now() + tokenResponse.data.expires_in * 1000;
        return true;
    } catch (err) {
        console.error('❌ Failed to refresh Discord token:', err.response?.data || err.message);
        return false;
    }
}

const checkAuth = async (req, res, next) => {
    if (!req.session.user || !req.session.token) return res.redirect('/');

    // Refresh a minute before actual expiry, not after — avoids a request
    // failing partway through with a now-dead token.
    const expiresAt = req.session.tokenExpiresAt || 0;
    if (Date.now() > expiresAt - 60_000) {
        const refreshed = await refreshDiscordToken(req);
        if (!refreshed) {
            // Refresh token is also dead/revoked — nothing left to do but
            // have them log in again for real, cleanly, rather than limping
            // along with broken data.
            return req.session.destroy(() => res.redirect('/'));
        }
    }

    next();
};

// --- ROUTES ---

app.get('/', (req, res) => res.render('index', { title: 'Astra', subtitle: 'Panel', welcome_message: 'Login to start', login_button: 'Login' }));

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/login', (req, res) => {
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Error.');
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        req.session.token = tokenResponse.data.access_token;
        req.session.refreshToken = tokenResponse.data.refresh_token;
        req.session.tokenExpiresAt = Date.now() + tokenResponse.data.expires_in * 1000;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${req.session.token}` } });
        req.session.user = userResponse.data;
        res.redirect('/select-server');
    } catch (error) { res.send('Auth failed.'); }
});

// Permissions requested for the bot invite link: View Channels, Send
// Messages, Embed Links, Read Message History, Manage Messages, Manage
// Channels, Manage Roles, Kick Members — everything Astra's features
// actually use. Adjust via Discord's own permission calculator if you want
// to change this later.
const BOT_INVITE_PERMISSIONS = '268528658';

app.get('/select-server', checkAuth, async (req, res) => {
    try {
        const [userGuildsResp, botGuildsResp] = await Promise.all([
            axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.token}` } }),
            axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } })
        ]);

        const botGuildIds = new Set(botGuildsResp.data.map(g => g.id));
        const adminGuilds = userGuildsResp.data.filter(g => (BigInt(g.permissions) & 8n) === 8n);

        // NEW: split into servers Astra is actually in vs. ones she isn't —
        // this is what was missing before. The old version showed every
        // server you administer, bot or no bot, which meant picking one
        // Astra hadn't been invited to just produced a confusing empty
        // dashboard with no explanation.
        const guildsWithBot = adminGuilds.filter(g => botGuildIds.has(g.id));
        const guildsWithoutBot = adminGuilds.filter(g => !botGuildIds.has(g.id));

        res.render('select_server', {
            user: req.session.user,
            guildsWithBot,
            guildsWithoutBot,
            clientId: process.env.DISCORD_CLIENT_ID,
            botInvitePermissions: BOT_INVITE_PERMISSIONS
        });
    } catch (err) {
        console.error('❌ Error fetching guilds:', err);
        res.status(500).send("Error fetching servers.");
    }
});

app.post('/select-server', checkAuth, async (req, res) => {
    // SECURITY FIX: this used to trust req.body.guild_id outright. A crafted
    // POST with a different guild_id would have let someone manage a server
    // they have no actual Administrator permission on — anyone who could
    // reach this endpoint (not just legitimate admins) could point it at any
    // server Astra is in. Now it re-checks against Discord's own record of
    // which servers this authenticated user actually administers, the same
    // way the GET route already filters the list they see.
    try {
        const [guildsResp, botGuildsResp] = await Promise.all([
            axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.token}` } }),
            axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } })
        ]);
        const adminGuildIds = new Set(
            guildsResp.data.filter(g => (BigInt(g.permissions) & 8n) === 8n).map(g => g.id)
        );
        const botGuildIds = new Set(botGuildsResp.data.map(g => g.id));

        if (!adminGuildIds.has(req.body.guild_id)) {
            return res.status(403).send('You do not have Administrator permission on that server.');
        }
        if (!botGuildIds.has(req.body.guild_id)) {
            return res.status(400).send('Astra isn\'t in that server yet — invite her first from the server selection page.');
        }

        req.session.selectedGuildId = req.body.guild_id;

        // Brand-new servers (no verification set up yet) land on the
        // onboarding page instead of the full dashboard.
        const { rows } = await db.query('SELECT verify_channel_id, member_role_id FROM guild_settings WHERE guild_id = $1', [req.body.guild_id]);
        const settings = rows[0];
        const isConfigured = settings && settings.verify_channel_id && settings.member_role_id;
        res.redirect(isConfigured ? '/dashboard' : '/onboarding');
    } catch (err) {
        console.error('❌ Error validating guild selection:', err);
        res.status(500).send('Could not verify your permissions for that server.');
    }
});

app.get('/onboarding', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = rows[0] || { guild_id: guildId };
        res.render('onboarding', { user: req.session.user, settings });
    } catch (err) { res.status(500).send("DB Error."); }
});

app.get('/dashboard', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = rows[0] || { guild_id: guildId };
        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

        let channels = [], roles = [];
        try {
            const [c, r] = await Promise.all([
                axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
                axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
            ]);
            channels = c.data.filter(ch => ch.type === 0);
            roles = r.data.filter(role => role.name !== '@everyone');
        } catch (e) { console.error("Discord API fetch failed"); }

        // NEW: admin roles (for the Astra Admins panel) + artist count (for
        // the quick-stats card).
        const { rows: adminRoleRows } = await db.query('SELECT role_id FROM guild_admin_roles WHERE guild_id = $1', [guildId]);
        const adminRoles = adminRoleRows
            .map(r => roles.find(role => role.id === r.role_id))
            .filter(Boolean);

        const { rows: artistCountRows } = await db.query('SELECT COUNT(*) FROM artists WHERE guild_id = $1', [guildId]);
        const artistCount = parseInt(artistCountRows[0]?.count || '0', 10);

        res.render('dashboard', {
            user: req.session.user, settings, channels, roles, adminRoles, artistCount,
            success: req.query.status === 'success'
        });
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/update-verification', checkAuth, async (req, res) => {
    const { guild_id, verify_channel_id, rules_channel_id, rules_role_id, verify_role_id, member_role_id, log_channel_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, verify_channel_id, rules_channel_id, rules_role_id, verify_role_id, member_role_id, log_channel_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guild_id) DO UPDATE SET
                verify_channel_id = $2, rules_channel_id = NULLIF($3, ''), rules_role_id = NULLIF($4, ''),
                verify_role_id = NULLIF($5, ''), member_role_id = $6, log_channel_id = NULLIF($7, '')
        `, [guild_id, verify_channel_id, rules_channel_id, rules_role_id, verify_role_id, member_role_id, log_channel_id]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/update-antiscam', checkAuth, async (req, res) => {
    const { guild_id, antiscam_enabled, antiscam_action, antiscam_min_age_hours, antiscam_require_no_avatar } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, antiscam_enabled, antiscam_action, antiscam_min_age_hours, antiscam_require_no_avatar)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id) DO UPDATE SET
                antiscam_enabled = $2, antiscam_action = $3, antiscam_min_age_hours = $4, antiscam_require_no_avatar = $5
        `, [guild_id, antiscam_enabled === 'on', antiscam_action || 'log', parseInt(antiscam_min_age_hours, 10) || 24, antiscam_require_no_avatar === 'on']);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/update-autokick', checkAuth, async (req, res) => {
    const { guild_id, auto_kick_enabled, auto_kick_days } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, auto_kick_enabled, auto_kick_days)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id) DO UPDATE SET auto_kick_enabled = $2, auto_kick_days = $3
        `, [guild_id, auto_kick_enabled === 'on', parseInt(auto_kick_days, 10) || 2]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/admins/add', checkAuth, async (req, res) => {
    const { guild_id, role_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    if (!role_id) return res.redirect('/dashboard?status=success');

    try {
        await db.query(`INSERT INTO guild_admin_roles (guild_id, role_id) VALUES ($1, $2) ON CONFLICT (guild_id, role_id) DO NOTHING`, [guild_id, role_id]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/admins/remove', checkAuth, async (req, res) => {
    const { guild_id, role_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query('DELETE FROM guild_admin_roles WHERE guild_id = $1 AND role_id = $2', [guild_id, role_id]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// NEW: /tickets — admin-only ticket system config + artist management,
// mirroring /config tickets and /artist on Discord. Same checkAuth gate as
// /dashboard; there's no separate "is this Discord user actually an admin
// of this specific guild" check here beyond what select-server already
// filtered on (guilds where they hold Administrator), matching the rest of
// this dashboard's existing trust model.
app.get('/tickets', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');

    try {
        const { rows: settingsRows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = settingsRows[0] || { guild_id: guildId };

        const { rows: artists } = await db.query('SELECT * FROM artists WHERE guild_id = $1', [guildId]);
        const { rows: pricingRows } = await db.query('SELECT * FROM artist_pricing WHERE guild_id = $1', [guildId]);
        const pricingByArtist = {};
        for (const row of pricingRows) {
            if (!pricingByArtist[row.user_id]) pricingByArtist[row.user_id] = [];
            pricingByArtist[row.user_id].push(row);
        }

        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
        let channels = [], categories = [];
        try {
            const c = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });
            channels = c.data.filter(ch => ch.type === 0);
            categories = c.data.filter(ch => ch.type === 4);
        } catch (e) { console.error("Discord API fetch failed"); }

        // Resolve display names/avatars for each artist individually — a
        // full member-list fetch isn't needed for a handful of artists.
        const artistDetails = await Promise.all(artists.map(async (artist) => {
            try {
                const u = await axios.get(`https://discord.com/api/v10/users/${artist.user_id}`, { headers });
                return { ...artist, username: u.data.username, pricing: pricingByArtist[artist.user_id] || [] };
            } catch (e) {
                return { ...artist, username: `Unknown (${artist.user_id})`, pricing: pricingByArtist[artist.user_id] || [] };
            }
        }));

        const editingId = req.query.edit || null;
        const editingArtist = editingId ? artistDetails.find(a => a.user_id === editingId) : null;

        res.render('tickets', {
            user: req.session.user, settings, channels, categories,
            artists: artistDetails, editingArtist,
            pricingCategories: ['Headshot', 'Bust', 'Full Body', 'Colored', 'Flat / Lineart'],
            success: req.query.status === 'success'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("DB Error.");
    }
});

app.post('/api/tickets/config', checkAuth, async (req, res) => {
    const { guild_id, ticket_channel_id, ticket_category_id, log_channel_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, ticket_channel_id, ticket_category_id, log_channel_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id) DO UPDATE SET
                ticket_channel_id = $2, ticket_category_id = $3,
                log_channel_id = COALESCE(NULLIF($4, ''), guild_settings.log_channel_id)
        `, [guild_id, ticket_channel_id, ticket_category_id, log_channel_id]);
        res.redirect('/tickets?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/artists/add', checkAuth, async (req, res) => {
    const { guild_id, user_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    if (!/^\d{15,25}$/.test(user_id || '')) return res.status(400).send('Invalid Discord User ID.');

    try {
        await db.query(`INSERT INTO artists (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`, [guild_id, user_id]);
        res.redirect('/tickets?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/artists/remove', checkAuth, async (req, res) => {
    const { guild_id, user_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query('DELETE FROM artists WHERE guild_id = $1 AND user_id = $2', [guild_id, user_id]);
        await db.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2', [guild_id, user_id]);
        res.redirect('/tickets?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/artists/panel', checkAuth, async (req, res) => {
    const { guild_id, user_id, tos_text, wontdo_text } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const pricingCategories = ['Headshot', 'Bust', 'Full Body', 'Colored', 'Flat / Lineart'];

    try {
        await db.query(
            `UPDATE artists SET tos_text = NULLIF($1, ''), wontdo_text = NULLIF($2, '') WHERE guild_id = $3 AND user_id = $4`,
            [tos_text, wontdo_text, guild_id, user_id]
        );

        for (let i = 0; i < pricingCategories.length; i++) {
            const category = pricingCategories[i];
            const price = req.body[`price_${i}`];
            if (!price) continue;
            await db.query(
                `INSERT INTO artist_pricing (guild_id, user_id, category, price, sort_order) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (guild_id, user_id, category) DO UPDATE SET price = EXCLUDED.price`,
                [guild_id, user_id, category, price, i]
            );
        }

        res.redirect('/tickets?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.listen(PORT, () => console.log(`🌐 Dashboard on ${PORT}`));

// --- BOT ---

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });
        console.log('🧹 Global commands cleared.');

        const commands = [
            configCommand.data.toJSON(),
            helpCommand.data.toJSON(),
            ticketsCommand.artistData.toJSON(),
            ticketsCommand.panelData.toJSON()
        ];

        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const result = await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
                    { body: commands }
                );
                console.log(`✅ Synced to guild ${guild.name} (${guildId}):`, result.map(c => c.name));
            } catch (guildErr) {
                console.error(`❌ Failed to sync commands to guild ${guildId}:`, guildErr.message);
            }
        }
        console.log('🔄 Command sync pass complete.');
    } catch (error) {
        console.error('❌ Error synchronizing commands:', error);
    }

    console.log(`🚀 Astra online.`);
});

// NEW: nudges brand-new members toward the rules/verify channel right away.
// This is the "instantly popped as a suggestion" behavior — since a bot
// can't force-open a channel on someone's client, a short-lived welcome
// message pointing them at it (posted in that channel, so it also shows up
// as unread for them) is the practical equivalent.
client.on('guildMemberAdd', async (member) => {
    const kicked = await configCommand.checkScamSignals(member);
    if (!kicked) await configCommand.handleNewMember(member);
});

// NEW: Chat B moderation — deletes anything that isn't "!verify" in the
// configured verify channel (dual-role mode only) and warns the sender.
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    await configCommand.executeMessage(message);
});

// NEW: auto-kick sweep for members who never finished verification.
// Runs once shortly after startup, then every hour. Bot needs the
// "Kick Members" permission, and the GuildMembers privileged intent must be
// enabled for this application in the Discord Developer Portal (it already
// is, since GatewayIntentBits.GuildMembers is set above) — just flagging it
// in case this bot is ever moved to a fresh application.
setTimeout(() => configCommand.runAutoKickSweep(client), 60_000);
setInterval(() => configCommand.runAutoKickSweep(client), 60 * 60 * 1000);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'config') {
            await configCommand.executeSlash(interaction);
        } else if (interaction.commandName === 'help') {
            await helpCommand.executeSlash(interaction);
        } else if (interaction.commandName === 'artist') {
            await ticketsCommand.executeSlashArtist(interaction);
        } else if (interaction.commandName === 'panel') {
            await ticketsCommand.executeSlashPanel(interaction);
        }
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('astra_ticket_')) {
            await ticketsCommand.handleButton(interaction);
        } else {
            await configCommand.handleButton(interaction);
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'astra_ticket_artist_select') {
            await ticketsCommand.handleSelectMenu(interaction);
        } else {
            await configCommand.handleMenu(interaction);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);