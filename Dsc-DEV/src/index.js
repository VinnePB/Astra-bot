const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const db = require('./database');
const { t, normalizeLanguage } = require('./i18n');
const configCommand = require('./commands/config');
const helpCommand = require('./commands/help');
const ticketsCommand = require('./commands/tickets');
const levelingCommand = require('./commands/leveling');
const funCommand = require('./commands/fun');
const aiCommand = require('./commands/ai');
const economyCommand = require('./commands/economy');
const shopCommand = require('./commands/shop');
const banterCommand = require('./commands/banter');
const updatesCommand = require('./commands/updates');
const moderationCommand = require('./commands/moderation');
const legalContent = require('./legal-content');
const retention = require('./retention');
const alerts = require('./alerts');
const backup = require('./backup');
const ownerCommand = require('./commands/owner');
const inviteCommand = require('./invite');
const { getOwnerIds } = require('./botowner');
const rolekit = require('./rolekit');
const artistPortal = require('./artistportal');
const mydataCommand = require('./commands/mydata');

process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('❌ Uncaught Exception:', error));

const app = express();
const PORT = process.env.PORT || 3000;

// REQUIRED behind Render's proxy — without this, Express can't correctly
// detect that the connection is HTTPS, which would silently break
// `cookie.secure: true` below (the cookie would never actually get set).
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
// Logo, favicon and other public files (src/public).
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
// Express 5 leaves req.body undefined when nothing was parsed; routes destructure
// it, so give them an empty object instead of a crash.
app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

if (!process.env.SESSION_SECRET) {
    console.warn('⚠️  SESSION_SECRET is not set — using an insecure fallback value that is visible in this codebase. ' +
        'Set a real, random SESSION_SECRET in your environment variables (Render → Environment) before relying on this in production. ' +
        'Without it, anyone with a copy of this code could forge session cookies.');
}

// Without SESSION_SECRET we still never use a value that is public in the code:
// a random one is made at boot (everyone just has to log in again after a restart).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');

// ---- Security headers ----
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com"
    });
    next();
});

// ---- Simple in-memory rate limiter (per IP) ----
function rateLimit({ windowMs, max }) {
    const hits = new Map();
    setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, windowMs).unref();
    return (req, res, next) => {
        const now = Date.now();
        let h = hits.get(req.ip);
        if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(req.ip, h); }
        if (++h.n > max) {
            res.set('Retry-After', Math.ceil((h.reset - now) / 1000));
            return res.status(429).send('Too many requests. Please wait a moment and try again.');
        }
        next();
    };
}
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 90 });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 600 });
app.use(generalLimiter);

app.use(session({
    store: new pgSession({
        pool: db.pool,
        tableName: 'session'
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // refreshes the cookie's expiry on every request, so an
                    // active user never gets logged out mid-use — only
                    // 30 days of total inactivity does that.
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: true,     // Render always serves this over HTTPS; requires trust proxy above to work correctly.
        httpOnly: true,   // blocks any client-side JS (including injected/XSS) from reading the cookie.
        sameSite: 'lax'   // blocks cross-site requests from using the cookie, while still allowing the Discord OAuth redirect back to this site.
    }
}));

// What the top menu shows: 'full' for people who manage a server (or the developer),
// 'artist' for people who only have an artist panel, 'basic' for everyone else.
// Worked out on the server-select page and remembered in the session.
app.use((req, res, next) => { res.locals.navAccess = (req.session && req.session.navAccess) || 'full'; next(); });

// ---- CSRF defence: every state-changing request must come from this site ----
const SITE_HOST = (() => { try { return new URL(process.env.REDIRECT_URI).host; } catch (e) { return null; } })();
function isSameSite(req) {
    const origin = req.get('Origin') || req.get('Referer');
    if (!origin) return false;
    try {
        const host = new URL(origin).host;
        return host === req.get('Host') || (SITE_HOST && host === SITE_HOST);
    } catch (e) { return false; }
}
app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!isSameSite(req)) return res.status(403).send('Blocked: this request did not come from the Astra dashboard.');
    writeLimiter(req, res, next);
});

// Only ever redirect back to a path on this site (never to a URL from a header).
function safeBackPath(req, fallback) {
    const ref = req.get('Referer');
    if (!ref) return fallback;
    try {
        const u = new URL(ref);
        if (u.host !== req.get('Host') && u.host !== SITE_HOST) return fallback;
        return (u.pathname + u.search).startsWith('/') && !(u.pathname + u.search).startsWith('//') ? u.pathname + u.search : fallback;
    } catch (e) { return fallback; }
}

// Discord access tokens expire (~7 days). Previously nothing refreshed
// them, so after expiry every Discord API call (guilds/channels/roles)
// silently started failing — the session cookie stayed "logged in" but the
// data behind it was stale/broken, which is what looked like the site
// losing sync with the real server. This refreshes proactively before
// that happens.
async function refreshDiscordToken(req) {
    if (!req.session.refreshToken) return false;
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: req.session.refreshToken,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        req.session.token = tokenResponse.data.access_token;
        req.session.refreshToken = tokenResponse.data.refresh_token;
        req.session.tokenExpiresAt = Date.now() + tokenResponse.data.expires_in * 1000;
        return true;
    } catch (err) {
        console.error('❌ Failed to refresh Discord token:', err.response?.data || err.message);
        return false;
    }
}

const checkAuth = async (req, res, next) => {
    if (!req.session.user || !req.session.token) return res.redirect('/');

    // Refresh a minute before actual expiry, not after — avoids a request
    // failing partway through with a now-dead token.
    const expiresAt = req.session.tokenExpiresAt || 0;
    if (Date.now() > expiresAt - 60_000) {
        const refreshed = await refreshDiscordToken(req);
        if (!refreshed) {
            // Refresh token is also dead/revoked — nothing left to do but
            // have them log in again for real, cleanly, rather than limping
            // along with broken data.
            return req.session.destroy(() => res.redirect('/'));
        }
    }

    // Re-confirm every few minutes that this person still administers the
    // server they selected, so removing someone's Administrator (or kicking
    // them) takes effect quickly instead of lasting until the session expires.
    if (req.session.selectedGuildId && req.path !== '/select-server') {
        const ok = await stillAdministers(req);
        if (!ok) {
            delete req.session.selectedGuildId;
            return res.redirect('/select-server');
        }
    }

    next();
};

const GUILD_RECHECK_MS = 3 * 60 * 1000;
async function stillAdministers(req) {
    const last = req.session.guildVerifiedAt || 0;
    if (Date.now() - last < GUILD_RECHECK_MS) return true;
    try {
        if (!client.isReady()) return true; // bot still starting: don't lock people out
        const guild = client.guilds.cache.get(req.session.selectedGuildId);
        if (!guild) return false;
        const member = await guild.members.fetch(req.session.user.id).catch(() => null);
        if (!member) return false;
        const admin = member.permissions.has('Administrator') || guild.ownerId === member.id;
        if (admin) req.session.guildVerifiedAt = Date.now();
        return admin;
    } catch (e) {
        console.error('❌ Admin re-check failed:', e.message);
        return Date.now() - last < 30 * 60 * 1000; // brief grace if Discord is unreachable
    }
}

// NEW: lets settings forms auto-save on change (via fetch, marked with this
// header client-side) instead of requiring a separate "click Save to
// confirm" step, while still working as a normal full-page form submit if
// JS is off. Only used for pure settings routes — anything that also
// triggers a real Discord side effect (posting a panel message, creating a
// channel) stays a deliberate, explicit button click instead.
function respondSaved(req, res, redirectPath) {
    if (req.get('X-Requested-With') === 'fetch') {
        return res.json({ ok: true });
    }
    res.redirect(redirectPath);
}

// Dashboard forms send channel/role ids as plain text. Make sure each one is a
// real id that belongs to the selected server before it is stored.
function idsBelongToGuild(guildId, { channels = [], roles = [] }) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    const snow = /^\d{15,25}$/;
    for (const id of channels) if (id && !(snow.test(id) && guild.channels.cache.has(id))) return false;
    for (const id of roles) if (id && !(snow.test(id) && guild.roles.cache.has(id))) return false;
    return true;
}

// --- ROUTES ---

// Public numbers for the landing page and /api/stats: how many servers have
// Astra and how many people they hold. Counts only, no names or ids. Cached
// for a minute; null until the bot has connected.
let statsCache = { at: 0, value: { servers: null, members: null } };
function getPublicStats() {
    if (Date.now() - statsCache.at < 60 * 1000) return statsCache.value;
    let value = { servers: null, members: null };
    try {
        if (client.isReady()) {
            let members = 0;
            for (const g of client.guilds.cache.values()) members += g.memberCount || 0;
            value = { servers: client.guilds.cache.size, members };
        }
    } catch (e) { /* client not created yet: keep nulls */ }
    // Don't remember "not connected yet": retry on the next visit instead of showing nothing for a minute.
    if (value.servers !== null) statsCache = { at: Date.now(), value };
    return value;
}

// For uptime monitors (UptimeRobot, Better Stack...). Says only whether the bot is connected.
app.get('/health', (req, res) => {
    const ok = client.isReady();
    res.set('Cache-Control', 'no-store');
    res.status(ok ? 200 : 503).json({ ok });
});

app.get('/api/stats', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); // public numbers, fine for a tracker or badge to read
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ...getPublicStats(), updated_at: statsCache.at ? new Date(statsCache.at).toISOString() : null });
});

app.get('/', (req, res) => {
    const lang = req.session.siteLang || 'en';
    res.render('index', {
        stats: getPublicStats(),
        lang,
        t: (key, vars) => t(lang, key, vars),
        loggedIn: !!(req.session.user && req.session.token),
        user: req.session.user || null,
        pageTitle: 'Projeckt V: Astra'
    });
});

// ---- Legal pages (public) ----
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Escapes text, then turns **bold** into <strong>. Content comes from our own file, never from users.
const fmtLegal = (str) => escapeHtml(str)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-200">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="text-cyan-300">$1</code>');
function renderLegal(kind) {
    return (req, res) => {
        const lang = req.session.siteLang || 'en';
        res.render('legal', {
            doc: legalContent.getDoc(kind, lang), lang, fmt: fmtLegal,
            t: (key, vars) => t(lang, key, vars),
            contactEmail: process.env.CONTACT_EMAIL || ''
        });
    };
}
app.get('/privacy', renderLegal('privacy'));
app.get('/terms', renderLegal('terms'));

app.get('/support', (req, res) => {
    const lang = req.session.siteLang || 'en';
    res.render('support', { lang, t: (key, vars) => t(lang, key, vars) });
});

app.get('/lang/:lang', (req, res) => {
    req.session.siteLang = normalizeLanguage(req.params.lang);
    res.redirect(safeBackPath(req, '/'));
});

