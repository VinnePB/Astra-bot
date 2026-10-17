// --- ARTIST PORTAL (website) ---
// Artists registered by an admin (or holding a configured artist role) can open
// their own commission panel on the website: edit it and see a live preview of
// how clients will see it in Discord. They can never see or touch anything
// else: not another artist's panel, not the server's settings.
//
// Rules this file enforces:
//   * the artist is always the logged-in person (taken from the session, never
//     from the form), and must still be in the server AND still be an artist
//   * every field is length-limited and cleaned before it reaches the database
//   * links must be real http(s) URLs

const db = require('./database');
const tickets = require('./commands/tickets');

const LIMITS = { text: 1000, banner: 500, link: 300, label: 30, price: 30 };
const CATEGORIES = tickets.PRICING_CATEGORIES;
const isGuildId = (s) => /^\d{15,25}$/.test(String(s || ''));

// Text: strip control characters (keep line breaks), normalise newlines, trim, cap.
function cleanText(value, max) {
    return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, max);
}

// '' means "clear it". Returns null when the value is not a usable http(s) URL.
function cleanUrl(value, max) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    if (v.length > max || /[\s\u0000-\u001F]/.test(v)) return null;
    try {
        const u = new URL(v);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? v : null;
    } catch { return null; }
}

// Returns { ok: true, values } or { ok: false, error } (error is a locale key suffix).
function parseForm(body = {}) {
    const values = {
        tos_text: cleanText(body.tos_text, LIMITS.text),
        wontdo_text: cleanText(body.wontdo_text, LIMITS.text),
        askme_text: cleanText(body.askme_text, LIMITS.text),
        link_other_label: cleanText(String(body.link_other_label ?? '').replace(/\n/g, ' '), LIMITS.label),
        prices: [],
    };
    for (const f of ['banner_url', 'link_portfolio', 'link_twitter', 'link_instagram', 'link_other']) {
        const max = f === 'banner_url' ? LIMITS.banner : LIMITS.link;
        const url = cleanUrl(body[f], max);
        if (url === null) return { ok: false, error: 'bad_url' };
        values[f] = url;
    }
    CATEGORIES.forEach((category, i) => {
        values.prices.push({ category, price: cleanText(String(body[`price_${i}`] ?? '').replace(/\n/g, ' '), LIMITS.price), order: i });
    });
    return { ok: true, values };
}

// The signed-in person's membership + artist status in one guild, or null.
async function artistContext(client, guildId, userId) {
    if (!isGuildId(guildId) || !isGuildId(userId)) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    if (!(await tickets.isArtist(member))) return null;
    return { guild, member };
}

// Servers (from the ones Astra is in) where this person is an artist.
async function artistGuilds(client, userId, candidateGuilds) {
    const out = [];
    for (const g of candidateGuilds) {
        const ctx = await artistContext(client, g.id, userId);
        if (ctx) out.push({ id: g.id, name: g.name, icon: g.icon });
    }
    return out;
}

async function loadPanel(guildId, userId) {
    const { rows } = await db.query('SELECT * FROM artists WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    const pricingRows = (await db.query('SELECT category, price FROM artist_pricing WHERE guild_id = $1 AND user_id = $2', [guildId, userId])).rows;
    const map = new Map(pricingRows.map((r) => [r.category, r.price]));
    return { profile: rows[0] || {}, pricing: CATEGORIES.map((category) => ({ category, price: map.get(category) || '' })) };
}

async function savePanel(guildId, userId, v) {
    const conn = await db.pool.connect();
    try {
        await conn.query('BEGIN');
        await conn.query('INSERT INTO artists (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING', [guildId, userId]);
        await conn.query(
            `UPDATE artists SET tos_text = NULLIF($1, ''), wontdo_text = NULLIF($2, ''), askme_text = NULLIF($3, ''),
                banner_url = NULLIF($4, ''), link_portfolio = NULLIF($5, ''), link_twitter = NULLIF($6, ''),
                link_instagram = NULLIF($7, ''), link_other = NULLIF($8, ''), link_other_label = NULLIF($9, '')
             WHERE guild_id = $10 AND user_id = $11`,
            [v.tos_text, v.wontdo_text, v.askme_text, v.banner_url, v.link_portfolio, v.link_twitter, v.link_instagram,
             v.link_other, v.link_other ? (v.link_other_label || 'More') : '', guildId, userId]
        );
        for (const p of v.prices) {
            if (!p.price) {
                await conn.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2 AND category = $3', [guildId, userId, p.category]);
            } else {
                await conn.query(
                    `INSERT INTO artist_pricing (guild_id, user_id, category, price, sort_order) VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (guild_id, user_id, category) DO UPDATE SET price = EXCLUDED.price, sort_order = EXCLUDED.sort_order`,
                    [guildId, userId, p.category, p.price, p.order]
                );
            }
        }
        await conn.query('COMMIT');
    } catch (e) {
        await conn.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        conn.release();
    }
}

module.exports = { LIMITS, CATEGORIES, DEFAULTS: tickets.DEFAULTS, isGuildId, parseForm, artistContext, artistGuilds, loadPanel, savePanel, _test: { cleanText, cleanUrl } };