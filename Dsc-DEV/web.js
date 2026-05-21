const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const app = express();
const port = process.env.PORT || 3000;

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

app.get('/', (req, res) => res.render('index', { 
    title: 'Astra', 
    subtitle: 'Panel', 
    welcome_message: 'Login to start', 
    login_button: 'Login' 
}));

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

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.listen(port, () => console.log(`🌐 [Web Server] Online on port ${port}`));