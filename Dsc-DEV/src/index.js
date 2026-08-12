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

process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('❌ Uncaught Exception:', error));

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({
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
        const settings = rows[0] || { guild_id: guildId, member_role_id: '', log_channel_id: '' };
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
    const { guild_id, member_role_id, log_channel_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`INSERT INTO guild_settings (guild_id, member_role_id, log_channel_id) VALUES ($1, $2, $3) ON CONFLICT (guild_id) DO UPDATE SET member_role_id = $2, log_channel_id = $3`, [guild_id, member_role_id, log_channel_id]);
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
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });
        console.log('🧹 Global commands cleared.');

        const commands = [
            configCommand.data.toJSON(),
            helpCommand.data.toJSON()
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
    await configCommand.handleNewMember(member);
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
        }
    } else if (interaction.isButton()) {
        await configCommand.handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
        await configCommand.handleMenu(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);