// Guild-context twin of /lang/:lang. The homepage/select-server toggle above
// is a session-only preference (no guild picked yet, nothing to save it to).
// Once a guild is selected, this SAME top-bar EN/PT-BR toggle instead writes
// to that guild's guild_settings.site_language — just the DASHBOARD/
// ONBOARDING PAGES' own display language. It's deliberately separate from
// guild_settings.language (what Astra actually says to members on Discord,
// changed via the Configuration page's Language dropdown or /config
// language) — those used to be the same field, which meant flipping one
// silently flipped the other too.
app.get('/lang-guild/:lang', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');
    if (!isSameSite(req)) return res.status(403).send('Blocked: this request did not come from the Astra dashboard.');

    const lang = normalizeLanguage(req.params.lang);
    try {
        await db.query(
            `INSERT INTO guild_settings (guild_id, site_language) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET site_language = $2`,
            [guildId, lang]
        );
        const guild = client.guilds.cache.get(guildId);
        if (guild) await configCommand.logAction(guild, `🌐 ${req.session.user.username} changed the dashboard's display language to ${lang === 'pt-br' ? 'Português (Brasil)' : 'English'} (this does not affect what Astra says to members).`);
    } catch (err) {
        console.error('❌ Error updating site language from nav toggle:', err);
    }
    res.redirect(safeBackPath(req, '/dashboard'));
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/login', authLimiter, (req, res) => {
    // `state` ties the Discord reply to the browser that started the login,
    // so nobody can slip their own login into someone else's session.
    const state = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = state;
    req.session.save(() => {
        res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds&state=${state}`);
    });
});

app.get('/callback', authLimiter, async (req, res) => {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') return res.status(400).send('Error.');
    const expected = req.session.oauthState;
    if (!expected || typeof state !== 'string' || state.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
        return res.status(400).send('Login expired or invalid. Please go back and try logging in again.');
    }
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
        const siteLang = req.session.siteLang;

        // Brand-new session id on login (prevents session fixation).
        req.session.regenerate((err) => {
            if (err) { console.error('❌ Session regenerate failed:', err.message); return res.status(500).send('Auth failed.'); }
            if (siteLang) req.session.siteLang = siteLang;
            req.session.token = accessToken;
            req.session.refreshToken = tokenResponse.data.refresh_token;
            req.session.tokenExpiresAt = Date.now() + tokenResponse.data.expires_in * 1000;
            req.session.user = { id: userResponse.data.id, username: userResponse.data.username, global_name: userResponse.data.global_name, avatar: userResponse.data.avatar, discriminator: userResponse.data.discriminator };
            req.session.save(() => res.redirect('/select-server'));
        });
    } catch (error) { res.status(400).send('Auth failed.'); }
});

// Permissions requested for the bot invite link: View Channels, Send
// Messages, Embed Links, Read Message History, Manage Messages, Manage
// Channels, Manage Roles, Kick Members, Ban Members, Moderate Members — everything Astra's features
// actually use. Adjust via Discord's own permission calculator if you want
// to change this later.
const BOT_INVITE_PERMISSIONS = '1099780156438';
const SITE_URL = (() => { try { return new URL(process.env.REDIRECT_URI).origin; } catch (e) { return 'https://projeckt-v.dev'; } })();
const botLinks = () => ({
    inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=${BOT_INVITE_PERMISSIONS}&scope=bot%20applications.commands`,
    siteUrl: SITE_URL,
});


// How much of Astra a server has set up, as a percentage. Each item counts
// once it is switched on AND has what it needs (a channel, a role...).
const SETUP_CHECKS = [
    (g) => !!(g.verify_channel_id && g.member_role_id),            // verification
    (g) => !!(g.log_channel_id || g.admin_log_channel_id),         // log channel
    (g) => !!g.antiscam_enabled,                                    // anti-scam
    (g) => !!(g.ticket_channel_id && g.ticket_category_id),        // tickets
    (g) => !!(g.welcome_enabled && g.welcome_channel_id),          // welcome messages
    (g) => !!g.leveling_enabled,                                    // levels
    (g) => !!g.economy_enabled,                                     // economy
    (g) => !!g.ai_enabled,                                          // smart replies
    (g) => !!(g.updates_enabled && g.updates_channel_id),          // updates channel
    (g) => !!g.mod_log_channel_id,                                  // moderation log
];
function setupProgress(row) {
    const g = row || {};
    const done = SETUP_CHECKS.filter((check) => check(g)).length;
    return { done, total: SETUP_CHECKS.length, percent: Math.round((done / SETUP_CHECKS.length) * 100) };
}

app.get('/select-server', checkAuth, async (req, res) => {
    try {
        const [userGuildsResp, botGuildsResp] = await Promise.all([
            axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.token}` } }),
            axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } })
        ]);

        const botGuildIds = new Set(botGuildsResp.data.map(g => g.id));
        const adminGuilds = userGuildsResp.data.filter(g => (BigInt(g.permissions) & 8n) === 8n);

        // NEW: split into servers Astra is actually in vs. ones she isn't —
        // this is what was missing before. The old version showed every
        // server you administer, bot or no bot, which meant picking one
        // Astra hadn't been invited to just produced a confusing empty
        // dashboard with no explanation.
        const guildsWithBot = adminGuilds.filter(g => botGuildIds.has(g.id));
        const guildsWithoutBot = adminGuilds.filter(g => !botGuildIds.has(g.id));
        // Servers Astra is in where this person has no Administrator permission: listed so
        // they can see why they can't configure them (read-only, never selectable).
        const guildsNoAccess = userGuildsResp.data.filter(g => (BigInt(g.permissions) & 8n) !== 8n && botGuildIds.has(g.id));

        // Servers where this person is an artist (registered by an admin or holding an
        // artist role): they get their own panel editor there, nothing else.
        let artistGuildList = [];
        try {
            artistGuildList = await artistPortal.artistGuilds(client, req.session.user.id, userGuildsResp.data.filter(g => botGuildIds.has(g.id)));
        } catch (e) { console.error('❌ Artist guild lookup failed:', e.message); }

        const isDev = (await getOwnerIds(client).catch(() => [])).includes(req.session.user.id);
        req.session.navAccess = (isDev || guildsWithBot.length || guildsWithoutBot.length) ? 'full' : (artistGuildList.length ? 'artist' : 'basic');
        res.locals.navAccess = req.session.navAccess;

        const siteLang = req.session.siteLang || 'en';
        const setup = {};
        try {
            const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = ANY($1)', [guildsWithBot.map(g => g.id)]);
            const byId = new Map(rows.map(r => [r.guild_id, r]));
            for (const g of guildsWithBot) setup[g.id] = setupProgress(byId.get(g.id));
        } catch (e) { console.error('❌ Setup progress failed:', e.message); }
        res.render('select_server', {
            setup,
            user: req.session.user,
            guildsWithBot,
            guildsWithoutBot,
            guildsNoAccess,
            artistGuildList,
            isBotOwner: isDev,
            noAdminServers: guildsWithBot.length === 0 && guildsWithoutBot.length === 0,
            clientId: process.env.DISCORD_CLIENT_ID,
            botInvitePermissions: BOT_INVITE_PERMISSIONS,
            currentLang: siteLang,
            t: (key, vars) => t(siteLang, key, vars),
            pageTitle: 'Projeckt V: Astra — Select Server'
        });
    } catch (err) {
        console.error('❌ Error fetching guilds:', err);
        res.status(500).send("Error fetching servers.");
    }
});

app.post('/select-server', checkAuth, async (req, res) => {
    // SECURITY FIX: this used to trust req.body.guild_id outright. A crafted
    // POST with a different guild_id would have let someone manage a server
    // they have no actual Administrator permission on — anyone who could
    // reach this endpoint (not just legitimate admins) could point it at any
    // server Astra is in. Now it re-checks against Discord's own record of
    // which servers this authenticated user actually administers, the same
    // way the GET route already filters the list they see.
    try {
        const [guildsResp, botGuildsResp] = await Promise.all([
            axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.token}` } }),
            axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } })
        ]);
        const adminGuildIds = new Set(
            guildsResp.data.filter(g => (BigInt(g.permissions) & 8n) === 8n).map(g => g.id)
        );
        const botGuildIds = new Set(botGuildsResp.data.map(g => g.id));

        if (!adminGuildIds.has(req.body.guild_id)) {
            return res.status(403).send('You do not have Administrator permission on that server.');
        }
        if (!botGuildIds.has(req.body.guild_id)) {
            return res.status(400).send('Astra isn\'t in that server yet — invite her first from the server selection page.');
        }

        req.session.selectedGuildId = req.body.guild_id;
        req.session.guildVerifiedAt = Date.now();

        // Brand-new servers (no verification set up yet) land on the
        // onboarding page instead of the full dashboard.
        const { rows } = await db.query('SELECT verify_channel_id, member_role_id FROM guild_settings WHERE guild_id = $1', [req.body.guild_id]);
        const settings = rows[0];
        const isConfigured = settings && settings.verify_channel_id && settings.member_role_id;
        res.redirect(isConfigured ? '/dashboard' : '/onboarding');
    } catch (err) {
        console.error('❌ Error validating guild selection:', err);
        res.status(500).send('Could not verify your permissions for that server.');
    }
});

app.get('/onboarding', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = rows[0] || { guild_id: guildId };
        res.render('onboarding', {
            user: req.session.user, settings,
            currentLang: settings.site_language || 'en',
            guildLangContext: true,
            t: (key, vars) => t(settings.site_language || 'en', key, vars),
            pageTitle: 'Projeckt V: Astra — Get Started'
        });
    } catch (err) { res.status(500).send("DB Error."); }
});

