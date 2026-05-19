const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

// Módulos importados das subpastas dentro de src
const setupCommands = require('./commands/setup');
const ticketButtons = require('./interactions/ticketButtons');
const infoMenu = require('./interactions/infoMenu');
const verifyButton = require('./interactions/verifyButton');

// 🛡️ ESCUDO ANTI-CRASH
process.on('unhandledRejection', (reason, promise) => console.error('❌ Erro: Rejection não tratada:', reason));
process.on('uncaughtException', (error, origin) => console.error('❌ Erro: Exceção não capturada:', error));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('clientReady', () => {
    console.log(`🚀 Astra modulada e protegida! Rodando com scripts divididos perfeitamente.`);
});

// ==========================================
// MONITOR DE COMANDOS POR TEXTO
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Executa os comandos !setup e !setupverify
    await setupCommands.execute(message);
});

// ==========================================
// MONITOR DE INTERAÇÕES (Botões e Menus)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    
    // Tratamento de Cliques em Botões
    if (interaction.isButton()) {
        await ticketButtons.handleButton(interaction);
        await verifyButton.handleButton(interaction);
    }

    // Tratamento de Menus de Seleção (Abas)
    if (interaction.isStringSelectMenu()) {
        await infoMenu.handleMenu(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);