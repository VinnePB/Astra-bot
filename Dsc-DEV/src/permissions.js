// src/permissions.js
// Two tiers of access, on purpose:
//
// 1. isServerAdministrator — real Discord Administrator permission, or the
//    guild owner. This tier is the ONLY one allowed to manage the
//    guild_admin_roles list itself (who gets tier 2). This is the anti-abuse
//    boundary: a role granted tier 2 access can use Astra's config commands,
//    but can never grant itself or anyone else more access, because
//    "/config admins add/remove" checks tier 1, not tier 2.
//
// 2. isAstraAdmin — true Administrators/owner, OR anyone holding a role that's
//    been explicitly added to guild_admin_roles for that guild. This is the
//    tier that gates day-to-day config: /setup, /config verification.

const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');

async function isServerAdministrator(member) {
    if (!member || !member.guild) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.guild.ownerId === member.id;
}

async function isAstraAdmin(member) {
    if (!member || !member.guild) return false;
    if (await isServerAdministrator(member)) return true;

    const { rows } = await db.query(
        'SELECT role_id FROM guild_admin_roles WHERE guild_id = $1',
        [member.guild.id]
    );
    if (rows.length === 0) return false;

    const trustedRoleIds = new Set(rows.map(r => r.role_id));
    return member.roles.cache.some(role => trustedRoleIds.has(role.id));
}

module.exports = { isServerAdministrator, isAstraAdmin };