// UNIFIED /dashboard — Verification, Anti-Scam, Auto-Kick, Tickets, Artists,
// and Admin Roles are now tabs on this one page instead of /dashboard and
// /tickets being two separate pages. Fetches everything every tab needs up
// front since switching tabs is pure client-side show/hide, no reload.
app.get('/dashboard', checkAuth, async (req, res) => {
    const guildId = req.session.selectedGuildId;
    if (!guildId) return res.redirect('/select-server');

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
        const settings = rows[0] || { guild_id: guildId };
        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

        let channels = [], updateChannels = [], categories = [], roles = [], memberCount = null;
        try {
            const [c, r, g] = await Promise.all([
                axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
                axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers }),
                axios.get(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, { headers })
            ]);
            channels = c.data.filter(ch => ch.type === 0);
            // The updates picker also lists announcement channels (type 5) and
            // marks the ones Astra can't post in (private channels she isn't in).
            const gObj = client.guilds.cache.get(guildId);
            const meMember = gObj?.members?.me;
            updateChannels = c.data.filter(ch => ch.type === 0 || ch.type === 5).map(ch => {
                const gc = gObj?.channels.cache.get(ch.id);
                const perms = gc && meMember ? gc.permissionsFor(meMember) : null;
                return { id: ch.id, name: ch.name, announcement: ch.type === 5, blocked: !perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks']) };
            });
            categories = c.data.filter(ch => ch.type === 4);
            roles = r.data.filter(role => role.name !== '@everyone');
            memberCount = g.data.approximate_member_count ?? null;
        } catch (e) { console.error("Discord API fetch failed"); }

        const { rows: adminRoleRows } = await db.query('SELECT role_id FROM guild_admin_roles WHERE guild_id = $1', [guildId]);
        const adminRoles = adminRoleRows.map(r => roles.find(role => role.id === r.role_id)).filter(Boolean);

        const { rows: artists } = await db.query('SELECT * FROM artists WHERE guild_id = $1', [guildId]);
        const { rows: pricingRows } = await db.query('SELECT * FROM artist_pricing WHERE guild_id = $1', [guildId]);
        const pricingByArtist = {};
        for (const row of pricingRows) {
            if (!pricingByArtist[row.user_id]) pricingByArtist[row.user_id] = [];
            pricingByArtist[row.user_id].push(row);
        }
        const artistDetails = await Promise.all(artists.map(async (artist) => {
            try {
                const u = await axios.get(`https://discord.com/api/v10/users/${artist.user_id}`, { headers });
                return { ...artist, username: u.data.username, pricing: pricingByArtist[artist.user_id] || [] };
            } catch (e) {
                return { ...artist, username: `Unknown (${artist.user_id})`, pricing: pricingByArtist[artist.user_id] || [] };
            }
        }));
        const artistCount = artistDetails.length;

        // Level-up role rewards (guild_level_roles) — shown/edited in the Leveling tab.
        const { rows: levelRoleRows } = await db.query('SELECT level, role_id FROM guild_level_roles WHERE guild_id = $1 ORDER BY level ASC', [guildId]);
        const botMember = client.guilds.cache.get(guildId)?.members.me;
        const levelRoles = levelRoleRows.map(r => {
            const role = roles.find(ro => ro.id === r.role_id);
            // Astra can only hand out roles below her own highest role.
            const assignable = !role || !botMember ? true
                : botMember.permissions.has('ManageRoles') && role.position < botMember.roles.highest.position && !role.managed;
            return { level: r.level, role_id: r.role_id, name: role?.name || null, assignable };
        });

        // Shop role items (commands/shop.js) — shown/edited in the Economy tab.
        const shopRows = await shopCommand.listRoleItems(guildId);
        const shopItems = shopRows.map(i => {
            const role = roles.find(ro => ro.id === i.role_id);
            const assignable = !role || !botMember ? true
                : botMember.permissions.has('ManageRoles') && role.position < botMember.roles.highest.position && !role.managed;
            return { name: i.name, description: i.description, price: i.price, role_id: i.role_id, role_name: role?.name || null, assignable };
        });
        // Commands missing in this server? Try again now (the usual fix is
        // re-inviting her, which this picks up without a restart).
        let commandsMissing = false;
        if (commandSyncFailed.has(guildId)) commandsMissing = !(await syncGuildCommands(guildId, { quiet: true }));
        const updErr = ['offline', 'channel', 'perms', 'nomanage', 'off', 'failed'].includes(req.query.upderr) ? req.query.upderr : null;
        const updatesVersion = updatesCommand.currentEntry()?.version || null;
        const shopErr = ['name', 'price', 'builtin', 'limit', 'invalid', 'managed', 'dangerous', 'hierarchy'].includes(req.query.shoperr) ? req.query.shoperr : null;

        const rolesReport = req.session.rolesReport || null;
        delete req.session.rolesReport;
        const roleById = (id) => (id ? roles.find((r) => r.id === id) : null);
        const hierarchy = {
            memberRole: roleById(settings.member_role_id)?.name || null,
            modRole: roles.find((r) => r.name === rolekit.MOD_ROLE_NAME)?.name || null,
            gatingOn: !!(settings.verify_channel_id && roleById(settings.member_role_id)),
            dividers: Object.values(rolekit.DIVIDERS).map((d) => roleById(settings[d.col])?.name).filter(Boolean),
        };
        try {
            const g = await rolekit.loadGroups(guildId);
            hierarchy.hasDividers = g.dividerIds.size > 0;
            hierarchy.dividerIds = [...g.dividerIds];
            hierarchy.groups = Object.keys(rolekit.DIVIDERS).map((kind) => ({ kind, selected: [...(g.explicit[kind] || [])], everyone: g.everyone.has(kind) }));
            hierarchy.style = ['bar', 'custom'].includes(settings.divider_style) ? settings.divider_style : 'line';
            hierarchy.template = rolekit.cleanTemplate(settings.divider_template) || rolekit.DEFAULT_TEMPLATE;
            hierarchy.pad = Number.isFinite(+settings.divider_pad) ? +settings.divider_pad : 14;
        } catch (e) { hierarchy.hasDividers = false; hierarchy.dividerIds = []; hierarchy.groups = []; }

        const editingId = req.query.edit || null;
        const editingArtist = editingId ? artistDetails.find(a => a.user_id === editingId) : null;

        res.render('dashboard', {
            user: req.session.user, settings, channels, updateChannels, rolesReport, hierarchy, categories, roles, adminRoles, levelRoles, shopItems, shopErr, updErr, updatesVersion, commandsMissing,
            reinviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=${BOT_INVITE_PERMISSIONS}&scope=bot%20applications.commands&guild_id=${guildId}&disable_guild_select=true`, artistCount, memberCount,
            artists: artistDetails, editingArtist,
            pricingCategories: ['Headshot', 'Bust', 'Full Body', 'Colored', 'Flat / Lineart'],
            currentLang: settings.site_language || 'en',
            guildLangContext: true,
            t: (key, vars) => t(settings.site_language || 'en', key, vars),
            activeTab: req.query.tab || (editingArtist ? 'tickets' : 'verification'),
            success: req.query.status === 'success',
            roleResult: {
                made: parseInt(req.query.rolesmade, 10) || 0,
                reused: parseInt(req.query.rolesreused, 10) || 0,
                skipped: parseInt(req.query.rolesskipped, 10) || 0,
                done: req.query.rolesmade !== undefined,
                error: ['invalid', 'toomany', 'perm', 'limit', 'failed'].includes(req.query.roleerr) ? req.query.roleerr : null,
            },
            pageTitle: 'Projeckt V: Astra — Dashboard'
        });
    } catch (err) { console.error(err); res.status(500).send("DB Error."); }
});

// Old /tickets URL now redirects into the Tickets tab of the unified page,
// so any existing links/bookmarks still land somewhere sensible.
app.get('/tickets', checkAuth, (req, res) => {
    const query = new URLSearchParams(req.query);
    query.set('tab', 'tickets');
    res.redirect(`/dashboard?${query.toString()}`);
});

app.post('/api/update-verification', checkAuth, async (req, res) => {
    const { guild_id, verify_channel_id, rules_channel_id, rules_role_id, verify_role_id, member_role_id, log_channel_id, joinleave_log_enabled } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    if (!idsBelongToGuild(guild_id, { channels: [verify_channel_id, rules_channel_id, log_channel_id], roles: [rules_role_id, verify_role_id, member_role_id] })) return res.status(400).send('Invalid channel or role.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, verify_channel_id, rules_channel_id, rules_role_id, verify_role_id, member_role_id, log_channel_id, joinleave_log_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (guild_id) DO UPDATE SET
                verify_channel_id = $2, rules_channel_id = NULLIF($3, ''), rules_role_id = NULLIF($4, ''),
                verify_role_id = NULLIF($5, ''), member_role_id = $6, log_channel_id = NULLIF($7, ''),
                joinleave_log_enabled = $8
        `, [guild_id, verify_channel_id, rules_channel_id, rules_role_id, verify_role_id, member_role_id, log_channel_id, joinleave_log_enabled === 'on']);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated verification settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/update-language', checkAuth, async (req, res) => {
    const { guild_id, language } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const lang = normalizeLanguage(language);
    try {
        await db.query(
            `INSERT INTO guild_settings (guild_id, language) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET language = $2`,
            [guild_id, lang]
        );

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `🌐 ${req.session.user.username} changed Astra's language to ${lang === 'pt-br' ? 'Português (Brasil)' : 'English'} from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// Separate channel for admin/config-change notices (see logAction in
// commands/config.js). Empty = fall back to the main log channel.
app.post('/api/update-admin-log', checkAuth, async (req, res) => {
    const { guild_id, admin_log_channel_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const guild = client.guilds.cache.get(guild_id);
    let channelId = null;
    if (admin_log_channel_id) {
        const ch = guild?.channels.cache.get(admin_log_channel_id);
        if (!ch || !ch.isTextBased()) return res.status(400).send('Invalid channel.');
        channelId = ch.id;
    }

    try {
        await db.query(
            `INSERT INTO guild_settings (guild_id, admin_log_channel_id) VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET admin_log_channel_id = $2`,
            [guild_id, channelId]
        );
        if (guild) await configCommand.logAction(guild, channelId
            ? `⚙️ ${req.session.user.username} set this channel for admin notices from the website.`
            : `⚙️ ${req.session.user.username} sent admin notices back to the main log channel from the website.`);
        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error saving admin log channel:', err);
        res.status(500).send("DB Error.");
    }
});

// FIX: this is the actual fix for "setup via the site doesn't do anything" —
// saving settings alone never posted the button panel to Discord. This
// explicitly does what /config verification does on Discord, using the
// settings already saved in the database. Requires Save Configuration to
// have been clicked first.
app.post('/api/send-verification-panel', checkAuth, async (req, res) => {
    const { guild_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const guild = client.guilds.cache.get(guild_id);
    if (!guild) return res.status(400).send('Astra is not in that server.');

    try {
        const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guild_id]);
        const settings = rows[0];
        if (!settings || !settings.verify_channel_id || !settings.member_role_id) {
            return res.redirect('/dashboard?status=error&reason=incomplete');
        }
        await configCommand.postVerificationPanel(guild, settings);
        res.redirect('/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error posting verification panel from site:', err);
        res.status(500).send('Failed to post the panel — check Astra has permission to send messages in that channel.');
    }
});

app.post('/api/update-antiscam', checkAuth, async (req, res) => {
    const { guild_id, antiscam_enabled, antiscam_action, antiscam_min_age_hours, antiscam_require_no_avatar } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, antiscam_enabled, antiscam_action, antiscam_min_age_hours, antiscam_require_no_avatar)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id) DO UPDATE SET
                antiscam_enabled = $2, antiscam_action = $3, antiscam_min_age_hours = $4, antiscam_require_no_avatar = $5
        `, [guild_id, antiscam_enabled === 'on', antiscam_action || 'log', parseInt(antiscam_min_age_hours, 10) || 24, antiscam_require_no_avatar === 'on']);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated anti-scam settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/update-autokick', checkAuth, async (req, res) => {
    const { guild_id, auto_kick_enabled, auto_kick_days } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, auto_kick_enabled, auto_kick_days)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id) DO UPDATE SET auto_kick_enabled = $2, auto_kick_days = $3
        `, [guild_id, auto_kick_enabled === 'on', parseInt(auto_kick_days, 10) || 2]);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated auto-kick settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// NEW: public welcome/leave messages — see commands/config.js
// sendWelcomeMessage/sendLeaveMessage and /config welcome|leave on Discord.
app.post('/api/update-welcome', checkAuth, async (req, res) => {
    const { guild_id, welcome_enabled, welcome_channel_id, welcome_message, welcome_card_enabled } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    if (welcome_enabled === 'on' && !welcome_channel_id) {
        return res.status(400).send('Pick a welcome channel before enabling welcome messages.');
    }

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, welcome_enabled, welcome_channel_id, welcome_message, welcome_card_enabled)
            VALUES ($1, $2, NULLIF($3, ''), $4, $5)
            ON CONFLICT (guild_id) DO UPDATE SET
                welcome_enabled = $2,
                welcome_channel_id = NULLIF($3, ''),
                welcome_message = $4,
                welcome_card_enabled = $5
        `, [
            guild_id, welcome_enabled === 'on', welcome_channel_id,
            (welcome_message && welcome_message.trim()) || 'Welcome {user} to **{server}**! You\'re member #{membercount}.',
            welcome_card_enabled === 'on'
        ]);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated welcome message settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error saving welcome settings:', err);
        res.status(500).send("DB Error.");
    }
});

