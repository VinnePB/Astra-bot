// --- ROLE HIERARCHY KIT ---
// Owner > Astra Admin / Moderator > Verified member. This file:
//   * creates the "Astra Admin", "Moderator" and "Verified" roles when they are missing,
//   * lets Verified members use Astra's everyday commands (Discord's own
//     "Use Application Commands" permission on that role, plus a check inside
//     Astra),
//   * creates and places cosmetic divider roles (━━━━ LEVELS ━━━━ ...) and
//     hands them out together with the roles they head.
// Nothing here ever gives a role real moderation power: created roles carry no
// permissions except "Use Application Commands" on Verified and the four
// moderation permissions on Moderator (never role or server management).

const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const { isAstraAdmin } = require('./permissions');

const ADMIN_ROLE_NAME = 'Astra Admin';
const MEMBER_ROLE_NAME = 'Verified';
const MOD_ROLE_NAME = 'Moderator';
// Only what Astra's moderation commands check. No role management, no server management.
const MOD_PERMS = ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'];

const DIVIDERS = {
    staff:   { col: 'divider_staff_role_id',   label: 'STAFF' },
    access:  { col: 'divider_access_role_id',  label: 'ACCESS' },
    levels:  { col: 'divider_levels_role_id',  label: 'LEVELS' },
    special: { col: 'divider_special_role_id', label: 'SPECIAL' },
};

// Two looks for a divider role's name:
//   line: ━━━━ LABEL ━━━━            bar: invisible padding around the label, which
//   makes the role chip stretch into a wide bar on profiles. The label is whatever
//   the role is currently called (rename it in Discord and Astra keeps your word).
const FILL = '\u3164'; // Hangul filler: shows as blank, and Discord does not trim it
const DEFAULT_PAD = 14;
function labelOf(name, fallback) {
    const l = String(name || '').replace(/^[━─\u3164\u2800\s]+|[━─\u3164\u2800\s]+$/g, '');
    return l || fallback;
}
function styled(label, style, pad) {
    const p = Math.max(0, Math.min(30, Number.isFinite(+pad) ? Math.trunc(+pad) : DEFAULT_PAD));
    if (style === 'bar') {
        let n = p;
        while (n > 0 && n * 2 + label.length > 100) n--;
        return `${FILL.repeat(n)}${label}${FILL.repeat(n)}`;
    }
    return `━━━━ ${label} ━━━━`.slice(0, 100);
}
const dividerName = (kind, settings) => styled(DIVIDERS[kind].label, settings?.divider_style, settings?.divider_pad ?? DEFAULT_PAD);

// Everyday commands that need the Verified role once verification is set up.
// /help, /about and /mydata stay open to everybody on purpose.
const MEMBER_COMMANDS = new Set([
    'rank', 'leaderboard', 'balance', 'daily', 'pay', 'richest', 'shop', 'buy', 'gamble', 'tickets', 'artists',
]);

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

// True when `member` may use everyday commands. Gating only applies once the
// server has a verification channel AND a Verified role; before that nobody
// could ever earn the role, so everyone is let through.
async function memberMayUseCommands(member, settings) {
    if (!member || !member.guild) return false;
    const s = settings || await getSettings(member.guild.id);
    if (!s || !s.verify_channel_id || !s.member_role_id) return true;
    if (!member.guild.roles.cache.has(s.member_role_id)) return true; // role was deleted: don't lock everyone out
    if (member.roles.cache.has(s.member_role_id)) return true;
    return isAstraAdmin(member);
}

function botHighest(guild) {
    return guild.members.me?.roles.highest?.position ?? 0;
}

// Reuses a role with this exact name (below Astra's own role), else creates it.
async function findOrCreate(guild, name, data, reason) {
    const top = botHighest(guild);
    const found = guild.roles.cache.find((r) => r.name === name && !r.managed && r.id !== guild.id && r.position < top);
    if (found) return { role: found, created: false };
    const role = await guild.roles.create({ name, reason, ...data });
    return { role, created: true };
}

async function enableCommandAccess(role) {
    if (role.permissions.has(PermissionFlagsBits.UseApplicationCommands)) return true;
    if (!role.editable) return false;
    await role.setPermissions(role.permissions.add(PermissionFlagsBits.UseApplicationCommands), 'Astra: let verified members use her commands');
    return true;
}

