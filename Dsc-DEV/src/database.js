const { Pool } = require('pg');
require('dotenv').config();

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

            // NEW: dual-role verification gate.
            // rules_channel_id / rules_role_id — the #rules "I Agree" button and
            // the role it grants (Role A).
            // verify_role_id — the role the existing verify-channel button now
            // grants (Role B), instead of granting member_role_id directly.
            // member_role_id (already existed) is only granted once a member
            // holds BOTH rules_role_id and verify_role_id.
            // If rules_channel_id / rules_role_id / verify_role_id are left
            // unset, the verify button falls back to legacy single-click
            // behaviour (grants member_role_id directly) for servers that
            // haven't configured the dual-role flow yet.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS rules_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS rules_role_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS verify_role_id VARCHAR(30);
            `);

            // NEW: auto-kick sweep settings — see commands/config.js runAutoKickSweep.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS auto_kick_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS auto_kick_days INTEGER DEFAULT 2;
            `);

            // NEW: join-time anti-scam check — see commands/config.js checkScamSignals.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS antiscam_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS antiscam_action VARCHAR(10) DEFAULT 'log',
                ADD COLUMN IF NOT EXISTS antiscam_min_age_hours INTEGER DEFAULT 24,
                ADD COLUMN IF NOT EXISTS antiscam_require_no_avatar BOOLEAN DEFAULT TRUE;
            `);

            // NEW: commission ticket system.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS ticket_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS ticket_category_id VARCHAR(30);
            `);

            // Roles that let someone self-manage their own artist panels
            // (mirrors guild_admin_roles — same add/remove/list pattern).
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_artist_roles (
                    guild_id VARCHAR(30) NOT NULL,
                    role_id VARCHAR(30) NOT NULL,
                    added_by VARCHAR(30),
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (guild_id, role_id)
                );
            `);

            // Per-artist ToS / won't-do overrides. NULL = use the built-in
            // default template (see commands/tickets.js).
            await client.query(`
                CREATE TABLE IF NOT EXISTS artists (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    tos_text TEXT,
                    wontdo_text TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (guild_id, user_id)
                );
            `);

            // NEW: "Ask Me About" text (the positive counterpart to
            // won't-do), and the private per-artist setup channel this
            // artist has been given (if any).
            await client.query(`
                ALTER TABLE artists
                ADD COLUMN IF NOT EXISTS askme_text TEXT,
                ADD COLUMN IF NOT EXISTS setup_channel_id VARCHAR(30);
            `);

            // NEW: per-server language, used by i18n.js for member-facing
            // bot messages. Defaults to English; /config language switches
            // a server to Portuguese (Brazil).
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';
            `);

            // NEW: category for artists' private setup channels, and a
            // toggle for join/leave logging (shared log_channel_id).
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS artist_setup_category_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS joinleave_log_enabled BOOLEAN DEFAULT TRUE;
            `);

            // Per-artist pricing sheet: one row per category (Headshot, Bust,
            // Full Body, etc.) with a free-text price value.
            await client.query(`
                CREATE TABLE IF NOT EXISTS artist_pricing (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    price VARCHAR(30) NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    PRIMARY KEY (guild_id, user_id, category)
                );
            `);

            // Tracks open ticket channels so /close can verify who's allowed
            // to close it, and so the ticket-artist select menu knows which
            // channel belongs to whom. Also used to block a user from
            // opening a second ticket while one is already open.
            await client.query(`
                CREATE TABLE IF NOT EXISTS tickets (
                    channel_id VARCHAR(30) PRIMARY KEY,
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    artist_id VARCHAR(30) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS pending_verifications (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (guild_id, user_id)
                );
            `);

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