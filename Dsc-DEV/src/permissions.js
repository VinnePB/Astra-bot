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

    try {
        const { rows } = await db.query(
            'SELECT role_id FROM guild_admin_roles WHERE guild_id = $1',
            [member.guild.id]
        );
        if (rows.length === 0) return false;

        const trustedRoleIds = new Set(rows.map(r => r.role_id));
        return member.roles.cache.some(role => trustedRoleIds.has(role.id));
    } catch (error) {
        // Fail closed: if the DB is unreachable, don't let a role-only admin
        // through, but also don't let the error bubble up and silently kill
        // the interaction ("This interaction failed" with no explanation).
        console.error('❌ isAstraAdmin DB check failed:', error.message);
        return false;
    }
}

// Permissions that make a role "powerful". Astra hands roles out on its own
// (verification, level rewards), so a delegated (non-administrator) manager
// must never be able to point her at one of these: it would let them mint
// power for themselves or others through Astra.
const DANGEROUS_ROLE_PERMS = [
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ManageWebhooks',
    'ManageNicknames', 'ManageEvents', 'ManageThreads', 'KickMembers', 'BanMembers', 'ModerateMembers',
    'MentionEveryone', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers',
];

function isPowerfulRole(role) {
    if (!role || !role.permissions) return false;
    return DANGEROUS_ROLE_PERMS.some(p => PermissionFlagsBits[p] !== undefined && role.permissions.has(PermissionFlagsBits[p]));
}

// Returns null when `member` may make Astra hand out `role`, otherwise a
// short English reason. Real administrators/owner may pick any role.
async function roleDelegationProblem(member, role) {
    if (!role) return 'that is not a valid role.';
    if (role.id === member.guild.id) return 'the @everyone role can\'t be used here.';
    if (role.managed) return 'that role is managed by an integration and can\'t be handed out.';
    if (await isServerAdministrator(member)) return null;
    if (isPowerfulRole(role)) {
        return 'that role has powerful permissions (like managing roles, messages or members). Only a server Administrator can set Astra to hand out a role like that.';
    }
    return null;
}

module.exports = { isServerAdministrator, isAstraAdmin, isPowerfulRole, roleDelegationProblem };