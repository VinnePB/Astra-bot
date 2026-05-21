const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
require('dotenv').config();

// Adicionado para permitir a query de atualização do banco
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

// Configuração de Sessão
app.use(session({
    secret: process.env.SESSION_SECRET || 'uma_chave_secreta_aqui',
    resave: false,
    saveUninitialized: false
}));

const translations = {
    'pt': { title: 'Astra Security', subtitle: 'Painel de Controle e Configuração', welcome_message: 'Bem-vindo à central de gerenciamento. Conecte-se com sua conta do Discord para configurar os sistemas de verificação e logs do seu servidor.', login_button: 'Entrar com o Discord', lang: 'pt-BR' },
    'en': { title: 'Astra Security', subtitle: 'Control & Configuration Panel', welcome_message: 'Welcome to the management center. Log in with your Discord account to configure your server\'s verification and log systems.', login_button: 'Login with Discord', lang: 'en' }
};

app.get('/', (req, res) => {
    const langHeader = req.acceptsLanguages('pt', 'en') || 'pt';
    const data = translations[langHeader];
    res.render('index', data);
});

app.get('/login', (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Erro: Nenhum código fornecido.');

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

        // Salva o usuário na sessão e redireciona
        req.session.user = userResponse.data;
        res.redirect('/dashboard');
    } catch (error) {
        console.error('❌ Erro no Callback:', error.response ? error.response.data : error.message);
        res.send('Erro ao autenticar: ' + (error.response ? JSON.stringify(error.response.data) : error.message));
    }
});

// Nova rota da Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.render('dashboard', { user: req.session.user });
});

app.listen(PORT, () => {
    console.log(`🌐 [Web Server] Porta ${PORT} aberta para a Dashboard e pings.`);
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
    // Garante a existência da coluna no banco antes de rodar qualquer coisa
    try {
        await db.query('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS two_step_enabled BOOLEAN DEFAULT FALSE;');
        console.log("✅ Banco de dados verificado (two_step_enabled pronta).");
    } catch (err) {
        console.error("❌ Falha ao verificar banco de dados no ready:", err);
    }
    console.log(`🚀 Astra online com sistema de Dupla Verificação ativo!`);
});

// ==========================================
// MONITOR DE COMANDOS POR TEXTO
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    await setupCommands.execute(message);
    await verifyButton.handleTextVerify(message);
});

// ==========================================
// MONITOR DE INTERAÇÕES (Botões, Menus e Slash)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'config') {
            try {
                await configCommand.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({ 
                    content: '❌ Ocorreu um erro ao tentar executar este comando.', 
                    ephemeral: true 
                });
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