// Puts `divider` directly above the highest role in `group` (never above Astra).
async function placeAbove(guild, divider, group) {
    const positions = group.map((r) => r.position);
    if (!positions.length) return false;
    const target = Math.min(Math.max(...positions) + 1, botHighest(guild) - 1);
    if (target < 1 || !divider.editable) return false;
    if (divider.position !== target) await divider.setPosition(target, { reason: 'Astra: arrange divider roles' });
    return true;
}

async function groupRoles(guild, sql, params) {
    const { rows } = await db.query(sql, params);
    return rows.map((r) => guild.roles.cache.get(r.role_id)).filter(Boolean);
}

async function setCol(guildId, col, value) {
    // col comes from our own constants only, never from user input.
    await db.query(
        `INSERT INTO guild_settings (guild_id, ${col}) VALUES ($1, $2)
         ON CONFLICT (guild_id) DO UPDATE SET ${col} = $2`,
        [guildId, value]
    );
}

// Returns { ok, lines: [{k, name?}] } where k is a dashboard.roles.* locale key.
async function setupHierarchy(guild, { dividers = false } = {}) {
    const lines = [];
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return { ok: false, lines: [{ k: 'r_noperm' }] };
    await guild.roles.fetch();
    const settings = (await getSettings(guild.id)) || {};
    const note = (k, role) => lines.push({ k, name: role ? role.name : undefined });

    // 1) Verified (the role verification hands out at the end)
    try {
        let role = settings.member_role_id && guild.roles.cache.get(settings.member_role_id);
        if (role) note('r_reused', role);
        else {
            const made = await findOrCreate(guild, MEMBER_ROLE_NAME, { permissions: [PermissionFlagsBits.UseApplicationCommands], mentionable: false }, 'Astra: Verified role');
            role = made.role;
            await setCol(guild.id, 'member_role_id', role.id);
            note(made.created ? 'r_created' : 'r_reused', role);
        }
        if (await enableCommandAccess(role)) note('r_cmdaccess', role);
        else note('r_cmd_fail', role);
    } catch (e) { console.error('❌ rolekit verified:', e.message); lines.push({ k: 'r_error', name: MEMBER_ROLE_NAME }); }

    // 2) Astra Admin (no Discord permissions: it only unlocks Astra's own setup commands)
    try {
        const made = await findOrCreate(guild, ADMIN_ROLE_NAME, { permissions: [], mentionable: false }, 'Astra: Astra Admin role');
        await db.query('INSERT INTO guild_admin_roles (guild_id, role_id) VALUES ($1, $2) ON CONFLICT (guild_id, role_id) DO NOTHING', [guild.id, made.role.id]);
        note(made.created ? 'r_created' : 'r_reused', made.role);
    } catch (e) { console.error('❌ rolekit admin:', e.message); lines.push({ k: 'r_error', name: ADMIN_ROLE_NAME }); }

    // 3) Moderator: the four permissions Astra's moderation commands need, nothing else
    try {
        const made = await findOrCreate(guild, MOD_ROLE_NAME, { permissions: MOD_PERMS.map((p) => PermissionFlagsBits[p]), mentionable: false }, 'Astra: Moderator role');
        note(made.created ? 'r_created' : 'r_reused', made.role);
    } catch (e) { console.error('❌ rolekit moderator:', e.message); lines.push({ k: 'r_error', name: MOD_ROLE_NAME }); }

    // 4) cosmetic dividers
    if (dividers) {
        for (const [kind, d] of Object.entries(DIVIDERS)) {
            try {
                const fresh = (await getSettings(guild.id)) || {};
                let role = fresh[d.col] && guild.roles.cache.get(fresh[d.col]);
                let created = false;
                if (!role) {
                    const made = await findOrCreate(guild, dividerName(kind, fresh), { permissions: [], hoist: false, mentionable: false }, 'Astra: divider role');
                    role = made.role; created = made.created;
                    await setCol(guild.id, d.col, role.id);
                }
                note(created ? 'r_created' : 'r_reused', role);
            } catch (e) { console.error('❌ rolekit divider:', e.message); lines.push({ k: 'r_error', name: d.label }); }
        }
        for (const name of await arrangeDividers(guild)) lines.push({ k: 'r_place_fail', name });
    }
    if (dividers) {
        lines.push({ k: 'r_backfill' });
        startBackfill(guild); // runs in the background
    }
    return { ok: true, lines };
}

