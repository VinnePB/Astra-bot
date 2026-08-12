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
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id VARCHAR(30) PRIMARY KEY,
                    verify_channel_id VARCHAR(30),
                    member_role_id VARCHAR(30),
                    log_channel_id VARCHAR(30)
                );
            `);

            await client.query(`
                ALTER TABLE guild_settings 
                ADD COLUMN IF NOT EXISTS embed_title TEXT DEFAULT 'Sistema de Verificação',
                ADD COLUMN IF NOT EXISTS embed_description TEXT DEFAULT 'Clique no botão abaixo para verificar.',
                ADD COLUMN IF NOT EXISTS two_step_enabled BOOLEAN DEFAULT FALSE;
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS pending_verifications (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (guild_id, user_id)
                );
            `);

            // NEW: per-guild table of roles that are allowed to configure Astra
            // (verification setup, 2FA toggle) WITHOUT needing real Discord
            // Administrator permission. Only true Administrators/the guild owner
            // can add or remove rows here — see permissions.js and
            // commands/config.js "admins add/remove". This is what lets a server
            // owner say "my Moderator role can manage Astra" without handing out
            // full Administrator, and it's structured so a role granted access
            // this way can never grant itself (or anyone else) more access.
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_admin_roles (
                    guild_id VARCHAR(30) NOT NULL,
                    role_id VARCHAR(30) NOT NULL,
                    added_by VARCHAR(30),
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (guild_id, role_id)
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS "session" (
                  "sid" varchar NOT NULL COLLATE "default",
                  "sess" json NOT NULL,
                  "expire" timestamp(6) NOT NULL
                )
                WITH (OIDS=FALSE);
            `);

            await client.query(`
                ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
            `).catch(() => {});

            console.log('🗄️ [PostgreSQL] Tabelas prontas e atualizadas.');
        } catch (tableErr) {
            console.error('❌ [PostgreSQL] Erro ao configurar as tabelas:', tableErr);
        } finally {
            client.release();
        }
    })
    .catch(err => {
        console.error('❌ [PostgreSQL] Erro crítico ao conectar no banco de dados:', err);
    });

async function query(text, params) {
    return pool.query(text, params);
}

module.exports = { pool, query };