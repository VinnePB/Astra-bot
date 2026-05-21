const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const path = require('path');
require('dotenv').config();

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

app.get('/', (req, res) => {
    res.render('index');
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
// MONITOR DE INTERAÇÕES (Botões, Menus e Slash)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    // Tratamento para Slash Commands (/)
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

    // Tratamento para Botões
    if (interaction.isButton()) {
        await ticketButtons.handleButton(interaction);
        await verifyButton.handleButton(interaction);
    }

    // Tratamento para Menus de Seleção
    if (interaction.isStringSelectMenu()) {
        await infoMenu.handleMenu(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);