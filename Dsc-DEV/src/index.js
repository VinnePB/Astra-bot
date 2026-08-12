const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const db = require('./database');
const coreFeature = require('./commands/core');

process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('❌ Uncaught Exception:', error));

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({
        // FIX: database.js used to do `module.exports = pool;`, which means
        // `db` WAS the pool. `db.pool` was therefore undefined, and connect-pg-simple
        // was silently given no real Pool to use, which could break session
        // persistence (login state not surviving as expected). database.js now
        // exports `{ pool, query }`, so `db.pool` is a real Pool instance again.
        pool: db.pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (!req.session.user || !req.session.token) return res.redirect('/');
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
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${req.session.token}` } });
        req.session.user = userResponse.data;
        res.redirect('/select-server');
    } catch (error) { res.send('Auth failed.'); }
});

app.get('/select-server', checkAuth, async (req, res) => {
    try {
        const guilds = await axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.token}` } });
        res.render('select_server', { user: req.session.user, guilds: guilds.data.filter(g => (BigInt(g.permissions) & 8n) === 8n) });
    } catch (err) { res.status(500).send("Error fetching servers."); }
});

app.post('/select-server', checkAuth, (req, res) => {
    req.session.selectedGuildId = req.body.guild_id;
    res.redirect('/dashboard');
});

app.get('/dashboard', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = rows[0] || { guild_id: guildId, two_step_enabled: false, member_role_id: '', log_channel_id: '' };
        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

        let channels = [], roles = [];
        try {
            const [c, r] = await Promise.all([
                axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
                axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
            ]);
            channels = c.data.filter(ch => ch.type === 0);
            roles = r.data;
        } catch (e) { console.error("Discord API fetch failed"); }

        res.render('dashboard', { user: req.session.user, settings, channels, roles, success: req.query.status === 'success' });
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/update-verification', checkAuth, async (req, res) => {
    const { guild_id, two_step, member_role_id, log_channel_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`INSERT INTO guild_settings (guild_id, two_step_enabled, member_role_id, log_channel_id) VALUES ($1, $2, $3, $4) ON CONFLICT (guild_id) DO UPDATE SET two_step_enabled = $2, member_role_id = $3, log_channel_id = $4`, [guild_id, two_step === 'on', member_role_id, log_channel_id]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.listen(PORT, () => console.log(`🌐 Dashboard on ${PORT}`));

// --- BOT ---

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});

client.once('ready', async () => {
    // FIX: removed the redundant `CREATE TABLE IF NOT EXISTS guild_settings (...)`
    // and the redundant `session` table setup that used to live here.
    // Both were racing against (and losing to) database.js's schema setup, which
    // runs earlier and faster. That race is exactly why two_step_enabled never
    // actually got created — this file's CREATE TABLE defined the column, but
    // by the time it ran the table already existed from database.js, so
    // "IF NOT EXISTS" made this a silent no-op. All schema setup now lives
    // solely in database.js.

    // Força a sincronização agressiva dos comandos na API do Discord
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        // 1. Zera qualquer comando global preso em cache
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: [] }
        );
        console.log('🧹 Global commands cleared.');

        // 2. Injeta o novo comando em inglês diretamente no registro do seu servidor
        const commands = [coreFeature.data.toJSON()];
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const result = await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
                    { body: commands }
                );
                // FIX: log per-guild success with the actual command names Discord
                // confirms it registered. Previously any failure (e.g. missing
                // applications.commands scope -> 403) was caught by a single generic
                // catch below and easily missed, which is a common cause of "the old
                // slash command just won't go away" — the sync silently failed.
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

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    await coreFeature.executeMessage(message);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'config') {
            await coreFeature.executeSlash(interaction);
        }
    } else if (interaction.isButton()) {
        await coreFeature.handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
        await coreFeature.handleMenu(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);