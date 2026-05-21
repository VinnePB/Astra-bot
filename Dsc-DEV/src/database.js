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
        
        // Garante que a tabela de configurações exista assim que conectar
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id VARCHAR(30) PRIMARY KEY,
                    verify_channel_id VARCHAR(30),
                    member_role_id VARCHAR(30),
                    log_channel_id VARCHAR(30)
                );
            `);
            console.log('🗄️ [PostgreSQL] Tabela guild_settings pronta e verificada.');
        } catch (tableErr) {
            console.error('❌ [PostgreSQL] Erro ao criar a tabela guild_settings:', tableErr);
        } finally {
            client.release();
        }
    })
    .catch(err => {
        console.error('❌ [PostgreSQL] Erro crítico ao conectar no banco de dados:', err);
    });

module.exports = pool;