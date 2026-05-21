require('dotenv').config();
const { REST, Routes } = require('discord.js');
const configCommand = require('./src/slashCommands/config.js');

const commands = [configCommand.data.toJSON()];
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`⏳ Começando a registrar os Slash Commands (/) ...`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log(`✅ Slash Commands registrados com sucesso no Discord!`);
    } catch (error) {
        console.error(error);
    }
})();