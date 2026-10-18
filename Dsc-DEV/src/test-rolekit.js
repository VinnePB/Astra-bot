// Run: node test-rolekit.js   (no Discord or database needed)
const assert = require('assert');
const Module = require('module');

const FLAG = { UseApplicationCommands: 1n << 31n, ManageRoles: 1n << 28n, Administrator: 8n, BanMembers: 1n << 2n, KickMembers: 1n << 1n, ModerateMembers: 1n << 40n, ManageMessages: 1n << 13n, ManageGuild: 1n << 5n, ManageChannels: 1n << 4n };
const store = { settings: {}, admins: [], levelRoles: [], shop: [], explicit: [] };
const queries = [];
const fakeDb = { query: async (sql, p) => {
    queries.push(sql);
    if (/FROM guild_settings/.test(sql)) return { rows: store.settings[p[0]] ? [store.settings[p[0]]] : [] };
    if (/INSERT INTO guild_settings \(guild_id, divider_style/.test(sql)) { store.settings[p[0]] = { ...(store.settings[p[0]] || {}), guild_id: p[0], divider_style: p[1], divider_pad: p[2], divider_everyone: p[3], divider_template: p[4] }; return { rows: [] }; }
    if (/INSERT INTO guild_settings/.test(sql)) { const col = /\(guild_id, (\w+)\)/.exec(sql)[1]; store.settings[p[0]] = { ...(store.settings[p[0]] || {}), guild_id: p[0], [col]: p[1] }; return { rows: [] }; }
    if (/INSERT INTO guild_admin_roles/.test(sql)) { store.admins.push(p[1]); return { rows: [] }; }
    if (/FROM guild_divider_roles/.test(sql)) return { rows: store.explicit };
    if (/FROM guild_level_roles/.test(sql)) return { rows: store.levelRoles.map((role_id) => ({ role_id })) };
    if (/FROM shop_items/.test(sql)) return { rows: store.shop.map((role_id) => ({ role_id })) };
    if (/FROM guild_admin_roles/.test(sql)) return { rows: store.admins.map((role_id) => ({ role_id })) };
    return { rows: [] };
} };
const conn = { query: async (sql, p) => {
    queries.push({ sql, p });
    if (/DELETE FROM guild_divider_roles/.test(sql)) store.explicit = [];
    if (/INSERT INTO guild_divider_roles/.test(sql)) store.explicit.push({ kind: p[1], role_id: p[2] });
    return { rows: [] };
}, release() {} };
fakeDb.pool = { connect: async () => conn, on() {} };
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
    const guild = { id: 'g1', ownerId: 'owner', roles: { cache: { has: (id) => roles.has(id), get: (id) => roles.get(id), find: (f) => [...roles.values()].find(f), values: () => roles.values() },
        fetch: async () => {}, setPositions: async () => {}, create: async (d) => { const r = { id: String(110000000000000000n + BigInt(++n)), name: d.name, position: 1, managed: false, editable: true,
            permissions: { _p: new Set((d.permissions || []).map(String)), has(f) { return this._p.has(String(f)); }, add(f) { const c = { ...this, _p: new Set(this._p) }; c._p.add(String(f)); return c; } },
            setPermissions: async function (p) { this.permissions = p; }, setName: async function (n) { this.name = n; }, setPosition: async function (x) { this.position = x; } }; roles.set(r.id, r); return r; } },
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
    for (const n of ['Verified', 'Astra Admin', 'Moderator', '━━━━ STAFF ━━━━', '━━━━ ACCESS ━━━━', '━━━━ LEVELS ━━━━', '━━━━ SPECIAL ━━━━']) assert.ok(names.includes(n), n + ' created');
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
    const divs = Object.fromEntries(['staff', 'access', 'levels', 'special'].map((k) => [k, store.settings.g1[rolekit.DIVIDERS[k].col]]));
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
    // --- chosen groups: validated, replace the previous choice, dividers never head dividers
    guild.roles.cache.get('999') || await guild.roles.create({ name: 'Sneak Peeks' });
    const sneak = [...roles.values()].find((r) => r.name === 'Sneak Peeks');
    const managed = await guild.roles.create({ name: 'BotRole' }); managed.managed = true;
    await rolekit.saveGroups(guild, { special: [sneak.id, managed.id, guild.id, divs.access, '12', 'abc', "1'; DROP TABLE x;--"], staff: sneak.id });
    assert.deepStrictEqual(store.explicit.filter((e) => e.kind === 'special').map((e) => e.role_id), [sneak.id], 'only real, unmanaged, non-divider roles kept');
    assert.deepStrictEqual(store.explicit.filter((e) => e.kind === 'staff').map((e) => e.role_id), [sneak.id], 'a single value works too');
    await rolekit.saveGroups(guild, { special: [] });
    assert.strictEqual(store.explicit.length, 0, 'saving replaces the old choice');
    await rolekit.saveGroups(guild, { special: [sneak.id] });
    const g2 = await rolekit.loadGroups('g1');
    assert.ok(g2.groups.special.has(sneak.id) && g2.explicit.special.has(sneak.id));
    const sneakHolder = new Set([sneak.id]);
    const sm = { user: { bot: false }, guild, roles: { cache: { has: (id) => sneakHolder.has(id) }, add: async (r) => { sneakHolder.add(r.id); }, remove: async (r) => { sneakHolder.delete(r.id); } } };
    await rolekit.syncMember(sm);
    assert.ok(sneakHolder.has(divs.special), 'holder of a chosen role gets SPECIAL');
    const failed = await rolekit.arrangeDividers(guild);
    assert.ok(Array.isArray(failed));
    const specialDivider = roles.get(divs.special);
    assert.ok(specialDivider.position > sneak.position || specialDivider.position === 49, 'SPECIAL sits above its group');
    // --- look: line vs wide bar, labels survive a rename
    const { styled, labelOf } = rolekit;
    assert.strictEqual(styled('LEVELS', 'line', 14), '━━━━ LEVELS ━━━━');
    const bar = styled('LEVELS', 'bar', 5);
    assert.strictEqual(bar, '\u3164'.repeat(5) + 'LEVELS' + '\u3164'.repeat(5));
    assert.ok(styled('X'.repeat(90), 'bar', 30).length <= 100, 'never longer than a role name may be');
    assert.strictEqual(styled('A', 'bar', 999).length <= 100, true);
    assert.strictEqual(labelOf('━━━━ MISC ━━━━', 'X'), 'MISC');
    assert.strictEqual(labelOf(bar, 'X'), 'LEVELS');
    assert.strictEqual(labelOf('━━━━', 'FALLBACK'), 'FALLBACK');

    // --- restyle keeps a renamed label and switches look
    const lv = roles.get(divs.levels); lv.name = '━━━━ MISC ━━━━'; lv.setName = async function (n) { this.name = n; };
    store.settings.g1.divider_style = 'bar'; store.settings.g1.divider_pad = 3;
    await rolekit.restyleDividers(guild);
    assert.strictEqual(lv.name, '\u3164'.repeat(4) + 'MISC' + '\u3164'.repeat(4), 'custom label kept, bar look applied');

    // --- custom look: your own characters around {label}
    {
        const T = '═══ {label} ═══', C = rolekit.cleanTemplate;
        assert.strictEqual(styled('STAFF', 'custom', 14, T), '═══ STAFF ═══');
        assert.strictEqual(styled('STAFF', 'custom', 14, '✦ ━━ {label} ━━ ✦'), '✦ ━━ STAFF ━━ ✦');
        assert.strictEqual(styled('STAFF', 'custom', 14, 'no placeholder'), '━━━━ STAFF ━━━━', 'invalid template falls back to the line');
        assert.strictEqual(C('{label}'), null, 'label alone is not a divider');
        assert.strictEqual(C('a\nb {label}\u202e'), 'ab {label}', 'control and bidi characters removed');
        assert.ok(C('x'.repeat(200) + '{label}') === null && C('{label}' + 'y'.repeat(200)).length <= 60, 'length capped');
        assert.strictEqual(styled('Q', 'custom', 0, '$& {label} $1'), '$& Q $1', 'no replacement-pattern surprises');
        assert.strictEqual(labelOf('═══ STAFF ═══', 'X', T), 'STAFF');
        assert.strictEqual(labelOf('═══ 🎨 ARTISTS ═══', 'X', T), '🎨 ARTISTS', 'emoji in a label survives');
        assert.strictEqual(labelOf('✦ ━━ STAFF ━━ ✦', 'X'), 'STAFF', 'old custom look is still read after switching');
        assert.strictEqual(labelOf('🎨 ARTISTS', 'X'), '🎨 ARTISTS');
        const r = await rolekit.saveOptions('g1', { style: 'custom', pad: 14, template: T, everyone: [] });
        assert.strictEqual(r.templateInvalid, false);
        assert.strictEqual(store.settings.g1.divider_style, 'custom'); assert.strictEqual(store.settings.g1.divider_template, T);
        const bad = await rolekit.saveOptions('g1', { style: 'custom', pad: 14, template: 'nothing', everyone: [] });
        assert.strictEqual(bad.templateInvalid, true); assert.strictEqual(store.settings.g1.divider_style, 'line');
        await rolekit.saveOptions('g1', { style: 'custom', pad: 14, template: T, everyone: [] });
        const stf = roles.get(divs.staff); stf.setName = async function (n) { this.name = n; };
        await rolekit.restyleDividers(guild);
        assert.ok(/^═══ .+ ═══$/.test(stf.name), 'restyle applies the custom text: ' + stf.name);
        await rolekit.saveOptions('g1', { style: 'line', pad: 14, template: T, everyone: [] });
    }

    // --- width: capped, and equal-looking regardless of label length
    const wide = (l) => styled(l, 'bar', 999);
    assert.ok([...wide('A')].filter((c) => c === '\u3164').length <= 40, 'pad is capped');
    assert.strictEqual(styled('X', 'bar', 0), 'X', 'pad 0 means no padding');
    const filler = (l) => [...styled(l, 'bar', 14)].filter((c) => c === '\u3164').length;
    assert.ok(filler('STAFF') >= filler('SPECIAL'), 'longer labels get less padding');

    // --- group roles are stacked right under their divider; powerful, managed and too-high roles stay put
    {
        const mkRole = (id, position, extra = {}) => ({ id, name: id, position, managed: false, editable: true, permissions: { has: () => false }, ...extra });
        const dv = mkRole('d1', 40), a = mkRole('a', 30), x = mkRole('x', 25), b = mkRole('b', 20), c = mkRole('c', 10);
        const boost = mkRole('boost', 22, { managed: true }), high = mkRole('high', 60), pw = mkRole('pw', 5);
        const map = new Map([dv, a, x, b, c, boost, high, pw].map((r) => [r.id, r]));
        let applied = null;
        const g = { id: 'ev', roles: { cache: { values: () => map.values(), get: (id) => map.get(id), has: (id) => map.has(id) }, setPositions: async (ch) => { applied = ch; } }, members: { me: { roles: { highest: { position: 50 } } } } };
        const ctx = { settings: { divider_special_role_id: 'd1' }, groups: { staff: new Set(), access: new Set(), levels: new Set(), special: new Set(['a', 'b', 'c', 'boost', 'high', 'pw']) } };
        const changed = await rolekit._test.stackGroupRoles(g, ctx);
        assert.ok(changed > 0 && applied, 'something was moved');
        const pos = Object.fromEntries(applied.map((e) => [e.role, e.position]));
        for (const id of ['boost', 'high']) assert.ok(!(id in pos), id + ' untouched');
        const final = (id) => (id in pos ? pos[id] : map.get(id).position);
        assert.ok(final('d1') > final('a') && final('a') > final('b') && final('b') > final('c'), 'group stays in order under the divider');
        assert.ok(final('x') < final('c') || final('x') > final('d1') || final('x') < final('a'), 'unrelated role pushed out of the block');
        assert.ok(final('a') < final('d1') && final('x') < final('c'), 'x ends up below the whole block');
    }

    // --- "give to every member" puts a divider on someone with no roles at all (a new joiner)
    store.settings.g1.divider_everyone = 'staff,access';
    const joinHeld = new Set();
    const joiner = { user: { bot: false }, guild, roles: { cache: { has: (id) => joinHeld.has(id) }, add: async (r) => { joinHeld.add(r.id); }, remove: async (r) => { joinHeld.delete(r.id); } } };
    await rolekit.syncMember(joiner);
    assert.ok(joinHeld.has(divs.staff) && joinHeld.has(divs.access), 'everyone-dividers go on at join');
    assert.ok(!joinHeld.has(divs.levels) && !joinHeld.has(divs.special), 'the others stay off');

    // --- saving options validates
    await rolekit.saveOptions('g1', { style: 'evil', pad: 999, everyone: ['staff', 'nonsense', 'levels'] });
    assert.strictEqual(store.settings.g1.divider_style, 'line');
    assert.strictEqual(store.settings.g1.divider_pad, 20);
    assert.strictEqual(store.settings.g1.divider_everyone, 'staff,levels');

    // --- Discord's member-list rate limit: wait and retry instead of failing
    let tries = 0;
    guild.members.fetch = async () => { tries++; if (tries < 3) throw new Error('Request with opcode 8 was rate limited. Retry after 0.01 seconds.'); return new Map(people.map((p, i) => [String(i), p.m])); };
    const rs = global.setTimeout; global.setTimeout = (f) => rs(f, 0);
    const again = await rolekit.backfillDividers(guild);
    global.setTimeout = rs;
    assert.strictEqual(tries, 3, 'retried after the rate limit');
    assert.strictEqual(again, 3, 'and then finished the job');
    guild.memberCount = 3; guild.members.cache = new Map(people.map((p, i) => [String(i), p.m]));
    let fetched = false; guild.members.fetch = async () => { fetched = true; return new Map(); };
    global.setTimeout = (f) => rs(f, 0);
    await rolekit.backfillDividers(guild);
    global.setTimeout = rs;
    assert.ok(!fetched, 'a complete cache is used without asking Discord again');

    // --- re-check button: once per cooldown, never two sweeps at once
    const r1b = await rolekit.resync(guild);
    assert.ok(r1b.ok);
    const r2b = await rolekit.resync(guild);
    assert.strictEqual(r2b.ok, false, 'second press blocked');
    console.log('✅ rolekit OK');
})().catch((e) => { console.error(e); process.exit(1); });