app.post('/api/update-leave', checkAuth, async (req, res) => {
    const { guild_id, leave_enabled, leave_channel_id, leave_message } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    if (leave_enabled === 'on' && !leave_channel_id) {
        return res.status(400).send('Pick a leave channel before enabling leave messages.');
    }

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, leave_enabled, leave_channel_id, leave_message)
            VALUES ($1, $2, NULLIF($3, ''), $4)
            ON CONFLICT (guild_id) DO UPDATE SET
                leave_enabled = $2,
                leave_channel_id = NULLIF($3, ''),
                leave_message = $4
        `, [
            guild_id, leave_enabled === 'on', leave_channel_id,
            (leave_message && leave_message.trim()) || '**{username}** has left the server. We\'re now at {membercount} members.'
        ]);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated leave message settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error saving leave settings:', err);
        res.status(500).send("DB Error.");
    }
});

// NEW: XP/leveling system — see commands/leveling.js. Milestone role
// rewards (guild_level_roles) are managed below (/api/level-roles/*) and
// on Discord via /config level-roles — both write the same table.
app.post('/api/update-leveling', checkAuth, async (req, res) => {
    const { guild_id, leveling_enabled, levelup_channel_id, levelup_message, xp_cooldown_seconds, xp_min, xp_max } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const minXp = parseInt(xp_min, 10) || 15;
    const maxXp = parseInt(xp_max, 10) || 25;
    if (minXp > maxXp) {
        return res.status(400).send('"Min XP" can\'t be greater than "Max XP".');
    }

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, leveling_enabled, levelup_channel_id, levelup_message, xp_cooldown_seconds, xp_min, xp_max)
            VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7)
            ON CONFLICT (guild_id) DO UPDATE SET
                leveling_enabled = $2,
                levelup_channel_id = NULLIF($3, ''),
                levelup_message = $4,
                xp_cooldown_seconds = $5,
                xp_min = $6,
                xp_max = $7
        `, [
            guild_id, leveling_enabled === 'on', levelup_channel_id,
            (levelup_message && levelup_message.trim()) || '🎉 {user} just reached **Level {level}**!',
            parseInt(xp_cooldown_seconds, 10) || 60, minXp, maxXp
        ]);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated leveling settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error saving leveling settings:', err);
        res.status(500).send("DB Error.");
    }
});

// Level-up role rewards, website side of /config level-roles. Same table,
// same one-role-per-level rule (adding an existing level replaces its role).
app.post('/api/level-roles/add', checkAuth, async (req, res) => {
    const { guild_id, level, role_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const lvl = parseInt(level, 10);
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 1000 || !role_id) {
        return res.redirect('/dashboard?tab=leveling');
    }

    // Only accept a real, assignable role from this guild (not @everyone,
    // not a bot-managed role), so a tampered form can't store junk.
    const guild = client.guilds.cache.get(guild_id);
    const role = guild?.roles.cache.get(role_id);
    if (!role || role.id === guild.id || role.managed) {
        return res.status(400).send('Invalid role.');
    }

    try {
        await db.query(
            `INSERT INTO guild_level_roles (guild_id, level, role_id) VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, level) DO UPDATE SET role_id = $3`,
            [guild_id, lvl, role_id]
        );
        await configCommand.logAction(guild, `⚙️ ${req.session.user.username} set ${role} as the reward for reaching level ${lvl} from the website.`);
        res.redirect('/dashboard?tab=leveling&status=success');
    } catch (err) {
        console.error('❌ Error adding level role:', err);
        res.status(500).send("DB Error.");
    }
});

// Creates the cosmetic milestone roles for the server (e.g. Level 10, 20, 30...)
// and registers each one as that level's reward, so nobody has to make the
// roles by hand in Discord first. Colors fade from color_from to color_to.
// Nothing is overwritten: levels that already have a reward are skipped, and a
// role that already exists with the exact same name is reused, so submitting
// twice never makes duplicates.
const ROLE_BATCH_MAX = 15;
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const n = parseInt(m ? m[1] : '99aab5', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
app.post('/api/level-roles/create', checkAuth, async (req, res) => {
    const { guild_id, levels, name_template, color_from, color_to, hoist } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    const back = (q) => res.redirect(`/dashboard?tab=leveling&${q}`);

    const parsed = [...new Set(String(levels || '').split(/[\s,;]+/)
        .map(x => parseInt(x, 10))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 1000))].sort((a, b) => a - b);
    if (parsed.length === 0) return back('roleerr=invalid');
    if (parsed.length > ROLE_BATCH_MAX) return back('roleerr=toomany');

    const guild = client.guilds.cache.get(guild_id);
    const me = guild?.members.me;
    if (!guild || !me) return back('roleerr=invalid');
    if (!me.permissions.has('ManageRoles')) return back('roleerr=perm');

    let template = String(name_template || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80) || 'Level {level}';
    if (!template.includes('{level}')) template += ' {level}';

    try {
        const { rows: existing } = await db.query('SELECT level FROM guild_level_roles WHERE guild_id = $1', [guild_id]);
        const taken = new Set(existing.map(r => r.level));
        const todo = parsed.filter(l => !taken.has(l));
        const skipped = parsed.length - todo.length;

        if (guild.roles.cache.size + todo.length > 250) return back('roleerr=limit');

        const from = hexToRgb(color_from), to = hexToRgb(color_to || color_from);
        let made = 0, reused = 0;
        for (let i = 0; i < todo.length; i++) {
            const lvl = todo[i];
            const f = todo.length === 1 ? 0 : i / (todo.length - 1);
            const rgb = from.map((c, k) => Math.round(c + (to[k] - c) * f));
            const color = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
            const name = template.replace(/\{level\}/g, String(lvl)).slice(0, 100);

            let role = guild.roles.cache.find(r => r.name === name && !r.managed && r.id !== guild.id);
            if (role) {
                reused++;
            } else {
                role = await guild.roles.create({
                    name, color, hoist: hoist === 'on', mentionable: false, permissions: [],
                    reason: `Level ${lvl} reward role, created from the Astra dashboard by ${req.session.user.username}`,
                });
                made++;
            }
            await db.query(
                `INSERT INTO guild_level_roles (guild_id, level, role_id) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id, level) DO UPDATE SET role_id = $3`,
                [guild_id, lvl, role.id]
            );
        }

        await configCommand.logAction(guild, `⚙️ ${req.session.user.username} created level reward roles from the website (levels ${todo.join(', ') || 'none new'}).`);
        back(`rolesmade=${made}&rolesreused=${reused}&rolesskipped=${skipped}`);
    } catch (err) {
        console.error('❌ Error creating level roles:', err);
        back('roleerr=failed');
    }
});

app.post('/api/level-roles/remove', checkAuth, async (req, res) => {
    const { guild_id, level } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const lvl = parseInt(level, 10);
    if (!Number.isInteger(lvl)) return res.redirect('/dashboard?tab=leveling');

    try {
        await db.query('DELETE FROM guild_level_roles WHERE guild_id = $1 AND level = $2', [guild_id, lvl]);
        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} removed the role reward for level ${lvl} from the website.`);
        res.redirect('/dashboard?tab=leveling&status=success');
    } catch (err) {
        console.error('❌ Error removing level role:', err);
        res.status(500).send("DB Error.");
    }
});

// NEW: toggle for the mention/name reply — see commands/fun.js. No channel
// or message template to configure, just on/off.
app.post('/api/update-fun', checkAuth, async (req, res) => {
    const { guild_id, mention_replies_enabled } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(
            `INSERT INTO guild_settings (guild_id, mention_replies_enabled) VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET mention_replies_enabled = $2`,
            [guild_id, mention_replies_enabled === 'on']
        );

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} ${mention_replies_enabled === 'on' ? 'enabled' : 'disabled'} mention/name replies from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error saving fun settings:', err);
        res.status(500).send("DB Error.");
    }
});

// Experimental smart replies toggle — see commands/ai.js. Default OFF.
app.post('/api/update-ai', checkAuth, async (req, res) => {
    const { guild_id, ai_enabled } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query(
            `INSERT INTO guild_settings (guild_id, ai_enabled) VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET ai_enabled = $2`,
            [guild_id, ai_enabled === 'on']
        );

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} ${ai_enabled === 'on' ? 'enabled' : 'disabled'} experimental smart replies from the website.`);

        respondSaved(req, res, '/dashboard?tab=fun&status=success');
    } catch (err) {
        console.error('❌ Error saving AI settings:', err);
        res.status(500).send("DB Error.");
    }
});

// NEW: economy/currency system — see commands/economy.js. No shop/gambling
// yet, just the toggle + cosmetic/payout settings; balances themselves
// aren't editable from the website (that's intentional — avoids a "give
// myself coins" exploit via the dashboard).
app.post('/api/update-economy', checkAuth, async (req, res) => {
    const { guild_id, economy_enabled, currency_name, currency_symbol, daily_min, daily_max, daily_streak_bonus } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const minDaily = parseInt(daily_min, 10) || 50;
    const maxDaily = parseInt(daily_max, 10) || 150;
    if (minDaily > maxDaily) {
        return res.status(400).send('"Min Daily" can\'t be greater than "Max Daily".');
    }

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, economy_enabled, currency_name, currency_symbol, daily_min, daily_max, daily_streak_bonus)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guild_id) DO UPDATE SET
                economy_enabled = $2,
                currency_name = $3,
                currency_symbol = $4,
                daily_min = $5,
                daily_max = $6,
                daily_streak_bonus = $7
        `, [
            guild_id, economy_enabled === 'on',
            (currency_name && currency_name.trim()) || 'Coins',
            (currency_symbol && currency_symbol.trim()) || '🪙',
            minDaily, maxDaily, parseInt(daily_streak_bonus, 10) || 10
        ]);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated economy settings from the website.`);

        respondSaved(req, res, '/dashboard?status=success');
    } catch (err) {
        console.error('❌ Error saving economy settings:', err);
        res.status(500).send("DB Error.");
    }
});

