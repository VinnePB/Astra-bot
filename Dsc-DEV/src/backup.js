// --- BACKUPS ---
// A compressed JSON copy of Astra's data, sent to the bot owner as a private DM
// file. Why: Render's free databases have no backups at all.
//
//   Automatic: once a day (checked every 6 hours, remembered across restarts).
//   Manual:    /owner backup
//   Restore:   node src/restore-backup.js <file.json.gz>    (see that file)
//
// The file holds personal data (Discord user IDs). Keep it private, and delete
// backups older than 30 days: the Privacy Policy promises deleted data leaves
// backups within 30 days.
//
// Login sessions are not backed up on purpose (people just log in again).

const zlib = require('zlib');
const { promisify } = require('util');
const { AttachmentBuilder } = require('discord.js');
const db = require('./database');
const { getOwnerIds } = require('./botowner');
const alerts = require('./alerts');

const gzip = promisify(zlib.gzip);
const MAX_BYTES = 9 * 1024 * 1024;         // stay under Discord's upload limit
const EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_MS = 6 * 60 * 60 * 1000;

// Parents first, so a restore can insert in this order.
const BACKUP_TABLES = [
    'guild_settings', 'guild_admin_roles', 'guild_artist_roles', 'guild_level_roles', 'shop_items',
    'artists', 'artist_pricing', 'user_levels', 'user_economy', 'pending_verifications',
    'tickets', 'mod_cases', 'blocked_guilds',
];
const SEQUENCES = [{ table: 'shop_items', column: 'id' }, { table: 'mod_cases', column: 'id' }];

async function createBackup() {
    const data = { format: 'astra-backup-1', created_at: new Date().toISOString(), tables: {} };
    let rows = 0;
    for (const table of BACKUP_TABLES) {
        const res = await db.query(`SELECT * FROM ${table}`);
        data.tables[table] = res.rows;
        rows += res.rows.length;
    }
    const buffer = await gzip(Buffer.from(JSON.stringify(data)));
    const stamp = data.created_at.replace(/[:T]/g, '-').slice(0, 16);
    return { buffer, rows, filename: `astra-backup-${stamp}.json.gz` };
}

async function sendBackup(client, { reason = 'scheduled' } = {}) {
    const { buffer, rows, filename } = await createBackup();
    if (buffer.length > MAX_BYTES) {
        await alerts.notify('Backup too large to send', `The backup is ${(buffer.length / 1048576).toFixed(1)} MB, over the upload limit. Use pg_dump or upgrade the Render database for real backups.`, { level: 'warn', key: 'backup-large', cooldownMs: EVERY_MS });
        return { ok: false, reason: 'too-large' };
    }
    const [ownerId] = await getOwnerIds(client);
    if (!ownerId) return { ok: false, reason: 'no-owner' };
    const user = await client.users.fetch(ownerId);
    await user.send({
        content: `🗄️ Astra backup (${reason}) · ${rows} rows · ${(buffer.length / 1024).toFixed(0)} KB\nKeep it private and delete backups older than 30 days.`,
        files: [new AttachmentBuilder(buffer, { name: filename })],
    });
    await db.query(
        `INSERT INTO bot_meta (key, value, updated_at) VALUES ('last_backup_at', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [String(Date.now())]
    );
    return { ok: true, rows, bytes: buffer.length };
}

async function backupDue() {
    const { rows } = await db.query(`SELECT value FROM bot_meta WHERE key = 'last_backup_at'`);
    const last = rows[0] ? Number(rows[0].value) : 0;
    return Date.now() - last >= EVERY_MS;
}

async function runIfDue(client) {
    try {
        if (!client.isReady() || !(await backupDue())) return;
        const out = await sendBackup(client, { reason: 'daily' });
        if (!out.ok && out.reason === 'no-owner') console.error('⚠️ Backup skipped: bot owner unknown (set BOT_OWNER_ID).');
    } catch (err) {
        console.error('❌ Backup failed:', err.message);
        alerts.notify('Backup failed', err.message, { key: 'backup-failed', cooldownMs: EVERY_MS });
    }
}

function start(client) {
    setTimeout(() => runIfDue(client), 3 * 60 * 1000).unref();
    setInterval(() => runIfDue(client), CHECK_MS).unref();
}

module.exports = { createBackup, sendBackup, start, BACKUP_TABLES, SEQUENCES, _test: { backupDue } };