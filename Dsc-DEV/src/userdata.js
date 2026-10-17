// --- PERSON-LEVEL DATA ---
// Everything Astra stores about one Discord user, across all servers: used for
// "show me my data" (/mydata view) and "delete my data" (/mydata delete, or the
// owner's /owner userdelete).
//
// Moderation cases are special: they are a server's safety record, so a person
// can SEE them but self-service deletion does not remove them (otherwise anyone
// could wipe their own warnings). The bot owner can remove them on request.
//
// Table names are fixed constants, never user input.

const db = require('./database');

const USER_TABLES = [
    { table: 'user_levels', moderation: false },
    { table: 'user_economy', moderation: false },
    { table: 'pending_verifications', moderation: false },
    { table: 'tickets', moderation: false },
    { table: 'artists', moderation: false },
    { table: 'artist_pricing', moderation: false },
    { table: 'mod_cases', moderation: true },
];

const isUserId = (s) => /^\d{15,25}$/.test(String(s || ''));

async function exportUser(userId) {
    const out = {};
    for (const { table } of USER_TABLES) {
        const { rows } = await db.query(`SELECT * FROM ${table} WHERE user_id = $1`, [userId]);
        out[table] = rows;
    }
    return out;
}

function countRows(data) {
    return Object.values(data).reduce((n, rows) => n + rows.length, 0);
}

async function deleteUser(userId, { moderation = false } = {}) {
    const counts = {};
    const conn = await db.pool.connect();
    try {
        await conn.query('BEGIN');
        for (const { table, moderation: isMod } of USER_TABLES) {
            if (isMod && !moderation) continue;
            const res = await conn.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
            counts[table] = res.rowCount;
        }
        await conn.query('COMMIT');
    } catch (err) {
        await conn.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
    return counts;
}

module.exports = { USER_TABLES, isUserId, exportUser, countRows, deleteUser };