// NEW: economy part 2 — random events + shop (see commands/shop.js).
// Event settings autosave like every other form here. Shop roles are
// validated server-side with the same rules as /shopconfig (real role, below
// Astra's, no powerful permissions), so a tampered form can't sell an admin role.
app.post('/api/update-events', checkAuth, async (req, res) => {
    const { guild_id, events_enabled, events_channel_id, events_interval_min } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const interval = Math.min(1440, Math.max(10, parseInt(events_interval_min, 10) || 45));
    const channelId = /^\d{5,25}$/.test(events_channel_id || '') ? events_channel_id : null;

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, events_enabled, events_channel_id, events_interval_min)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id) DO UPDATE SET
                events_enabled = $2, events_channel_id = $3, events_interval_min = $4
        `, [guild_id, events_enabled === 'on', channelId, interval]);
        shopCommand.invalidate(guild_id);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `🎲 ${req.session.user.username} updated random event settings from the website.`);
        respondSaved(req, res, '/dashboard?tab=economy&status=success');
    } catch (err) {
        console.error('❌ Error saving event settings:', err);
        res.status(500).send("DB Error.");
    }
});

// --- Updates channel (commands/updates.js) — Dashboard > Updates tab ---
// Explicit Save button (not autosave) so a bad channel can show an error.
const updatesRedirect = (res, err) => res.redirect(err ? `/dashboard?tab=updates&upderr=${err}` : '/dashboard?tab=updates&status=success');

app.post('/api/updates/save', checkAuth, async (req, res) => {
    const { guild_id, updates_enabled, updates_channel_id, updates_role_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    const isId = (v) => /^\d{5,25}$/.test(v || '');
    const enabled = updates_enabled === 'on';
    const channelId = isId(updates_channel_id) ? updates_channel_id : null;
    const roleId = isId(updates_role_id) ? updates_role_id : null;
    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return updatesRedirect(res, 'offline');
        if (enabled) {
            if (!channelId) return updatesRedirect(res, 'channel');
            const check = await updatesCommand.usableChannel(guild, channelId, { fix: true });
            if (!check.ok) return updatesRedirect(res, 'perms');
        }
        await updatesCommand.saveSettings(guild_id, { enabled, channelId, roleId });
        await configCommand.logAction(guild, `📣 ${req.session.user.username} ${enabled ? 'updated' : 'turned off'} the updates channel from the website.`);
        updatesRedirect(res);
    } catch (err) {
        console.error('❌ Error saving updates settings:', err);
        res.status(500).send('DB Error.');
    }
});

app.post('/api/updates/create-channel', checkAuth, async (req, res) => {
    const { guild_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return updatesRedirect(res, 'offline');
        const { rows } = await db.query('SELECT language, updates_role_id FROM guild_settings WHERE guild_id = $1', [guild_id]);
        const made = await updatesCommand.createUpdatesChannel(guild, rows[0] || {}, req.session.user.username);
        if (!made.ok) return updatesRedirect(res, made.error);
        await updatesCommand.saveSettings(guild_id, { enabled: true, channelId: made.channel.id, roleId: rows[0]?.updates_role_id || null });
        await configCommand.logAction(guild, `📣 ${req.session.user.username} created ${made.channel} for Astra updates from the website.`);
        updatesRedirect(res);
    } catch (err) {
        console.error('❌ Error creating updates channel:', err);
        updatesRedirect(res, 'failed');
    }
});

app.post('/api/updates/preview', checkAuth, async (req, res) => {
    const { guild_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return updatesRedirect(res, 'offline');
        const { rows } = await db.query('SELECT updates_enabled, updates_channel_id FROM guild_settings WHERE guild_id = $1', [guild_id]);
        const s = rows[0];
        if (!s?.updates_enabled || !s.updates_channel_id) return updatesRedirect(res, 'off');
        const check = await updatesCommand.usableChannel(guild, s.updates_channel_id);
        if (!check.ok) return updatesRedirect(res, 'perms');
        const current = updatesCommand.currentEntry();
        if (!current) return updatesRedirect(res, 'failed');
        await updatesCommand.postEntry(check.channel, current); // no role ping on a preview
        updatesRedirect(res);
    } catch (err) {
        console.error('❌ Error posting updates preview:', err);
        updatesRedirect(res, 'failed');
    }
});

app.post('/api/shop/add', checkAuth, async (req, res) => {
    const { guild_id, name, price, role_id, description } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const guild = client.guilds.cache.get(guild_id);
    if (!guild) return res.status(500).send('Astra isn\'t connected to that server right now.');
    try {
        const result = await shopCommand.addRoleItem(guild, {
            name, price: parseInt(price, 10), roleId: role_id, description: description || ''
        });
        if (!result.ok) return res.redirect(`/dashboard?tab=economy&shoperr=${encodeURIComponent(result.error)}`);
        await configCommand.logAction(guild, `🛒 ${req.session.user.username} added shop item **${result.name}** from the website.`);
        res.redirect('/dashboard?tab=economy&status=success');
    } catch (err) {
        console.error('❌ Error adding shop item:', err);
        res.status(500).send("DB Error.");
    }
});

app.post('/api/shop/remove', checkAuth, async (req, res) => {
    const { guild_id, name } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    try {
        await shopCommand.removeItemByName(guild_id, name);
        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `🛒 ${req.session.user.username} removed shop item **${String(name).slice(0, 40)}** from the website.`);
        res.redirect('/dashboard?tab=economy&status=success');
    } catch (err) {
        console.error('❌ Error removing shop item:', err);
        res.status(500).send("DB Error.");
    }
});

app.post('/api/admins/add', checkAuth, async (req, res) => {
    const { guild_id, role_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    if (!role_id) return res.redirect('/dashboard?status=success');
    if (!idsBelongToGuild(guild_id, { roles: [role_id] })) return res.status(400).send('Invalid role.');

    try {
        await db.query(`INSERT INTO guild_admin_roles (guild_id, role_id) VALUES ($1, $2) ON CONFLICT (guild_id, role_id) DO NOTHING`, [guild_id, role_id]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// --- Artist portal: an artist edits ONLY their own commission panel -------------
// The artist is always the logged-in person (never read from the form), and is
// re-checked on every request: still in the server, still an artist there.
async function renderArtistPanel(req, res, ctx, { profile, pricing, err = null, saved = false }) {
    const siteLang = req.session.siteLang || 'en';
    res.render('artist_panel', {
        user: req.session.user,
        guildId: ctx.guild.id, guildName: ctx.guild.name,
        guildIcon: ctx.guild.icon ? `https://cdn.discordapp.com/icons/${ctx.guild.id}/${ctx.guild.icon}.png` : null,
        artistName: ctx.member.displayName,
        artistAvatar: ctx.member.displayAvatarURL({ size: 128, extension: 'png' }),
        profile, pricing, defaults: artistPortal.DEFAULTS, limits: artistPortal.LIMITS,
        err, saved,
        currentLang: siteLang,
        t: (key, vars) => t(siteLang, key, vars),
        pageTitle: 'Projeckt V: Astra — Your Commission Panel',
    });
}

app.get('/artist-panel/:guildId', checkAuth, async (req, res) => {
    try {
        const ctx = await artistPortal.artistContext(client, req.params.guildId, req.session.user.id);
        if (!ctx) return res.status(403).redirect('/select-server');
        const { profile, pricing } = await artistPortal.loadPanel(ctx.guild.id, req.session.user.id);
        const err = req.query.err === 'bad_url' ? 'bad_url' : null;
        await renderArtistPanel(req, res, ctx, { profile, pricing, err, saved: req.query.saved === '1' });
    } catch (e) {
        console.error('❌ Artist panel load failed:', e);
        res.status(500).send('Could not load your panel.');
    }
});

app.post('/artist-panel/:guildId', checkAuth, async (req, res) => {
    try {
        const ctx = await artistPortal.artistContext(client, req.params.guildId, req.session.user.id);
        if (!ctx) return res.status(403).redirect('/select-server');
        const parsed = artistPortal.parseForm(req.body);
        if (!parsed.ok) {
            // Show the form again with what they typed, so nothing is lost.
            const b = req.body || {};
            const profile = { tos_text: b.tos_text, wontdo_text: b.wontdo_text, askme_text: b.askme_text, banner_url: b.banner_url,
                link_portfolio: b.link_portfolio, link_twitter: b.link_twitter, link_instagram: b.link_instagram, link_other: b.link_other, link_other_label: b.link_other_label };
            const pricing = artistPortal.CATEGORIES.map((category, i) => ({ category, price: String(b[`price_${i}`] || '') }));
            return renderArtistPanel(req, res, ctx, { profile, pricing, err: parsed.error });
        }
        await artistPortal.savePanel(ctx.guild.id, req.session.user.id, parsed.values);
        await configCommand.logAction(ctx.guild, `🎨 ${ctx.member} updated their commission panel from the website.`);
        res.redirect(`/artist-panel/${ctx.guild.id}?saved=1`);
    } catch (e) {
        console.error('❌ Artist panel save failed:', e);
        res.status(500).send('Could not save your panel.');
    }
});

// ---------------------------------------------------------------- owner page
// A private page for the bot owner (the account Discord lists as the application's
// owner). It has no link anywhere; for anyone else, and for visitors who are not
// logged in, the address simply does not exist (404). Same actions as the DM
// commands, see commands/owner.js.
const ownerGate = async (req, res, next) => {
    try {
        if (!req.session.user) return next('route');
        const ids = await getOwnerIds(client);
        if (!ids.includes(req.session.user.id)) return next('route');
        return next();
    } catch (e) { return next('route'); }
};
const devBack = (req, res, ok, text, id) => {
    req.session.devFlash = { ok, text };
    req.session.save(() => res.redirect('/dev' + (id && /^\d{15,25}$/.test(id) ? `?id=${id}` : '')));
};
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

app.get('/dev', ownerGate, async (req, res) => {
    try {
        const all = ownerCommand.guildRows(client);
        const per = 25;
        const pages = Math.max(1, Math.ceil(all.length / per));
        const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
        const selectedId = /^\d{15,25}$/.test(String(req.query.id || '')) ? String(req.query.id) : null;
        const flash = req.session.devFlash || null; delete req.session.devFlash;
        const siteLang = req.session.siteLang || 'en';
        res.render('dev_panel', {
            user: req.session.user, currentLang: siteLang, t: (key, vars) => t(siteLang, key, vars),
            pageTitle: 'Projeckt V: Astra — Developer',
            total: all.length, page, pages,
            servers: all.slice((page - 1) * per, page * per).map((g) => ({ ...g, added: day(g.joinedAt) })),
            selected: selectedId ? await ownerCommand.serverInfo(client, selectedId) : null,
            selectedAdded: selectedId ? day(client.guilds.cache.get(selectedId)?.joinedTimestamp) : null,
            blocked: (await ownerCommand.listBlocked()).map((b) => ({ id: b.guild_id, reason: b.reason, at: day(b.blocked_at && new Date(b.blocked_at).getTime()) })),
            flash,
        });
    } catch (e) {
        console.error('❌ Owner page failed:', e);
        res.status(500).send('Could not load this page.');
    }
});

