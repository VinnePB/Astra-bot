// Run: node test-rolekit.js   (no Discord or database needed)
const assert = require('assert');
const Module = require('module');

const FLAG = { UseApplicationCommands: 1n << 31n, ManageRoles: 1n << 28n, Administrator: 8n, BanMembers: 1n << 2n, KickMembers: 1n << 1n, ModerateMembers: 1n << 40n, ManageMessages: 1n << 13n, ManageGuild: 1n << 5n, ManageChannels: 1n << 4n };
const store = { settings: {}, admins: [], levelRoles: [], shop: [] };
const queries = [];
const fakeDb = { query: async (sql, p) => {
    queries.push(sql);
    if (/FROM guild_settings/.test(sql)) return { rows: store.settings[p[0]] ? [store.settings[p[0]]] : [] };
    if (/INSERT INTO guild_settings/.test(sql)) { const col = /\(guild_id, (\w+)\)/.exec(sql)[1]; store.settings[p[0]] = { ...(store.settings[p[0]] || {}), guild_id: p[0], [col]: p[1] }; return { rows: [] }; }
    if (/INSERT INTO guild_admin_roles/.test(sql)) { store.admins.push(p[1]); return { rows: [] }; }
    if (/FROM guild_level_roles/.test(sql)) return { rows: store.levelRoles.map((role_id) => ({ role_id })) };
    if (/FROM shop_items/.test(sql)) return { rows: store.shop.map((role_id) => ({ role_id })) };
    if (/FROM guild_admin_roles/.test(sql)) return { rows: store.admins.map((role_id) => ({ role_id })) };
    return { rows: [] };
} };
const orig = Module._load;
Module._load = function (req, ...a) {
    if (req === 'discord.js') return { PermissionFlagsBits: FLAG };
    if (/(^|\/)database$/.test(req)) return fakeDb;
    return orig.call(this, req, ...a);
};
const rolekit = require('./rolekit');

// fake guild with a role cache
function makeGuild({ canManage = true } = {}) {
    let n = 100;
    const roles = new Map();
    const guild = { id: 'g1', ownerId: 'owner', roles: { cache: { has: (id) => roles.has(id), get: (id) => roles.get(id), find: (f) => [...roles.values()].find(f) },
        fetch: async () => {}, create: async (d) => { const r = { id: String(++n), name: d.name, position: 1, managed: false, editable: true,
            permissions: { _p: new Set((d.permissions || []).map(String)), has(f) { return this._p.has(String(f)); }, add(f) { const c = { ...this, _p: new Set(this._p) }; c._p.add(String(f)); return c; } },
            setPermissions: async function (p) { this.permissions = p; }, setPosition: async function (x) { this.position = x; } }; roles.set(r.id, r); return r; } },
        members: { fetch: async () => new Map(), me: { permissions: { has: () => canManage }, roles: { highest: { position: 50 } } }, fetchMe: async () => guild.members.me } };
    return { guild, roles };
}

