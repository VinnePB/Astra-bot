const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../database'); // Conexão com o pool do PostgreSQL

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
        await interaction.deferReply({ ephemeral: true }); // Dá mais tempo para o banco responder

        const guildId = interaction.guild.id;
        const verifyChannel = interaction.options.getChannel('canal_verificacao');
        const memberRole = interaction.options.getRole('cargo_membro');
        const logChannel = interaction.options.getChannel('canal_logs');
        const logChannelId = logChannel ? logChannel.id : null;

        try {
            // Salva ou atualiza as configurações do servidor atual no banco
            await db.query(`
                INSERT INTO guild_settings (guild_id, verify_channel_id, member_role_id, log_channel_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (guild_id)
                DO UPDATE SET 
                    verify_channel_id = EXCLUDED.verify_channel_id,
                    member_role_id = EXCLUDED.member_role_id,
                    log_channel_id = EXCLUDED.log_channel_id;
            `, [guildId, verifyChannel.id, memberRole.id, logChannelId]);

            // Monta o Embed do painel de verificação
            const embed = new EmbedBuilder()
                .setTitle('🔒 Sistema de Verificação — Astra')
                .setDescription('Para garantir a segurança do servidor e liberar o acesso aos demais canais, clique no botão **Verificar** abaixo.')
                .setColor('#2b2d31')
                .setFooter({ text: 'Astra Security System' });

            // Monta o botão de verificação
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_verificar_membro') // Guarde esse ID, vamos usar no seu handler de botão
                    .setLabel('Verificar')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

            // Envia o painel de verificação no canal configurado
            await verifyChannel.send({ embeds: [embed], components: [row] });

            // Confirma para o administrador que deu tudo certo
            await interaction.editReply({
                content: `✅ **Astra configurada com sucesso!**\n📍 Painel enviado em: ${verifyChannel}\n🛡️ Cargo definido: ${memberRole}\n📜 Logs: ${logChannel ? logChannel : '*Não configurado*'}`,
            });

        } catch (error) {
            console.error('❌ Erro ao salvar configurações no banco:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao salvar as configurações no banco de dados.',
            });
        }
    },
};