const devAction = (path, fn) => app.post(path, writeLimiter, ownerGate, async (req, res) => {
    const id = String(req.body.id || '').trim();
    try {
        const out = await fn(req, id);
        if (out && out.download) return; // the handler already answered
        return devBack(req, res, out.ok !== false, out.text, id);
    } catch (e) {
        console.error(`❌ Owner action ${path} failed:`, e.message);
        return devBack(req, res, false, `Failed: ${String(e.message).slice(0, 200)}`, id);
    }
});
devAction('/dev/server/leave', async (req, id) => {
    const r = await ownerCommand.removeServer(client, id, { block: false, reason: req.body.reason, by: 'website' });
    return { text: `Left ${r.name || id}${r.wasIn ? '' : ' (she was not in it)'}. Its data is deleted automatically after 30 days.` };
});
devAction('/dev/server/block', async (req, id) => {
    const r = await ownerCommand.removeServer(client, id, { block: true, reason: req.body.reason, by: 'website' });
    return { text: `Blocked ${r.name || id}${r.wasIn ? '' : ' (she was not in it)'}. She will refuse to rejoin.` };
});
devAction('/dev/server/unblock', async (req, id) => ({ text: (await ownerCommand.unblockServer(id)) ? `${id} is no longer blocked.` : 'That server was not blocked.' }));
devAction('/dev/server/purge', async (req, id) => {
    const r = await ownerCommand.purgeServer(client, id, req.body.confirm);
    return r.ok ? { text: `All stored data for ${id} was deleted.` } : { ok: false, text: r.error };
});
devAction('/dev/user/delete', async (req) => {
    const userId = String(req.body.user_id || '').trim();
    if (req.body.confirm !== 'yes') return { ok: false, text: 'Tick the confirmation box to delete. Nothing was deleted.' };
    const counts = await ownerCommand.deleteUserData(userId, { moderation: req.body.include_moderation === 'on' });
    return { text: `Deleted data for ${userId}: ` + (Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing stored') + '.' };
});
devAction('/dev/user/export', async (req) => {
    const userId = String(req.body.user_id || '').trim();
    const out = await ownerCommand.exportUserData(userId);
    const res = req.res;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="astra-data-${userId}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out.json);
    return { download: true };
});
devAction('/dev/backup', async () => {
    const out = await backup.sendBackup(client, { reason: 'manual' });
    return out.ok ? { text: `Backup sent to your DMs (${out.rows} rows).` } : { ok: false, text: `Backup not sent (${out.reason}).` };
});

// Creates the Astra Admin / Verified roles when missing, lets Verified members
// use Astra's everyday commands, and (optionally) creates the divider roles.
app.post('/api/roles/setup', checkAuth, async (req, res) => {
    const { guild_id, dividers } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return res.redirect('/dashboard?tab=admins&upderr=offline');
        const result = await rolekit.setupHierarchy(guild, { dividers: dividers === 'on' });
        req.session.rolesReport = result.lines;
        await configCommand.logAction(guild, `⚙️ ${req.session.user.username} ran the role hierarchy setup from the website.`);
        req.session.save(() => res.redirect('/dashboard?tab=admins&status=success'));
    } catch (err) {
        console.error('❌ Error in role setup:', err);
        req.session.rolesReport = [{ k: 'r_error' }];
        req.session.save(() => res.redirect('/dashboard?tab=admins'));
    }
});

// Which roles each divider heads (see rolekit.js). Re-places the dividers and
// re-syncs every member in the background.
app.post('/api/roles/groups', checkAuth, async (req, res) => {
    const { guild_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return res.redirect('/dashboard?tab=admins&upderr=offline');
        const selections = {};
        const everyone = [];
        for (const kind of Object.keys(rolekit.DIVIDERS)) {
            selections[kind] = req.body[`group_${kind}`];
            if (req.body[`everyone_${kind}`] === 'on') everyone.push(kind);
        }
        await rolekit.saveGroups(guild, selections);
        const opts = await rolekit.saveOptions(guild_id, { style: req.body.divider_style, pad: req.body.divider_pad, template: req.body.divider_template, everyone });
        await rolekit.restyleDividers(guild);
        const failed = await rolekit.arrangeDividers(guild);
        const started = rolekit.startBackfill(guild);
        req.session.rolesReport = [{ k: 'r_groups_saved' }, ...(opts.templateInvalid ? [{ k: 'r_template_invalid' }] : []), ...failed.map((name) => ({ k: 'r_place_fail', name })), { k: started ? 'r_backfill' : 'r_resync_busy' }];
        await configCommand.logAction(guild, `⚙️ ${req.session.user.username} changed the divider role settings from the website.`);
        req.session.save(() => res.redirect('/dashboard?tab=admins&status=success'));
    } catch (err) {
        console.error('❌ Error saving divider groups:', err);
        req.session.rolesReport = [{ k: 'r_error' }];
        req.session.save(() => res.redirect('/dashboard?tab=admins'));
    }
});

// "Check everyone now": re-style and re-place the dividers, then re-check every
// member's dividers. Only when asked from the site, and at most every 5 minutes.
app.post('/api/roles/resync', checkAuth, async (req, res) => {
    const { guild_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return res.redirect('/dashboard?tab=admins&upderr=offline');
        const r = await rolekit.resync(guild);
        req.session.rolesReport = r.ok
            ? [{ k: 'r_resync_started' }, ...r.failed.map((name) => ({ k: 'r_place_fail', name }))]
            : [{ k: r.reason === 'busy' ? 'r_resync_busy' : 'r_resync_cooldown' }];
        if (r.ok) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} asked Astra to re-check divider roles for all members from the website.`);
        req.session.save(() => res.redirect('/dashboard?tab=admins&status=success'));
    } catch (err) {
        console.error('❌ Error in resync:', err);
        req.session.rolesReport = [{ k: 'r_error' }];
        req.session.save(() => res.redirect('/dashboard?tab=admins'));
    }
});

app.post('/api/admins/remove', checkAuth, async (req, res) => {
    const { guild_id, role_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query('DELETE FROM guild_admin_roles WHERE guild_id = $1 AND role_id = $2', [guild_id, role_id]);
        res.redirect('/dashboard?status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// NEW: /tickets — admin-only ticket system config + artist management,
// mirroring /config tickets and /artist on Discord. Same checkAuth gate as
// /dashboard; there's no separate "is this Discord user actually an admin
// of this specific guild" check here beyond what select-server already
// filtered on (guilds where they hold Administrator), matching the rest of
// this dashboard's existing trust model.
app.post('/api/tickets/config', checkAuth, async (req, res) => {
    const { guild_id, ticket_channel_id, ticket_category_id, log_channel_id, artist_setup_category_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    if (!idsBelongToGuild(guild_id, { channels: [ticket_channel_id, ticket_category_id, log_channel_id, artist_setup_category_id] })) return res.status(400).send('Invalid channel or category.');

    try {
        await db.query(`
            INSERT INTO guild_settings (guild_id, ticket_channel_id, ticket_category_id, log_channel_id, artist_setup_category_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id) DO UPDATE SET
                ticket_channel_id = $2, ticket_category_id = $3,
                log_channel_id = COALESCE(NULLIF($4, ''), guild_settings.log_channel_id),
                artist_setup_category_id = NULLIF($5, '')
        `, [guild_id, ticket_channel_id, ticket_category_id, log_channel_id, artist_setup_category_id]);

        const guild = client.guilds.cache.get(guild_id);
        if (guild) await configCommand.logAction(guild, `⚙️ ${req.session.user.username} updated ticket settings from the website.`);

        respondSaved(req, res, '/dashboard?tab=tickets&status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// FIX: same issue as verification — saving ticket config never actually
// posted the "Open a Ticket" button to Discord. This does that explicitly.
app.post('/api/send-ticket-panel', checkAuth, async (req, res) => {
    const { guild_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const guild = client.guilds.cache.get(guild_id);
    if (!guild) return res.status(400).send('Astra is not in that server.');

    try {
        const { rows } = await db.query('SELECT ticket_channel_id FROM guild_settings WHERE guild_id = $1', [guild_id]);
        const ticketChannelId = rows[0]?.ticket_channel_id;
        if (!ticketChannelId) return res.redirect('/dashboard?tab=tickets&status=error&reason=incomplete');

        const ticketChannel = await guild.channels.fetch(ticketChannelId).catch(() => null);
        if (!ticketChannel) return res.status(400).send('Ticket channel not found — check it still exists.');

        await configCommand.postTicketPanel(ticketChannel);
        res.redirect('/dashboard?tab=tickets&status=success');
    } catch (err) {
        console.error('❌ Error posting ticket panel from site:', err);
        res.status(500).send('Failed to post the panel — check Astra has permission to send messages in that channel.');
    }
});

app.post('/api/artists/add', checkAuth, async (req, res) => {
    const { guild_id, user_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');
    if (!/^\d{15,25}$/.test(user_id || '')) return res.status(400).send('Invalid Discord User ID.');

    try {
        await db.query(`INSERT INTO artists (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`, [guild_id, user_id]);

        // Best-effort: also create their private setup channel, same as
        // the /artist add Discord command does. This works even though
        // we're in an Express route because `client` (the discord.js
        // client, declared further down this file) is fully initialized
        // by the time any real request reaches here.
        const guild = client.guilds.cache.get(guild_id);
        if (guild) {
            await ticketsCommand.ensureArtistSetupChannel(guild, user_id).catch(err => console.error('❌ Error creating setup channel from site:', err));
            await ticketsCommand.grantArtistRole(guild, user_id);
        }

        res.redirect('/dashboard?tab=tickets&status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.post('/api/artists/create-setup-channel', checkAuth, async (req, res) => {
    const { guild_id, user_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) return res.status(500).send('Astra isn\'t connected to that server right now.');
        await ticketsCommand.ensureArtistSetupChannel(guild, user_id);
        res.redirect('/dashboard?tab=tickets&status=success');
    } catch (err) {
        console.error('❌ Error creating setup channel:', err);
        res.status(500).send('Could not create the setup channel — make sure an Artist Setup Category is configured and Astra has Manage Channels permission.');
    }
});

app.post('/api/artists/remove', checkAuth, async (req, res) => {
    const { guild_id, user_id } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    try {
        await db.query('DELETE FROM artists WHERE guild_id = $1 AND user_id = $2', [guild_id, user_id]);
        await db.query('DELETE FROM artist_pricing WHERE guild_id = $1 AND user_id = $2', [guild_id, user_id]);
        const g = client.guilds.cache.get(guild_id);
        if (g && /^\d{15,25}$/.test(user_id || '')) await ticketsCommand.revokeArtistRole(g, user_id);
        res.redirect('/dashboard?tab=tickets&status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

// Same http(s)-only check used on the Discord side (commands/tickets.js
// isValidUrl) — kept as a small local copy rather than exported, since it's
// a one-liner and this is the only route on this side that needs it.
function isValidUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

app.post('/api/artists/panel', checkAuth, async (req, res) => {
    const {
        guild_id, user_id, tos_text, wontdo_text, askme_text, banner_url,
        link_portfolio, link_twitter, link_instagram, link_other, link_other_label
    } = req.body;
    if (guild_id !== req.session.selectedGuildId) return res.status(403).send('Invalid Guild.');

    const pricingCategories = ['Headshot', 'Bust', 'Full Body', 'Colored', 'Flat / Lineart'];

    // Any URL field left blank clears that field (NULLIF below); any URL
    // field that's non-blank must actually look like a URL, or the whole
    // save is rejected rather than silently storing something that'll
    // break the Discord embed/button later.
    const urlFields = { banner_url, link_portfolio, link_twitter, link_instagram, link_other };
    for (const [field, value] of Object.entries(urlFields)) {
        if (value && !isValidUrl(value)) {
            return res.status(400).send(`"${field}" doesn't look like a valid URL — it needs to start with http:// or https://.`);
        }
    }

    try {
        await db.query(
            `UPDATE artists SET
                tos_text = NULLIF($1, ''), wontdo_text = NULLIF($2, ''), askme_text = NULLIF($3, ''),
                banner_url = NULLIF($4, ''), link_portfolio = NULLIF($5, ''), link_twitter = NULLIF($6, ''),
                link_instagram = NULLIF($7, ''), link_other = NULLIF($8, ''),
                link_other_label = NULLIF($9, '')
             WHERE guild_id = $10 AND user_id = $11`,
            [
                tos_text, wontdo_text, askme_text, banner_url,
                link_portfolio, link_twitter, link_instagram, link_other,
                link_other ? (link_other_label || 'More') : '',
                guild_id, user_id
            ]
        );

        for (let i = 0; i < pricingCategories.length; i++) {
            const category = pricingCategories[i];
            const price = req.body[`price_${i}`];
            if (!price) continue;
            await db.query(
                `INSERT INTO artist_pricing (guild_id, user_id, category, price, sort_order) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (guild_id, user_id, category) DO UPDATE SET price = EXCLUDED.price`,
                [guild_id, user_id, category, price, i]
            );
        }

        res.redirect('/dashboard?tab=tickets&status=success');
    } catch (err) { res.status(500).send("DB Error."); }
});

