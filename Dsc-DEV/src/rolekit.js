// --- ROLE HIERARCHY KIT ---
// Owner > Astra Admin > Verified member. This file:
//   * creates the "Astra Admin" and "Verified" roles when they are missing,
//   * lets Verified members use Astra's everyday commands (Discord's own
//     "Use Application Commands" permission on that role, plus a check inside
//     Astra),
//   * creates and places cosmetic divider roles (━━━━ LEVELS ━━━━ ...) and
//     hands them out together with the roles they head.
// Nothing here ever gives a role real moderation power: created roles carry no
// permissions except "Use Application Commands" on Verified.

const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const { isAstraAdmin } = require('./permissions');

const ADMIN_ROLE_NAME = 'Astra Admin';
const MEMBER_ROLE_NAME = 'Verified';

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

    // 3) cosmetic dividers
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

module.exports = { setupHierarchy, giveDivider, memberMayUseCommands, MEMBER_COMMANDS, DIVIDERS, ADMIN_ROLE_NAME, MEMBER_ROLE_NAME, _test: { placeAbove } };