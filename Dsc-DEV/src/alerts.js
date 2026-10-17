// --- ALERTS ---
// Tells the bot owner when something goes wrong, so problems aren't discovered
// by members first.
//
//   Where it goes:  a Discord webhook if ALERT_WEBHOOK_URL is set (recommended:
//                   make a private channel, Edit Channel → Integrations → Webhooks),
//                   otherwise a DM to the bot owner.
//   What triggers:  crashes and unhandled errors, losing the Discord connection
//                   (and getting it back), database errors, restarts, owner actions.
//   Safety:         secrets are scrubbed from every message, the same problem is
//                   only reported once per 10 minutes, and at most 12 alerts go
//                   out per hour, so a bug can never flood the owner.
//
// This can't report a total outage (a dead process can't talk). For that, point a
// free uptime monitor at https://<your-site>/health.

const axios = require('axios');
const { getOwnerIds } = require('./botowner');

const MAX_PER_HOUR = 12;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const COLORS = { error: 0xed4245, warn: 0xf59e0b, info: 0x22e5ff };

let client = null;
const sent = [];              // timestamps of recent alerts
const lastByKey = new Map();  // key -> last time

function redact(text) {
    let s = String(text ?? '');
    const secrets = ['DISCORD_TOKEN', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET', 'DATABASE_URL', 'ALERT_WEBHOOK_URL']
        .map((k) => process.env[k]).filter((v) => v && v.length >= 8);
    for (const v of secrets) s = s.split(v).join('[hidden]');
    s = s.replace(/[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g, '[hidden]');
    s = s.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[hidden]');
    s = s.replace(/https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s'"]+/gi, '[hidden]');
    return s;
}

function allow(key, cooldownMs, now = Date.now()) {
    while (sent.length && now - sent[0] > 60 * 60 * 1000) sent.shift();
    if (sent.length >= MAX_PER_HOUR) return false;
    const last = lastByKey.get(key);
    if (last && now - last < cooldownMs) return false;
    lastByKey.set(key, now);
    sent.push(now);
    return true;
}

async function notify(title, details, { level = 'error', key = title, cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
    try {
        if (!allow(key, cooldownMs)) return false;
        const embed = {
            title: redact(title).slice(0, 250),
            description: redact(details).slice(0, 3500) || undefined,
            color: COLORS[level] || COLORS.error,
            timestamp: new Date().toISOString(),
            footer: { text: 'Astra alerts' },
        };
        if (process.env.ALERT_WEBHOOK_URL) {
            await axios.post(process.env.ALERT_WEBHOOK_URL, { username: 'Astra alerts', embeds: [embed] }, { timeout: 8000 });
            return true;
        }
        if (client && client.isReady()) {
            const [ownerId] = await getOwnerIds(client);
            if (!ownerId) return false;
            const user = await client.users.fetch(ownerId);
            await user.send({ embeds: [embed] });
            return true;
        }
        return false;
    } catch (err) {
        console.error('⚠️ Could not send an alert:', redact(err.message));
        return false;
    }
}

const describe = (e) => (e && e.stack ? e.stack : String(e));

function install(discordClient, pool) {
    client = discordClient;
    process.on('unhandledRejection', (reason) => notify('Unhandled error', describe(reason), { key: 'rej:' + describe(reason).split('\n')[0] }));
    process.on('uncaughtException', (err) => notify('Uncaught exception', describe(err), { key: 'exc:' + describe(err).split('\n')[0] }));
    client.on('error', (err) => notify('Discord client error', describe(err), { key: 'client-error' }));
    client.on('shardDisconnect', (event) => notify('Lost connection to Discord', `Close code ${event?.code ?? 'unknown'}. Astra will try to reconnect on her own.`, { level: 'warn', key: 'disconnect' }));
    client.on('shardResume', () => notify('Reconnected to Discord', 'Astra is back online.', { level: 'info', key: 'resume' }));
    if (pool && pool.on) pool.on('error', (err) => notify('Database error', describe(err), { key: 'db-error' }));
}

module.exports = { notify, install, redact, _test: { allow, lastByKey, sent } };