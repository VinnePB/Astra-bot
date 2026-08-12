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
            // FIX: this is the ONLY place guild_settings should ever be created.
            // index.js used to run a second, conflicting CREATE TABLE for this same
            // table inside client.once('ready', ...), which fired AFTER this one
            // (pool.connect() resolves way faster than the Discord gateway handshake).
            // Because both used "IF NOT EXISTS", whichever ran first silently won,
            // and the columns from the second definition (like two_step_enabled)
            // were never actually added. All schema changes now live here.
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id VARCHAR(30) PRIMARY KEY,
                    verify_channel_id VARCHAR(30),
                    member_role_id VARCHAR(30),
                    log_channel_id VARCHAR(30)
                );
            `);

            // Adiciona as novas colunas caso elas ainda não existam (Migração de Schema)
            // FIX: added two_step_enabled here — this column was previously only
            // defined in index.js's redundant CREATE TABLE, which never ran because
            // the table already existed by the time it got there. Every query that
            // referenced two_step_enabled was silently throwing a Postgres
            // "column does not exist" error, caught and swallowed by a console.error,
            // which is why the final role was never granted with no visible failure.
            await client.query(`
                ALTER TABLE guild_settings 
                ADD COLUMN IF NOT EXISTS embed_title TEXT DEFAULT 'Sistema de Verificação',
                ADD COLUMN IF NOT EXISTS embed_description TEXT DEFAULT 'Clique no botão abaixo para verificar.',
                ADD COLUMN IF NOT EXISTS two_step_enabled BOOLEAN DEFAULT FALSE;
            `);

            // FIX: new table to persist "step 1 clicked" state across restarts.
            // The old code used an in-memory `Set` (pendingVerifications) inside
            // core.js. Any process restart (crash, redeploy, host sleep on Render)
            // wiped that Set, so a user who clicked the button but hadn't yet typed
            // !verify would get stuck being told "click the button first" forever,
            // even though they already had.
            await client.query(`
                CREATE TABLE IF NOT EXISTS pending_verifications (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (guild_id, user_id)
                );
            `);

            // Session table used by connect-pg-simple, moved here so all schema
            // setup happens in one place, before the bot/dashboard start using it.
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
            `).catch(() => {}); // ok if constraint already exists

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

// Wrapper so callers can do db.query(...) as before.
async function query(text, params) {
    return pool.query(text, params);
}

module.exports = { pool, query };