app.listen(PORT, () => console.log(`🌐 Dashboard on ${PORT}`));

// --- BOT ---

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});
alerts.install(client, db.pool);

// --- SLASH COMMAND SYNC ---
// Commands are registered per server. A server where that fails (usually an
// old invite without the "applications.commands" permission: Discord answers
// "Missing Access") is remembered and retried every few minutes, so
// re-inviting Astra is enough, no restart needed. Opening that server's
// dashboard also retries right away, and joining a new server syncs it at once.
const COMMAND_RETRY_MS = 5 * 60 * 1000;
const commandSyncFailed = new Map(); // guildId -> { error, at }
let commandRest = null;

function allCommandsJSON() {
    return [
        configCommand.data.toJSON(),
        helpCommand.data.toJSON(),
        helpCommand.aboutData.toJSON(),
        helpCommand.quickstartData.toJSON(),
        ticketsCommand.artistData.toJSON(),
        ticketsCommand.panelData.toJSON(),
        ticketsCommand.ticketsOverviewData.toJSON(),
        ticketsCommand.artistsDirectoryData.toJSON(),
        levelingCommand.data.toJSON(),
        levelingCommand.leaderboardData.toJSON(),
        economyCommand.data.toJSON(),
        economyCommand.dailyData.toJSON(),
        economyCommand.payData.toJSON(),
        economyCommand.richestData.toJSON(),
        shopCommand.shopData.toJSON(),
        shopCommand.buyData.toJSON(),
        shopCommand.gambleData.toJSON(),
        shopCommand.shopConfigData.toJSON(),
        updatesCommand.updatesData.toJSON(),
        updatesCommand.announceData.toJSON(),
        moderationCommand.banData.toJSON(),
        moderationCommand.kickData.toJSON(),
        moderationCommand.timeoutData.toJSON(),
        moderationCommand.warnData.toJSON(),
        moderationCommand.clearData.toJSON(),
        moderationCommand.modData.toJSON(),
        mydataCommand.data.toJSON()
    ];
}

async function syncGuildCommands(guildId, { quiet = false } = {}) {
    commandRest ||= new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const guild = client.guilds.cache.get(guildId);
    try {
        const result = await commandRest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
            { body: allCommandsJSON() }
        );
        if (commandSyncFailed.has(guildId)) console.log(`✅ Commands are now in ${guild?.name || guildId} (retry worked).`);
        else if (!quiet) console.log(`✅ Synced to guild ${guild?.name || guildId} (${guildId}):`, result.map(c => c.name));
        commandSyncFailed.delete(guildId);
        return true;
    } catch (err) {
        if (!commandSyncFailed.has(guildId) || !quiet) {
            console.error(`❌ Failed to sync commands to guild ${guildId}:`, err.message,
                err.code === 50001 ? '(re-invite Astra to that server from the dashboard; she will retry on her own)' : '');
        }
        commandSyncFailed.set(guildId, { error: err.message, code: err.code, at: Date.now() });
        return false;
    }
}

setInterval(async () => {
    for (const guildId of [...commandSyncFailed.keys()]) {
        if (!client.guilds.cache.has(guildId)) { commandSyncFailed.delete(guildId); continue; } // she left
        await syncGuildCommands(guildId, { quiet: true });
    }
}, COMMAND_RETRY_MS).unref();

client.once('clientReady', async () => {
    retention.start(client);
    backup.start(client);
    ownerCommand.sweepBlocked(client);
    try {
        commandRest ||= new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        // Global registration holds only /invite (works in servers and in DMs).
        // This also removes the old /owner command from Discord everywhere.
        await commandRest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [inviteCommand.data.toJSON()] });
        console.log('🔗 /invite registered globally; /owner is gone from Discord (owner commands now work by DM text).');

        for (const guildId of client.guilds.cache.keys()) await syncGuildCommands(guildId);
        console.log(`🔄 Command sync pass complete${commandSyncFailed.size ? ` (${commandSyncFailed.size} server(s) failed, retrying every ${COMMAND_RETRY_MS / 60000} min)` : ''}.`);
    } catch (error) {
        console.error('❌ Error synchronizing commands:', error);
    }

    console.log(`🚀 Astra online.`);

    // NEW: post any changelog versions that opted-in servers haven't seen yet
    // (commands/updates.js). Runs after the command sync, never blocks startup.
    const changelogPass = updatesCommand.postPendingToAll(client).catch((e) => { console.error('❌ Changelog pass error:', e); return null; });

    // One startup message to the alerts channel with the version and a quick health
    // summary, so a restart is a useful report and not just "I'm online".
    changelogPass.then((pass) => sendStartupReport(pass)).catch((e) => console.error('⚠️ Startup report failed:', e.message));
});

async function sendStartupReport(pass) {
    let dbLine = '✅ Database: OK';
    let problems = 0;
    try { const t0 = Date.now(); await db.query('SELECT 1'); dbLine = `✅ Database: OK (${Date.now() - t0} ms)`; }
    catch (e) { dbLine = '❌ Database: not answering'; problems++; }
    const current = updatesCommand.currentEntry();
    const guilds = [...client.guilds.cache.values()];
    const members = guilds.reduce((n, g) => n + (g.memberCount || 0), 0);
    const failedSync = commandSyncFailed.size;
    if (failedSync) problems++;
    if (pass && pass.failed) problems++;
    const lines = [
        `**Version:** ${current ? `${current.version} — ${current.title}` : 'unknown'}`,
        `**Servers:** ${guilds.length} (${members} members)`,
        dbLine,
        failedSync ? `⚠️ Commands: ${failedSync} server(s) still waiting, retrying on their own` : '✅ Commands: synced in every server',
        pass && pass.guilds
            ? `${pass.failed ? '⚠️' : '✅'} Changelog: ${pass.posted} post(s) sent, ${pass.failed} failed, ${pass.guilds} server(s) checked`
            : '✅ Changelog: nothing to post',
        `**Booted in:** ${Math.round(process.uptime())} s · Node ${process.version} · ${Math.round(process.memoryUsage().rss / 1048576)} MB`,
    ];
    await alerts.notify(`Astra online${current ? ` · ${current.version}` : ''}`, lines.join('\n'), { level: problems ? 'warn' : 'info', key: 'started', cooldownMs: 60 * 1000 });
}

// NEW: cleans up the tickets table the moment a ticket channel is deleted
// directly (dragged to trash, cleaned up by hand) instead of via the Close
// Ticket button — without this, that user would appear to have a
// permanently "open" ticket and get blocked from opening a new one.
// First-time introduction: when Astra is added to a server she says hello once,
// in both languages (nobody has picked one yet), and points at the first steps.
// Goes to the system channel, else the first text channel she can write in,
// else the server owner's DMs. astra_welcomed stops it from repeating.
client.on('guildDelete', async (guild) => {
    if (guild.available === false) return; // a Discord outage, not a real removal
    try { await retention.markLeft(guild.id); }
    catch (err) { console.error('❌ Could not mark server as left:', err.message); }
});

client.on('guildCreate', async (guild) => {
    if (await ownerCommand.enforceBlock(guild)) return; // blocked server: she leaves at once
    await retention.markJoined(guild.id).catch(() => {});
    // Commands right away for a new server (before, they only came after a restart).
    await syncGuildCommands(guild.id);
    try {
        const { rows } = await db.query('SELECT astra_welcomed FROM guild_settings WHERE guild_id = $1', [guild.id]);
        if (rows[0]?.astra_welcomed) return;

        const { ChannelType, EmbedBuilder } = require('discord.js');
        const me = guild.members.me || await guild.members.fetchMe();
        const canWrite = (c) => c && c.type === ChannelType.GuildText &&
            c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks']);

        let site = '';
        try { site = new URL(process.env.REDIRECT_URI).origin; } catch (e) { /* no site link */ }

        const missing = ['ManageRoles', 'ManageChannels', 'ManageMessages'].filter(p => !me.permissions.has(p));
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: '🛡️ Astra', iconURL: guild.client.user.displayAvatarURL() })
            .setDescription(t('en', 'joinintro.body', { site_line: site ? t('en', 'joinintro.site_line', { site }) : '' }) + '\n\n' + t('pt-br', 'joinintro.body', { site_line: site ? t('pt-br', 'joinintro.site_line', { site }) : '' }))
            .setFooter({ text: t('en', 'joinintro.footer') + ' · ' + t('pt-br', 'joinintro.footer') });
        if (missing.length) {
            embed.addFields({ name: '⚠️', value: t('en', 'joinintro.perms', { perms: missing.join(', ') }) + '\n' + t('pt-br', 'joinintro.perms', { perms: missing.join(', ') }) });
        }

        let channel = guild.systemChannel;
        if (!canWrite(channel)) {
            channel = guild.channels.cache
                .filter(canWrite)
                .sort((a, b) => a.rawPosition - b.rawPosition)
                .first();
        }

        let sent = false;
        if (channel) {
            sent = !!(await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null));
        }
        if (!sent) {
            const owner = await guild.fetchOwner().catch(() => null);
            sent = !!(owner && await owner.send({ embeds: [embed] }).catch(() => null));
        }

        if (sent) {
            await db.query(
                `INSERT INTO guild_settings (guild_id, astra_welcomed) VALUES ($1, TRUE)
                 ON CONFLICT (guild_id) DO UPDATE SET astra_welcomed = TRUE`,
                [guild.id]
            );
        }
    } catch (err) {
        console.error('❌ Error in guildCreate intro:', err);
    }
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    try {
        await db.query('DELETE FROM tickets WHERE channel_id = $1', [channel.id]);
    } catch (err) {
        console.error('❌ Error cleaning up ticket row on channel delete:', err);
    }
});

