const { Client, GatewayIntentBits, Partials } = require('discord.js');
require('dotenv').config();

const setupCommands = require('./commands/setup');
const ticketButtons = require('./interactions/ticketButtons');
const infoMenu = require('./interactions/infoMenu');
const verifyButton = require('./interactions/verifyButton');

process.on('unhandledRejection', (reason, promise) => console.error('❌ Erro: Rejection não tratada:', reason));
process.on('uncaughtException', (error, origin) => console.error('❌ Erro: Exceção não capturada:', error));

const client = new Client({
    // Liberando a leitura completa de mensagens e membros sem cargo
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});

client.once('clientReady', () => {
    console.log(`🚀 Astra online com sistema de Dupla Verificação ativo!`);
});

// ==========================================
// MONITOR DE COMANDOS POR TEXTO
// ==========================================
client.on('messageCreate', async (message) => {
    // Ignora se for mensagem do próprio bot ou fora de servidores
    if (message.author.bot || !message.guild) return;

    // Executa os comandos !setup e !setupverify
    await setupCommands.execute(message);

    // Executa a verificação por texto (!verify)
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