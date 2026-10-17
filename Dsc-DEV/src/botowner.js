// Who is the bot's owner? Used by owner-only commands, alerts and backups.
// BOT_OWNER_ID (comma list of Discord user IDs) wins; otherwise the Discord
// application's owner is used.

let ownerCache = null;

async function getOwnerIds(client) {
    const fromEnv = (process.env.BOT_OWNER_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fromEnv.length) return fromEnv;
    if (ownerCache && Date.now() - ownerCache.at < 10 * 60 * 1000) return ownerCache.ids;
    try {
        const app = await client.application.fetch();
        const o = app.owner;
        const ids = o ? [o.members ? o.ownerId : o.id].filter(Boolean) : [];
        ownerCache = { at: Date.now(), ids };
        return ids;
    } catch (err) {
        console.error('❌ Could not look up the bot owner:', err.message);
        return [];
    }
}

module.exports = { getOwnerIds };