// NEW: nudges brand-new members toward the rules/verify channel right away.
// This is the "instantly popped as a suggestion" behavior — since a bot
// can't force-open a channel on someone's client, a short-lived welcome
// message pointing them at it (posted in that channel, so it also shows up
// as unread for them) is the practical equivalent.
client.on('guildMemberAdd', async (member) => {
    const kicked = await configCommand.checkScamSignals(member);
    if (!kicked) {
        await configCommand.handleNewMember(member);
        // NEW: public welcome message (separate feature from the nudge
        // above and from the admin-only log below) — see /config welcome.
        await configCommand.sendWelcomeMessage(member);
    }
    // Dividers set to "every member" go on right at join (see rolekit.js).
    await rolekit.syncMember(member);
    await logMemberEvent(member.guild, 'join', member);
});

// Keep divider roles in step with the roles people hold (cosmetic, see rolekit.js).
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        if (oldMember?.roles && oldMember.roles.cache.size === newMember.roles.cache.size
            && [...newMember.roles.cache.keys()].every((id) => oldMember.roles.cache.has(id))) return; // no role change
        await rolekit.syncMember(newMember);
    } catch (e) { console.error('❌ divider sync failed:', e.message); }
});

client.on('guildMemberRemove', async (member) => {
    // NEW: public leave message — see /config leave.
    await configCommand.sendLeaveMessage(member);
    await logMemberEvent(member.guild, 'leave', member);
});

// NEW: join/leave logging, toggleable via /config verification
// joinleave_logs, shared with the same log_channel_id used everywhere else.
async function logMemberEvent(guild, type, member) {
    try {
        const { rows } = await db.query('SELECT log_channel_id, joinleave_log_enabled FROM guild_settings WHERE guild_id = $1', [guild.id]);
        const settings = rows[0];
        if (!settings || !settings.log_channel_id || settings.joinleave_log_enabled === false) return;

        const logChannel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
        if (!logChannel) return;

        const memberCount = guild.memberCount;
        if (type === 'join') {
            const accountAgeDays = Math.round((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
            await logChannel.send(`📥 **${member.user.tag}** joined (account age: ${accountAgeDays}d) — now **${memberCount}** members.`).catch(() => {});
        } else {
            await logChannel.send(`📤 **${member.user.tag}** left — now **${memberCount}** members.`).catch(() => {});
        }
    } catch (err) {
        console.error('❌ Error logging member event:', err);
    }
}

// NEW: Chat B moderation — deletes anything that isn't "!verify" in the
// configured verify channel (dual-role mode only) and warns the sender.
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild && /^!?owner\s/i.test(message.content || '')) {
        // "owner leave here" / "owner block here": only the owner is listened to, nobody else notices anything.
        try { if (await ownerCommand.handleGuildMessage(message)) return; } catch (e) { console.error('❌ owner shortcut error:', e.message); }
    }
    if (!message.guild) {
        // Direct message: owner commands for the owner, a short "add me" note for anyone else.
        try { await ownerCommand.handleDm(message, { strangerReply: inviteCommand.strangerText(botLinks()) }); }
        catch (e) { console.error('❌ DM handler error:', e.message); }
        return;
    }
    await configCommand.executeMessage(message);
    // NEW: XP/leveling — see commands/leveling.js. Independent of the
    // verify-channel moderation above; runs on every eligible message.
    await levelingCommand.handleMessageXp(message);
    // NEW: random coin events while people chat (off by default), see
    // commands/shop.js. Never blocks or replaces anything below.
    await shopCommand.handleMessageEvent(message);
    // NEW: experimental smart replies (local intent classifier, off by
    // default) — see commands/ai.js. If it handled the message, the canned
    // fun.js reply below must NOT also fire; if it's off or unsure, fun.js
    // answers like before.
    // NEW: rule-based banter ("guess what", "knock knock", jokes, coin, dice,
    // fortunes), see commands/banter.js. No AI; narrow patterns that need her
    // name, so real questions still reach the smart replies below.
    if (await banterCommand.handleMessage(message)) return;
    const aiHandled = await aiCommand.handleMessage(message);
    if (!aiHandled) {
        // silly mention/name reply — see commands/fun.js. No AI involved.
        await funCommand.handleMentionReply(message);
    }
});

// NEW: auto-kick sweep for members who never finished verification.
// Runs once shortly after startup, then every hour. Bot needs the
// "Kick Members" permission, and the GuildMembers privileged intent must be
// enabled for this application in the Discord Developer Portal (it already
// is, since GatewayIntentBits.GuildMembers is set above) — just flagging it
// in case this bot is ever moved to a fresh application.
setTimeout(() => configCommand.runAutoKickSweep(client), 60_000);
setInterval(() => configCommand.runAutoKickSweep(client), 60 * 60 * 1000);

client.on('interactionCreate', async (interaction) => {
    // /invite works everywhere; it is the only slash command outside a server.
    if (interaction.isChatInputCommand() && interaction.commandName === 'invite') {
        try { await inviteCommand.execute(interaction, botLinks()); }
        catch (e) { console.error('❌ /invite error:', e.message); }
        return;
    }
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
        // Everyday commands need the Verified role once verification is set up.
        if (rolekit.MEMBER_COMMANDS.has(interaction.commandName)) {
            try {
                const gs = (await db.query('SELECT language, verify_channel_id, member_role_id FROM guild_settings WHERE guild_id = $1', [interaction.guild.id])).rows[0];
                if (!(await rolekit.memberMayUseCommands(interaction.member, gs))) {
                    return interaction.reply({
                        content: t(gs?.language, 'member.need_verified', { role: `<@&${gs.member_role_id}>` }),
                        ephemeral: true, allowedMentions: { parse: [] },
                    });
                }
            } catch (e) { console.error('❌ member role check failed:', e.message); }
        }
        if (interaction.commandName === 'config') {
            await configCommand.executeSlash(interaction);
        } else if (interaction.commandName === 'help') {
            await helpCommand.executeSlash(interaction);
        } else if (interaction.commandName === 'about') {
            await helpCommand.executeSlashAbout(interaction);
        } else if (interaction.commandName === 'quickstart') {
            await helpCommand.executeSlashQuickstart(interaction);
        } else if (interaction.commandName === 'artist') {
            await ticketsCommand.executeSlashArtist(interaction);
        } else if (interaction.commandName === 'panel') {
            await ticketsCommand.executeSlashPanel(interaction);
        } else if (interaction.commandName === 'tickets') {
            await ticketsCommand.executeSlashTicketsOverview(interaction);
        } else if (interaction.commandName === 'artists') {
            await ticketsCommand.executeSlashArtistsDirectory(interaction);
        } else if (interaction.commandName === 'rank') {
            await levelingCommand.executeSlashRank(interaction);
        } else if (interaction.commandName === 'leaderboard') {
            await levelingCommand.executeSlashLeaderboard(interaction);
        } else if (interaction.commandName === 'balance') {
            await economyCommand.executeSlashBalance(interaction);
        } else if (interaction.commandName === 'daily') {
            await economyCommand.executeSlashDaily(interaction);
        } else if (interaction.commandName === 'pay') {
            await economyCommand.executeSlashPay(interaction);
        } else if (interaction.commandName === 'richest') {
            await economyCommand.executeSlashRichest(interaction);
        } else if (interaction.commandName === 'shop') {
            await shopCommand.executeSlashShop(interaction);
        } else if (interaction.commandName === 'buy') {
            await shopCommand.executeSlashBuy(interaction);
        } else if (interaction.commandName === 'gamble') {
            await shopCommand.executeSlashGamble(interaction);
        } else if (interaction.commandName === 'shopconfig') {
            await shopCommand.executeSlashShopConfig(interaction);
        } else if (interaction.commandName === 'updates') {
            await updatesCommand.executeSlashUpdates(interaction);
        } else if (interaction.commandName === 'announce') {
            await updatesCommand.executeSlashAnnounce(interaction);
        } else if (interaction.commandName === 'ban') {
            await moderationCommand.executeBan(interaction);
        } else if (interaction.commandName === 'kick') {
            await moderationCommand.executeKick(interaction);
        } else if (interaction.commandName === 'timeout') {
            await moderationCommand.executeTimeout(interaction);
        } else if (interaction.commandName === 'warn') {
            await moderationCommand.executeWarn(interaction);
        } else if (interaction.commandName === 'clear') {
            await moderationCommand.executeClear(interaction);
        } else if (interaction.commandName === 'mod') {
            await moderationCommand.executeMod(interaction);
        } else if (interaction.commandName === 'mydata') {
            await mydataCommand.execute(interaction);
        }
    } else if (interaction.isAutocomplete()) {
        await shopCommand.handleAutocomplete(interaction);
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('astra_mydata_')) {
            await mydataCommand.handleButton(interaction);
        } else if (interaction.customId.startsWith('astra_event_')) {
            await shopCommand.handleEventButton(interaction);
        } else if (interaction.customId.startsWith('astra_ticket_') || interaction.customId.startsWith('astra_panel_')) {
            await ticketsCommand.handleButton(interaction);
        } else if (interaction.customId.startsWith('astra_about_')) {
            await helpCommand.handleAboutButton(interaction);
        } else {
            await configCommand.handleButton(interaction);
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'astra_help_menu') {
            await helpCommand.handleHelpMenu(interaction);
        } else if (interaction.customId === 'astra_ticket_artist_select') {
            await ticketsCommand.handleSelectMenu(interaction);
        } else if (interaction.customId === 'astra_artist_directory') {
            await ticketsCommand.handleArtistDirectorySelect(interaction);
        } else {
            await configCommand.handleMenu(interaction);
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('astra_panel_modal_')) {
            await ticketsCommand.handleModalSubmit(interaction);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);