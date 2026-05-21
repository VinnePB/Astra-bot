const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura os canais e cargos da Astra para este servidor.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('verificacao')
                .setDescription('Configura o sistema de verificação')
                .addChannelOption(option => 
                    option.setName('canal_verificacao')
                        .setDescription('Onde o botão de verificar vai ficar')
                        .setRequired(true))
                .addRoleOption(option => 
                    option.setName('cargo_membro')
                        .setDescription('Cargo que o usuário ganha ao se verificar')
                        .setRequired(true))
                .addChannelOption(option => 
                    option.setName('canal_logs')
                        .setDescription('Canal para registrar as verificações')
                        .setRequired(false))
        ),

    async execute(interaction) {
        await interaction.reply({ 
            content: '⚙️ Comando de configuração recebido! Construção da lógica em andamento...', 
            ephemeral: true 
        });
    },
};