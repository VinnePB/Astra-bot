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

            // NEW: panel banner image + up to 4 social/portfolio link
            // buttons (Portfolio, Twitter/X, Instagram, and one free-label
            // "Other" slot) — see commands/tickets.js buildArtistLinkRow().
            await client.query(`
                ALTER TABLE artists
                ADD COLUMN IF NOT EXISTS banner_url TEXT,
                ADD COLUMN IF NOT EXISTS link_portfolio TEXT,
                ADD COLUMN IF NOT EXISTS link_twitter TEXT,
                ADD COLUMN IF NOT EXISTS link_instagram TEXT,
                ADD COLUMN IF NOT EXISTS link_other TEXT,
                ADD COLUMN IF NOT EXISTS link_other_label VARCHAR(30);
            `);

            // NEW: per-server language, used by i18n.js for member-facing
            // bot messages. Defaults to English; /config language switches
            // a server to Portuguese (Brazil).
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';
            `);

            // NEW: site_language — the language the DASHBOARD/ONBOARDING PAGES
            // render in, kept separate from `language` above (what Astra
            // actually SAYS to members on Discord). These used to be the same
            // column, which meant switching the site's display language also
            // silently changed what Astra said in verification/ticket/etc.
            // messages, and vice versa — two different things that happened
            // to share one setting. Backfilled once from the existing
            // `language` value so no one's current site display flips on
            // them; new guild rows default to English like everything else.
            await client.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS site_language VARCHAR(5);`);
            await client.query(`UPDATE guild_settings SET site_language = language WHERE site_language IS NULL;`);
            await client.query(`ALTER TABLE guild_settings ALTER COLUMN site_language SET DEFAULT 'en';`);

            // NEW: optional separate channel for Astra's admin/config-change
            // notices (logAction). When NULL, notices keep going to
            // log_channel_id exactly like before — so nothing changes for
            // anyone until they pick a channel.
            await client.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS admin_log_channel_id VARCHAR(30);`);

            // NEW: experimental local "smart replies" (commands/ai.js).
            // Defaults to OFF for every server, new and existing.
            await client.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT FALSE;`);

            // (Unused: the Gemini playground was dropped. Column kept; it's harmless.)
            await client.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ai_playground_channel_id VARCHAR(30);`);

            // NEW: changelog/update posts in a channel (commands/updates.js).
            // Off by default; updates_last_version is the last changelog entry
            // that server was shown, so nothing is ever posted twice.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS updates_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS updates_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS updates_role_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS updates_last_version VARCHAR(20);
            `);

            // NEW: remembers that Astra already introduced herself in this server
            // (guildCreate in index.js), so re-adding her never repeats it.
            await client.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS astra_welcomed BOOLEAN DEFAULT FALSE;`);

            // NEW: category for artists' private setup channels, and a
            // toggle for join/leave logging (shared log_channel_id).
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS artist_setup_category_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS joinleave_log_enabled BOOLEAN DEFAULT TRUE;
            `);

            // NEW: public-facing welcome/leave messages — distinct from the
            // existing admin-only joinleave_log_enabled log and the
            // temporary handleNewMember() nudge. These are member-visible
            // embeds posted to a channel the admin picks, with an
            // admin-authored message template supporting {user}/{username}/
            // {server}/{membercount} placeholders (see index.js
            // buildMemberMessage()).
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS welcome_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS welcome_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS welcome_message TEXT DEFAULT 'Welcome {user} to **{server}**! You''re member #{membercount}.',
                ADD COLUMN IF NOT EXISTS welcome_card_enabled BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS leave_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS leave_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS leave_message TEXT DEFAULT '**{username}** has left the server. We''re now at {membercount} members.';
            `);

            // NEW: leveling / XP system — see commands/leveling.js.
            // xp_min/xp_max is the random XP range awarded per eligible
            // message; xp_cooldown_seconds throttles how often a single
            // member can earn XP (prevents spam-farming levels).
            // levelup_channel_id = NULL means "announce in the channel the
            // message was sent in" rather than a fixed channel.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS leveling_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS levelup_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS levelup_message TEXT DEFAULT '🎉 {user} just reached **Level {level}**!',
                ADD COLUMN IF NOT EXISTS xp_cooldown_seconds INTEGER DEFAULT 60,
                ADD COLUMN IF NOT EXISTS xp_min INTEGER DEFAULT 15,
                ADD COLUMN IF NOT EXISTS xp_max INTEGER DEFAULT 25;
            `);

            // Per-member running XP total + cached level (level is derived
            // from xp via commands/leveling.js's calculateLevel(), recomputed
            // and stored here on every XP gain so leaderboard/rank queries
            // don't need to recompute it for every row).
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_levels (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    xp BIGINT NOT NULL DEFAULT 0,
                    level INTEGER NOT NULL DEFAULT 0,
                    last_xp_at TIMESTAMP,
                    PRIMARY KEY (guild_id, user_id)
                );
            `);

            // Milestone role rewards: reaching `level` grants `role_id`.
            // Cumulative — a member keeps every milestone role they've
            // already earned, not just the latest one.
            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_level_roles (
                    guild_id VARCHAR(30) NOT NULL,
                    level INTEGER NOT NULL,
                    role_id VARCHAR(30) NOT NULL,
                    PRIMARY KEY (guild_id, level)
                );
            `);

            // NEW: lightweight "personality" reply — see commands/fun.js.
            // No AI/LLM involved, just a canned-line picker that fires when
            // Astra is @mentioned or her name is said in chat. Defaults ON
            // since it's zero-config and harmless; admins can turn it off.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS mention_replies_enabled BOOLEAN DEFAULT TRUE;
            `);

            // NEW: economy / currency system — see commands/economy.js.
            // currency_name/currency_symbol are purely cosmetic (shown in
            // /balance, /daily, /pay, /richest). daily_min/daily_max is the
            // random base payout from /daily; daily_streak_bonus is added
            // per consecutive day claimed (capped in code, not here) to
            // reward not missing a day. No shop/gambling yet — intentionally
            // scoped down, same as the rest of the "feel alive" features.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS economy_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS currency_name VARCHAR(30) DEFAULT 'Coins',
                ADD COLUMN IF NOT EXISTS currency_symbol VARCHAR(10) DEFAULT '🪙',
                ADD COLUMN IF NOT EXISTS daily_min INTEGER DEFAULT 50,
                ADD COLUMN IF NOT EXISTS daily_max INTEGER DEFAULT 150,
                ADD COLUMN IF NOT EXISTS daily_streak_bonus INTEGER DEFAULT 10;
            `);

            // Per-member balance + daily-claim streak tracking.
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_economy (
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    balance BIGINT NOT NULL DEFAULT 0,
                    daily_streak INTEGER NOT NULL DEFAULT 0,
                    last_daily_at TIMESTAMP,
                    PRIMARY KEY (guild_id, user_id)
                );
            `);

            // Economy part 2 (commands/shop.js): random events (off by default)
            // and the shop. shop_items holds the cosmetic ROLES admins sell; the
            // built-in fun items need no rows.
            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS events_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS events_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS events_interval_min INTEGER DEFAULT 45;
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS shop_items (
                    id SERIAL PRIMARY KEY,
                    guild_id VARCHAR(30) NOT NULL,
                    name VARCHAR(40) NOT NULL,
                    description VARCHAR(120),
                    price INTEGER NOT NULL,
                    role_id VARCHAR(30) NOT NULL,
                    UNIQUE (guild_id, name)
                );
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
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS mod_log_channel_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS mod_warn_timeout_at INTEGER DEFAULT 3,
                ADD COLUMN IF NOT EXISTS mod_warn_timeout_min INTEGER DEFAULT 60,
                ADD COLUMN IF NOT EXISTS mod_warn_kick_at INTEGER,
                ADD COLUMN IF NOT EXISTS mod_warn_ban_at INTEGER;
            `);

            await client.query(`
                ALTER TABLE guild_settings
                ADD COLUMN IF NOT EXISTS divider_access_role_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS divider_levels_role_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS divider_special_role_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS divider_staff_role_id VARCHAR(30),
                ADD COLUMN IF NOT EXISTS divider_style VARCHAR(10) DEFAULT 'line',
                ADD COLUMN IF NOT EXISTS divider_pad INTEGER DEFAULT 14,
                ADD COLUMN IF NOT EXISTS divider_everyone TEXT;
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS guild_divider_roles (
                    guild_id VARCHAR(30) NOT NULL,
                    kind VARCHAR(20) NOT NULL,
                    role_id VARCHAR(30) NOT NULL,
                    PRIMARY KEY (guild_id, kind, role_id)
                );
            `);

            await client.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS mod_cases (
                    id SERIAL PRIMARY KEY,
                    guild_id VARCHAR(30) NOT NULL,
                    user_id VARCHAR(30) NOT NULL,
                    moderator_id VARCHAR(30) NOT NULL,
                    action VARCHAR(20) NOT NULL,
                    reason TEXT,
                    duration_seconds INTEGER,
                    cleared BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS mod_cases_guild_user ON mod_cases (guild_id, user_id);`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS blocked_guilds (
                    guild_id VARCHAR(30) PRIMARY KEY,
                    reason TEXT,
                    blocked_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS bot_meta (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
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