// Hands the matching divider to a member right after they receive a role from
// the group it heads. Never throws.
async function giveDivider(member, kind) {
    try {
        const d = DIVIDERS[kind];
        if (!d) return;
        const s = await getSettings(member.guild.id);
        const id = s && s[d.col];
        if (!id || member.roles.cache.has(id)) return;
        const role = member.guild.roles.cache.get(id);
        if (role && role.editable) await member.roles.add(role, 'Astra: divider role');
    } catch (_) { /* cosmetic only */ }
}

// ---- divider groups ------------------------------------------------------------
// Each divider heads a group of roles. A group is made of roles Astra already
// knows about plus the ones an admin ticks in the dashboard:
//   STAFF   <- Astra admin roles          + chosen roles
//   ACCESS  <- rules / verify / Verified  + chosen roles
//   LEVELS  <- level-reward roles         + chosen roles
//   SPECIAL <- shop roles                 + chosen roles
async function loadGroups(guildId) {
    const settings = (await getSettings(guildId)) || {};
    const ids = async (sql) => (await db.query(sql, [guildId]).catch(() => ({ rows: [] }))).rows.map((r) => r.role_id);
    const groups = {
        staff: new Set(await ids('SELECT role_id FROM guild_admin_roles WHERE guild_id = $1')),
        access: new Set([settings.member_role_id, settings.rules_role_id, settings.verify_role_id].filter(Boolean)),
        levels: new Set(await ids('SELECT role_id FROM guild_level_roles WHERE guild_id = $1')),
        special: new Set(await ids('SELECT role_id FROM shop_items WHERE guild_id = $1')),
    };
    const explicit = {};
    const { rows } = await db.query('SELECT kind, role_id FROM guild_divider_roles WHERE guild_id = $1', [guildId]).catch(() => ({ rows: [] }));
    for (const r of rows) {
        if (!groups[r.kind]) continue;
        (explicit[r.kind] ||= new Set()).add(r.role_id);
        groups[r.kind].add(r.role_id);
    }
    const dividerIds = new Set(Object.values(DIVIDERS).map((d) => settings[d.col]).filter(Boolean));
    for (const g of Object.values(groups)) for (const id of dividerIds) g.delete(id); // a divider never heads a divider
    const everyone = new Set(String(settings.divider_everyone || '').split(',').filter((k) => DIVIDERS[k]));
    return { settings, groups, explicit, dividerIds, everyone };
}
const loadSyncContext = loadGroups;

async function syncMember(member, ctx) {
    try {
        if (!member || member.user?.bot) return;
        const c = ctx || await loadGroups(member.guild.id);
        const has = (id) => member.roles.cache.has(id);
        for (const [kind, d] of Object.entries(DIVIDERS)) {
            const id = c.settings[d.col];
            if (!id) continue;
            const role = member.guild.roles.cache.get(id);
            if (!role || !role.editable) continue;
            const wanted = c.everyone.has(kind) || [...c.groups[kind]].some(has);
            if (wanted && !has(id)) await member.roles.add(role, 'Astra: divider role');
            else if (!wanted && has(id)) await member.roles.remove(role, 'Astra: divider role');
        }
    } catch (_) { /* cosmetic only */ }
}

// Puts every divider directly above the highest role of its group. Returns the
// names of dividers that could not be moved (Astra's own role is too low).
async function arrangeDividers(guild, ctx) {
    const c = ctx || await loadGroups(guild.id);
    const failed = [];
    for (const [kind, d] of Object.entries(DIVIDERS)) {
        const id = c.settings[d.col];
        const role = id && guild.roles.cache.get(id);
        if (!role) continue;
        const group = [...c.groups[kind]].map((rid) => guild.roles.cache.get(rid)).filter(Boolean);
        if (!group.length) continue;
        try { if (!(await placeAbove(guild, role, group))) failed.push(role.name); }
        catch (_) { failed.push(role.name); }
    }
    return failed;
}

