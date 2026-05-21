const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
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
                .addStringOption(option => 
                    option.setName('titulo')
                        .setDescription('Título do painel (Opcional)')
                        .setRequired(false))
                .addStringOption(option => 
                    option.setName('descricao')
                        .setDescription('Texto das regras (Use \\n para pular linha. Opcional)')
                        .setRequired(false))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const verifyChannel = interaction.options.getChannel('canal_verificacao');
        const memberRole = interaction.options.getRole('cargo_membro');
        const logChannel = interaction.options.getChannel('canal_logs');
        const logChannelId = logChannel ? logChannel.id : null;
        
        // Pega os textos personalizados ou usa padrões
        const titulo = interaction.options.getString('titulo') || '🔒 Sistema de Verificação — Astra';
        const descricaoRaw = interaction.options.getString('descricao') || 'Para garantir a segurança do servidor e liberar o acesso aos demais canais, clique no botão **Verificar** abaixo.';
        const descricao = descricaoRaw.replace(/\\n/g, '\n');

        try {
            // Salva ou atualiza com as novas colunas
            await db.query(`
                INSERT INTO guild_settings (guild_id, verify_channel_id, member_role_id, log_channel_id, embed_title, embed_description)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (guild_id)
                DO UPDATE SET 
                    verify_channel_id = EXCLUDED.verify_channel_id,
                    member_role_id = EXCLUDED.member_role_id,
                    log_channel_id = EXCLUDED.log_channel_id,
                    embed_title = EXCLUDED.embed_title,
                    embed_description = EXCLUDED.embed_description;
            `, [guildId, verifyChannel.id, memberRole.id, logChannelId, titulo, descricao]);

            const embed = new EmbedBuilder()
                .setTitle(titulo)
                .setDescription(descricao)
                .setColor('#2b2d31')
                .setFooter({ text: 'Astra Security System' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('botao_verificar_membro') // Mantendo o ID original
                    .setLabel('Verificar')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

            await verifyChannel.send({ embeds: [embed], components: [row] });

            await interaction.editReply({
                content: `✅ **Astra configurada com sucesso!**\n📍 Painel enviado em: ${verifyChannel}\n🛡️ Cargo definido: ${memberRole}`,
            });

        } catch (error) {
            console.error('❌ Erro ao salvar configurações no banco:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao salvar as configurações no banco de dados.',
            });
        }
    },
};