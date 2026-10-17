// --- DATA RETENTION ---
// When Astra is removed from a server, that server's data is kept for 30 days
// (so an accidental kick doesn't wipe a whole setup) and then deleted for good.
// Adding her back inside that window cancels the deletion.
//
// The table names below are fixed constants (never user input).

const db = require('./database');

const GRACE_DAYS = 30;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// Every table that holds per-server data. guild_settings goes last.
const GUILD_TABLES = [
    'mod_cases', 'tickets', 'pending_verifications', 'user_levels', 'user_economy',
    'artist_pricing', 'artists', 'shop_items', 'guild_level_roles', 'guild_artist_roles',
    'guild_admin_roles', 'guild_settings',
];

async function markLeft(guildId) {
    await db.query(
        `INSERT INTO guild_settings (guild_id, left_at) VALUES ($1, NOW())
         ON CONFLICT (guild_id) DO UPDATE SET left_at = NOW()`,
        [guildId]
    );
}

async function markJoined(guildId) {
    await db.query('UPDATE guild_settings SET left_at = NULL WHERE guild_id = $1 AND left_at IS NOT NULL', [guildId]);
}

async function purgeGuild(guildId) {
    const conn = await db.pool.connect();
    try {
        await conn.query('BEGIN');
        for (const table of GUILD_TABLES) {
            await conn.query(`DELETE FROM ${table} WHERE guild_id = $1`, [guildId]);
        }
        await conn.query('COMMIT');
    } catch (err) {
        await conn.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

// Deletes servers Astra left more than GRACE_DAYS ago. Never touches a server
// she is currently in, even if the left_at marker is somehow stale.
async function purgeExpired(client) {
    if (!client.isReady()) return 0;
    const { rows } = await db.query(
        `SELECT guild_id FROM guild_settings WHERE left_at IS NOT NULL AND left_at < NOW() - ($1 || ' days')::interval`,
        [String(GRACE_DAYS)]
    );
    let purged = 0;
    for (const { guild_id: id } of rows) {
        if (client.guilds.cache.has(id)) { await markJoined(id); continue; }
        try { await purgeGuild(id); purged++; }
        catch (err) { console.error(`❌ Could not delete data for left server ${id}:`, err.message); }
    }
    if (purged) console.log(`🧹 Deleted data for ${purged} server(s) Astra left more than ${GRACE_DAYS} days ago.`);
    return purged;
}

function start(client) {
    purgeExpired(client).catch((e) => console.error('❌ Retention pass failed:', e.message));
    setInterval(() => purgeExpired(client).catch((e) => console.error('❌ Retention pass failed:', e.message)), CHECK_EVERY_MS).unref();
}

module.exports = { markLeft, markJoined, purgeGuild, purgeExpired, start, GUILD_TABLES, GRACE_DAYS };