// Replaces the admin-chosen roles of each group. selections: { kind: [roleId, ...] }
async function saveGroups(guild, selections) {
    const valid = (id) => /^\d{5,25}$/.test(String(id)) && id !== guild.id && guild.roles.cache.has(id) && !guild.roles.cache.get(id).managed;
    const settings = (await getSettings(guild.id)) || {};
    const dividerIds = new Set(Object.values(DIVIDERS).map((d) => settings[d.col]).filter(Boolean));
    const conn = await db.pool.connect();
    try {
        await conn.query('BEGIN');
        await conn.query('DELETE FROM guild_divider_roles WHERE guild_id = $1', [guild.id]);
        for (const kind of Object.keys(DIVIDERS)) {
            const picked = [...new Set([].concat(selections[kind] || []).map(String))].filter((id) => valid(id) && !dividerIds.has(id)).slice(0, 60);
            for (const id of picked) {
                await conn.query('INSERT INTO guild_divider_roles (guild_id, kind, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [guild.id, kind, id]);
            }
        }
        await conn.query('COMMIT');
    } catch (e) { await conn.query('ROLLBACK').catch(() => {}); throw e; } finally { conn.release(); }
}

// Saves the look and the "give to every member" choices.
async function saveOptions(guildId, { style, pad, everyone }) {
    const st = style === 'bar' ? 'bar' : 'line';
    const p = Math.max(0, Math.min(30, Number.isFinite(+pad) ? Math.trunc(+pad) : DEFAULT_PAD));
    const kinds = [...new Set([].concat(everyone || []))].filter((k) => DIVIDERS[k]).join(',');
    await db.query(
        `INSERT INTO guild_settings (guild_id, divider_style, divider_pad, divider_everyone) VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id) DO UPDATE SET divider_style = $2, divider_pad = $3, divider_everyone = $4`,
        [guildId, st, p, kinds || null]
    );
}

// Renames the divider roles to the chosen look, keeping each one's own label.
async function restyleDividers(guild) {
    const settings = (await getSettings(guild.id)) || {};
    for (const [kind, d] of Object.entries(DIVIDERS)) {
        const role = settings[d.col] && guild.roles.cache.get(settings[d.col]);
        if (!role || !role.editable) continue;
        const target = styled(labelOf(role.name, d.label), settings.divider_style, settings.divider_pad ?? DEFAULT_PAD);
        if (role.name !== target) await role.setName(target, 'Astra: divider style').catch(() => {});
    }
}

// Only one member sweep per server at a time.
const sweeping = new Map();
function startBackfill(guild) {
    if (sweeping.get(guild.id)) return false;
    sweeping.set(guild.id, true);
    backfillDividers(guild).catch(() => {}).finally(() => sweeping.delete(guild.id));
    return true;
}

// "Check everyone now" from the dashboard: restyle, re-place, then re-sync every
// member in the background. Limited to once per cooldown per server.
const lastResync = new Map();
async function resync(guild, { cooldownMs = 5 * 60 * 1000 } = {}) {
    if (sweeping.get(guild.id)) return { ok: false, reason: 'busy' };
    if (Date.now() - (lastResync.get(guild.id) || 0) < cooldownMs) return { ok: false, reason: 'cooldown' };
    lastResync.set(guild.id, Date.now());
    await restyleDividers(guild);
    const failed = await arrangeDividers(guild);
    startBackfill(guild);
    return { ok: true, failed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Everyone already in the server, gently (well under Discord's rate limits).
async function backfillDividers(guild) {
    try {
        const ctx = await loadGroups(guild.id);
        if (!Object.values(DIVIDERS).some((d) => ctx.settings[d.col])) return 0;
        const members = await guild.members.fetch();
        let n = 0;
        for (const [, m] of members) {
            if (m.user?.bot) continue;
            await syncMember(m, ctx);
            n++;
            await sleep(350);
        }
        return n;
    } catch (e) { console.error('❌ divider backfill failed:', e.message); return 0; }
}

module.exports = { syncMember, backfillDividers, startBackfill, resync, restyleDividers, saveOptions, labelOf, styled, loadGroups, loadSyncContext, arrangeDividers, saveGroups, setupHierarchy, giveDivider, memberMayUseCommands, MEMBER_COMMANDS, DIVIDERS, ADMIN_ROLE_NAME, MEMBER_ROLE_NAME, MOD_ROLE_NAME, MOD_PERMS, _test: { placeAbove } };