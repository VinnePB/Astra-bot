const { Pool } = require('pg');
require('dotenv').config();

// O Pool conecta automaticamente usando a variável DATABASE_URL fornecida pela Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
    .then(async client => {
        console.log('✅ [PostgreSQL] Conexão com o banco de dados estabelecida com sucesso!');
        
        try {
            // Garante que a tabela de configurações exista
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id VARCHAR(30) PRIMARY KEY,
                    verify_channel_id VARCHAR(30),
                    member_role_id VARCHAR(30),
                    log_channel_id VARCHAR(30)
                );
            `);

            // Adiciona as novas colunas caso elas ainda não existam (Migração de Schema)
            await client.query(`
                ALTER TABLE guild_settings 
                ADD COLUMN IF NOT EXISTS embed_title TEXT DEFAULT 'Sistema de Verificação',
                ADD COLUMN IF NOT EXISTS embed_description TEXT DEFAULT 'Clique no botão abaixo para verificar.';
            `);

            console.log('🗄️ [PostgreSQL] Tabela guild_settings pronta e atualizada.');
        } catch (tableErr) {
            console.error('❌ [PostgreSQL] Erro ao configurar a tabela guild_settings:', tableErr);
        } finally {
            client.release();
        }
    })
    .catch(err => {
        console.error('❌ [PostgreSQL] Erro crítico ao conectar no banco de dados:', err);
    });

module.exports = pool;