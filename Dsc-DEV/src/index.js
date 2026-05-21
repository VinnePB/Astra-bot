const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const ejsMate = require('ejs-mate');
require('dotenv').config();

const db = require('./database');
const setupCommands = require('./commands/setup');
const ticketButtons = require('./interactions/ticketButtons');
const infoMenu = require('./interactions/infoMenu');
const verifyButton = require('./interactions/verifyButton');
const configCommand = require('./slashCommands/config');

process.on('unhandledRejection', (reason, promise) => console.error('❌ Error: Unhandled Rejection:', reason));
process.on('uncaughtException', (error, origin) => console.error('❌ Error: Uncaught Exception:', error));

const app = express();
const PORT = process.env.PORT || 3000;

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'uma_chave_secreta_aqui',
    resave: false,
    saveUninitialized: false
}));

const checkAuth = (req, res, next) => {
    if (!req.session.user || !req.session.token) {
        return res.redirect('/');
    }
    next();
};

app.get('/', (req, res) => {
    res.render('index', { 
        title: 'Astra Security', 
        subtitle: 'Control & Configuration Panel', 
        welcome_message: 'Log in with your Discord account to configure your server.', 
        login_button: 'Login with Discord' 
    });
});

app.get('/login', (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Error: No code provided.');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token } = tokenResponse.data;
        req.session.token = access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        req.session.user = userResponse.data;
        res.redirect('/select-server');
    } catch (error) {
        console.error('❌ Auth Error:', error.response ? error.response.data : error.message);
        res.send('Authentication error.');
    }
});

app.get('/select-server', checkAuth, async (req, res) => {
    try {
        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.session.token}` }
        });

        const adminGuilds = guildsResponse.data.filter(g => (BigInt(g.permissions) & 8n) === 8n);
        res.render('select_server', { user: req.session.user, guilds: adminGuilds });
    } catch (err) {
        console.error("API Guilds Error:", err);
        res.status(500).send("Error fetching your servers.");
    }
});

app.post('/select-server', checkAuth, (req, res) => {
    req.session.selectedGuildId = req.body.guild_id;
    res.redirect('/dashboard');
});

app.get('/dashboard', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server'); 

    // Capture success status from query parameter
    const successMsg = req.query.status === 'success' ? 'Settings updated successfully!' : null;

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = rows[0] || { guild_id: guildId, two_step_enabled: false, member_role_id: '', log_channel_id: '' };

        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
        
        const [channelsRes, rolesRes] = await Promise.all([
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
        ]);

        const textChannels = channelsRes.data.filter(c => c.type === 0);

        res.render('dashboard', { 
            user: req.session.user, 
            settings: settings,
            channels: textChannels,
            roles: rolesRes.data,
            success: successMsg // Pass the message here!
        });
    } catch (err) {
        console.error("Dashboard Fetch Error:", err.response ? err.response.data : err.message);
        res.status(500).send("Error loading dashboard.");
    }
});

app.post('/api/update-verification', checkAuth, async (req, res) => {
    const { guild_id, two_step, member_role_id, log_channel_id } = req.body;
    
    if (guild_id !== req.session.selectedGuildId) {
        return res.status(403).send('Action not allowed for this server.');
    }

    const twoStepBool = two_step === 'on';

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, two_step_enabled, member_role_id, log_channel_id) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (guild_id) 
            DO UPDATE SET 
                two_step_enabled = EXCLUDED.two_step_enabled, 
                member_role_id = EXCLUDED.member_role_id,
                log_channel_id = EXCLUDED.log_channel_id
        `, [guild_id, twoStepBool, member_role_id, log_channel_id]);
        
        res.redirect('/dashboard?status=success');
    } catch (err) {
        console.error("Database Update Error:", err);
        res.status(500).send("Error saving settings.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout Error:", err);
            return res.status(500).send("Could not log out.");
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.listen(PORT, () => {
    console.log(`🌐 [Web Server] Port ${PORT} open for Dashboard.`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});

client.once('ready', async () => {
    try {
        const queries = [
            'ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS two_step_enabled BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS member_role_id VARCHAR(30);',
            'ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS log_channel_id VARCHAR(30);'
        ];
        
        for (const query of queries) {
            await db.query(query);
        }
        console.log("✅ Database schema synchronized.");
    } catch (err) {
        console.error("❌ Database sync error:", err);
    }
    console.log(`🚀 Astra online.`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    await setupCommands.execute(message);
    await verifyButton.handleTextVerify(message);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'config') {
            try {
                await configCommand.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
            }
        }
        return;
    }

    if (interaction.isButton()) {
        await ticketButtons.handleButton(interaction);
        await verifyButton.handleButton(interaction);
    }

    if (interaction.isStringSelectMenu()) {
        await infoMenu.handleMenu(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);