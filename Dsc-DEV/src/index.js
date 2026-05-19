const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express'); // Adicionado para a Render não derrubar o bot
require('dotenv').config();

const setupCommands = require('./commands/setup');
const ticketButtons = require('./interactions/ticketButtons');
const infoMenu = require('./interactions/infoMenu');
const verifyButton = require('./interactions/verifyButton');

process.on('unhandledRejection', (reason, promise) => console.error('❌ Erro: Rejection não tratada:', reason));
process.on('uncaughtException', (error, origin) => console.error('❌ Erro: Exceção não capturada:', error));

// ==========================================
// SERVIDOR WEB PARA MANTER O BOT ALIVE
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🚀 Astra Bot está online e operando em nuvem perfeitamente!');
});

app.listen(PORT, () => {
    console.log(`🌐 [Web Server] Porta ${PORT} aberta para pings do UptimeRobot.`);
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

// CORRIGIDO: De 'clientReady' para 'ready'
client.once('ready', () => {
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
// MONITOR DE INTERAÇÕES (Botões e Menus)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isButton()) {
        await ticketButtons.handleButton(interaction);
        await verifyButton.handleButton(interaction);
    }

    if (interaction.isStringSelectMenu()) {
        await infoMenu.handleMenu(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);