(async () => {
    // --- gating
    const mk = (hasRole, admin) => ({ id: 'u', guild: { id: 'g1', ownerId: admin ? 'u' : 'owner', roles: { cache: { has: () => true } } }, permissions: { has: () => false }, roles: { cache: { has: () => hasRole } } });
    store.settings.g1 = { guild_id: 'g1' };
    assert.ok(await rolekit.memberMayUseCommands(mk(false, false)), 'no verification set up: open to all');
    store.settings.g1 = { guild_id: 'g1', verify_channel_id: 'c', member_role_id: 'r' };
    assert.ok(await rolekit.memberMayUseCommands(mk(true, false)), 'verified passes');
    assert.ok(!(await rolekit.memberMayUseCommands(mk(false, false))), 'unverified blocked');
    assert.ok(await rolekit.memberMayUseCommands(mk(false, true)), 'server owner passes');
    store.admins = ['adminrole'];
    const adminMember = mk(false, false); adminMember.roles.cache.some = (f) => f({ id: 'adminrole' });
    assert.ok(await rolekit.memberMayUseCommands(adminMember), 'Astra admin passes');
    const g0 = mk(false, false); g0.guild.roles.cache.has = () => false;
    assert.ok(await rolekit.memberMayUseCommands(g0), 'deleted Verified role never locks everyone out');
    for (const c of ['help', 'about', 'mydata', 'config', 'ban']) assert.ok(!rolekit.MEMBER_COMMANDS.has(c), c + ' is not gated');

    // --- setup without Manage Roles
    const bad = makeGuild({ canManage: false });
    const r0 = await rolekit.setupHierarchy(bad.guild);
    assert.strictEqual(r0.ok, false);

    // --- setup creates roles, grants command access, no powerful perms
    store.settings = {}; store.admins = [];
    const { guild, roles } = makeGuild();
    const r1 = await rolekit.setupHierarchy(guild, { dividers: true });
    assert.ok(r1.ok);
    const names = [...roles.values()].map((r) => r.name);
    for (const n of ['Verified', 'Astra Admin', 'Moderator', '━━━━ ACCESS ━━━━', '━━━━ LEVELS ━━━━', '━━━━ SPECIAL ━━━━']) assert.ok(names.includes(n), n + ' created');
    const verified = [...roles.values()].find((r) => r.name === 'Verified');
    assert.ok(verified.permissions.has(FLAG.UseApplicationCommands));
    assert.ok(![...roles.values()].some((r) => [FLAG.Administrator, FLAG.ManageRoles, FLAG.ManageGuild, FLAG.ManageChannels].some((f) => r.permissions.has(f))), 'no role gets role/server management');
    const mod = [...roles.values()].find((r) => r.name === 'Moderator');
    for (const f of [FLAG.BanMembers, FLAG.KickMembers, FLAG.ModerateMembers, FLAG.ManageMessages]) assert.ok(mod.permissions.has(f), 'moderator has the 4 mod perms');
    assert.ok(!store.admins.includes(mod.id), 'moderator is not an Astra admin');
    assert.strictEqual(store.settings.g1.member_role_id, verified.id);
    assert.strictEqual(store.admins.length, 1);

    // --- second run reuses, never duplicates
    const before = roles.size;
    await rolekit.setupHierarchy(guild, { dividers: true });
    assert.strictEqual(roles.size, before, 'idempotent');

    // --- divider is handed out with the role it heads
    let added = null;
    const member = { guild, roles: { cache: { has: () => false }, add: async (r) => { added = r; } } };
    await rolekit.giveDivider(member, 'levels');
    assert.strictEqual(added.name, '━━━━ LEVELS ━━━━');
    await rolekit.giveDivider(member, 'nonsense'); // ignored
    // --- sync: dividers follow the roles people hold (added AND removed), never touching other roles
    const divs = Object.fromEntries(['access', 'levels', 'special'].map((k) => [k, store.settings.g1[rolekit.DIVIDERS[k].col]]));
    assert.ok(divs.access && divs.levels && divs.special, 'all three dividers stored');
    store.levelRoles = ['lvl10']; store.shop = ['shop1'];
    const held = new Set([store.settings.g1.member_role_id, 'lvl10', 'unrelated']);
    const changes = [];
    const m = { user: { bot: false }, guild, roles: { cache: { has: (id) => held.has(id) },
        add: async (r) => { held.add(r.id); changes.push('+' + r.name); }, remove: async (r) => { held.delete(r.id); changes.push('-' + r.name); } } };
    await rolekit.syncMember(m);
    assert.ok(held.has(divs.access) && held.has(divs.levels) && !held.has(divs.special), 'gets ACCESS + LEVELS, not SPECIAL');
    held.delete('lvl10'); changes.length = 0;
    await rolekit.syncMember(m);
    assert.ok(!held.has(divs.levels) && held.has(divs.access), 'loses LEVELS when no level role is left');
    assert.ok(held.has('unrelated'), 'other roles untouched');
    const bot = { user: { bot: true }, guild, roles: { cache: { has: () => false }, add: async () => { throw new Error('bots are skipped'); } } };
    await rolekit.syncMember(bot);

    // --- backfill reaches everyone already in the server
    const people = [1, 2, 3].map((i) => { const h = new Set([store.settings.g1.member_role_id]); return { h, m: { user: { bot: false }, guild, roles: { cache: { has: (id) => h.has(id) }, add: async (r) => { h.add(r.id); }, remove: async (r) => { h.delete(r.id); } } } }; });
    guild.members.fetch = async () => new Map(people.map((p, i) => [String(i), p.m]));
    const realSetTimeout = global.setTimeout; global.setTimeout = (f) => realSetTimeout(f, 0);
    const done = await rolekit.backfillDividers(guild);
    global.setTimeout = realSetTimeout;
    assert.strictEqual(done, 3);
    assert.ok(people.every((p) => p.h.has(divs.access)), 'everyone verified got the ACCESS divider');
    console.log('✅ rolekit OK');
})().catch((e) => { console.error(e); process.exit(1); });