// Restore a backup made by Astra.
//
//   node src/restore-backup.js astra-backup-2026-10-17-18-00.json.gz
//
// It refuses to run if any table already has rows, so it can never mix a
// backup into live data by accident. To restore on top of existing data:
// add --force (rows that already exist are skipped, nothing is overwritten).
// Needs DATABASE_URL (the same variable the bot uses).

const fs = require('fs');
const zlib = require('zlib');
require('dotenv').config();

const { BACKUP_TABLES, SEQUENCES } = require('./backup');

// Builds one parameterised INSERT. Column and table names come from the file,
// so they are checked against a strict pattern and quoted.
function buildInsert(table, row) {
    const cols = Object.keys(row);
    for (const name of [table, ...cols]) {
        if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe name in backup: ${name}`);
    }
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`;
    return { sql, values: cols.map((c) => row[c]) };
}

async function main() {
    const file = process.argv[2];
    const force = process.argv.includes('--force');
    if (!file) { console.error('Usage: node src/restore-backup.js <backup.json.gz> [--force]'); process.exit(1); }

    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    if (data.format !== 'astra-backup-1' || !data.tables) throw new Error('This is not an Astra backup file.');

    const db = require('./database');
    await new Promise((r) => setTimeout(r, 1500)); // let the schema setup finish first
    const conn = await db.pool.connect();
    try {
        if (!force) {
            for (const table of BACKUP_TABLES) {
                const { rows } = await conn.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
                if (rows[0].n > 0) throw new Error(`Table ${table} already has data. Use --force to restore anyway (existing rows are kept).`);
            }
        }
        await conn.query('BEGIN');
        let total = 0;
        for (const table of BACKUP_TABLES) {
            for (const row of data.tables[table] || []) {
                const { sql, values } = buildInsert(table, row);
                await conn.query(sql, values);
                total++;
            }
        }
        for (const { table, column } of SEQUENCES) {
            await conn.query(`SELECT setval(pg_get_serial_sequence('${table}', '${column}'), COALESCE((SELECT MAX(${column}) FROM ${table}), 1))`);
        }
        await conn.query('COMMIT');
        console.log(`✅ Restored ${total} rows from ${file} (backup made ${data.created_at}).`);
    } catch (err) {
        await conn.query('ROLLBACK').catch(() => {});
        console.error('❌ Restore failed, nothing was changed:', err.message);
        process.exitCode = 1;
    } finally {
        conn.release();
        await db.pool.end();
    }
}

if (require.main === module) main();
module.exports = { buildInsert };