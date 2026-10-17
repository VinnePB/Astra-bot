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
    access:  { col: 'divider_access_role_id',  name: '━━━━ ACCESS ━━━━' },
    levels:  { col: 'divider_levels_role_id',  name: '━━━━ LEVELS ━━━━' },
    special: { col: 'divider_special_role_id', name: '━━━━ SPECIAL ━━━━' },
};

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
        const fresh = (await getSettings(guild.id)) || {};
        const groups = {
            access: [fresh.member_role_id && guild.roles.cache.get(fresh.member_role_id)].filter(Boolean),
            levels: await groupRoles(guild, 'SELECT role_id FROM guild_level_roles WHERE guild_id = $1', [guild.id]),
            special: await groupRoles(guild, `SELECT role_id FROM shop_items WHERE guild_id = $1 AND role_id IS NOT NULL`, [guild.id]).catch(() => []),
        };
        for (const [kind, d] of Object.entries(DIVIDERS)) {
            try {
                let role = fresh[d.col] && guild.roles.cache.get(fresh[d.col]);
                let created = false;
                if (!role) {
                    const made = await findOrCreate(guild, d.name, { permissions: [], hoist: false, mentionable: false }, 'Astra: divider role');
                    role = made.role; created = made.created;
                    await setCol(guild.id, d.col, role.id);
                }
                note(created ? 'r_created' : 'r_reused', role);
                if (groups[kind].length) {
                    if (!(await placeAbove(guild, role, groups[kind]))) note('r_place_fail', role);
                }
            } catch (e) { console.error('❌ rolekit divider:', e.message); lines.push({ k: 'r_error', name: d.name }); }
        }
    }
    if (dividers) {
        lines.push({ k: 'r_backfill' });
        backfillDividers(guild).catch(() => {}); // runs in the background
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

// ---- keeping dividers in sync for everybody ---------------------------------
// A member should carry a divider exactly when they hold a role it heads:
//   ACCESS  <- the Verified role      LEVELS <- any level-reward role
//   SPECIAL <- any shop role
// This runs when someone's roles change and (once) for everyone right after the
// dividers are created. It only changes dividers, never other roles.
async function loadSyncContext(guildId) {
    const settings = (await getSettings(guildId)) || {};
    const levelIds = new Set((await db.query('SELECT role_id FROM guild_level_roles WHERE guild_id = $1', [guildId])).rows.map((r) => r.role_id));
    const shopIds = new Set((await db.query('SELECT role_id FROM shop_items WHERE guild_id = $1', [guildId]).catch(() => ({ rows: [] }))).rows.map((r) => r.role_id));
    return { settings, levelIds, shopIds };
}

async function syncMember(member, ctx) {
    try {
        if (!member || member.user?.bot) return;
        const c = ctx || await loadSyncContext(member.guild.id);
        const has = (id) => member.roles.cache.has(id);
        const wanted = {
            access: !!c.settings.member_role_id && has(c.settings.member_role_id),
            levels: [...c.levelIds].some(has),
            special: [...c.shopIds].some(has),
        };
        for (const [kind, d] of Object.entries(DIVIDERS)) {
            const id = c.settings[d.col];
            if (!id) continue;
            const role = member.guild.roles.cache.get(id);
            if (!role || !role.editable) continue;
            if (wanted[kind] && !has(id)) await member.roles.add(role, 'Astra: divider role');
            else if (!wanted[kind] && has(id)) await member.roles.remove(role, 'Astra: divider role');
        }
    } catch (_) { /* cosmetic only */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Everyone already in the server, gently (well under Discord's rate limits).
async function backfillDividers(guild) {
    try {
        const ctx = await loadSyncContext(guild.id);
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

module.exports = { syncMember, backfillDividers, loadSyncContext, setupHierarchy, giveDivider, memberMayUseCommands, MEMBER_COMMANDS, DIVIDERS, ADMIN_ROLE_NAME, MEMBER_ROLE_NAME, MOD_ROLE_NAME, MOD_PERMS, _test: { placeAbove } };