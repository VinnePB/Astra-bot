const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
require('dotenv').config();

const db = require('./database');

const setupCommands = require('./commands/setup');
const ticketButtons = require('./interactions/ticketButtons');
const infoMenu = require('./interactions/infoMenu');
const verifyButton = require('./interactions/verifyButton');
const configCommand = require('./slashCommands/config');

process.on('unhandledRejection', (reason, promise) => console.error('❌ Erro: Rejection não tratada:', reason));
process.on('uncaughtException', (error, origin) => console.error('❌ Erro: Exceção não capturada:', error));

// ==========================================
// SERVIDOR WEB E DASHBOARD
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true })); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'uma_chave_secreta_aqui',
    resave: false,
    saveUninitialized: false
}));

const siteData = { 
    title: 'Astra Security', 
    subtitle: 'Control & Configuration Panel', 
    welcome_message: 'Welcome to the management center. Log in with your Discord account to configure your server\'s verification and log systems.', 
    login_button: 'Login with Discord' 
};

app.get('/', (req, res) => {
    res.render('index', siteData);
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

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        req.session.user = userResponse.data;
        res.redirect('/dashboard');
    } catch (error) {
        console.error('❌ Auth Error:', error.response ? error.response.data : error.message);
        res.send('Authentication error: ' + (error.response ? JSON.stringify(error.response.data) : error.message));
    }
});

// Rotas de Seleção de Servidor
app.get('/select-server', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.render('select_server', { user: req.session.user });
});

app.post('/select-server', (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    req.session.selectedGuildId = req.body.guild_id;
    res.redirect('/dashboard');
});

// Dashboard Route com lógica de Onboarding
app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server'); 

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        if (rows.length === 0) {
            res.render('onboarding', { user: req.session.user });
        } else {
            res.render('dashboard', { user: req.session.user, settings: rows[0] });
        }
    } catch (err) {
        console.error("Dashboard DB Error:", err);
        res.status(500).send("Server error");
    }
});

// Rota de POST para atualizar configurações
app.post('/api/update-verification', async (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    
    const { guild_id, two_step, member_role_id } = req.body;
    const twoStepBool = two_step === 'on';

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, two_step_enabled, member_role_id) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (guild_id) 
            DO UPDATE SET 
                two_step_enabled = EXCLUDED.two_step_enabled, 
                member_role_id = EXCLUDED.member_role_id
        `, [guild_id, twoStepBool, member_role_id]);
        
        res.redirect('/dashboard');
    } catch (err) {
        console.error("Database Update Error:", err);
        res.status(500).send("Error saving settings.");
    }
});

app.listen(PORT, () => {
    console.log(`🌐 [Web Server] Port ${PORT} open for Dashboard.`);
});

// ==========================================
// CONFIGURAÇÃO DO CLIENT DO DISCORD
// ==========================================
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
        await db.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS two_step_enabled BOOLEAN DEFAULT FALSE;');
        console.log("✅ Database synced (two_step_enabled column verified).");
    } catch (err) {
        console.error("❌ Database sync error:", err);
    }
    console.log(`🚀 Astra online with 2-Step Verification support!`);
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