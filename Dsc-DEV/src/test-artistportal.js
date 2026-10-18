// Run: node test-artistportal.js   (no Discord, database or network needed)
const assert = require('assert');
const Module = require('module');

const queries = [];
let artistRows = [];
let artistRoleRows = [];
const conn = { query: async (sql, p) => { queries.push({ sql, p }); return { rows: [] }; }, release() { queries.push({ sql: 'RELEASE' }); } };
const fakeDb = { query: async (sql, p) => {
    queries.push({ sql, p });
    if (/FROM guild_artist_roles/.test(sql)) return { rows: artistRoleRows };
    if (/FROM artists WHERE guild_id = \$1 AND user_id = \$2/.test(sql) && /SELECT 1/.test(sql)) return { rows: artistRows.filter((r) => r.guild_id === p[0] && r.user_id === p[1]) };
    return { rows: [] };
}, pool: { connect: async () => conn, on() {} } };
const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain, construct: () => chain });
const fakeDiscord = new Proxy({}, { get: () => chain });
const orig = Module._load;
Module._load = function (req, ...a) {
    if (req === 'discord.js') return fakeDiscord;
    if (/(^|\/)database$/.test(req) || /(^|\/)\.\.\/database$/.test(req)) return fakeDb;
    if (/(^|\/)\.\.\/(permissions|i18n)$/.test(req)) return { isAstraAdmin: async () => false, isPowerfulRole: (r) => r.permissions.has('Administrator'), t: (l, k) => k };
    if (/\.\.\/commands\/config$|\.\/config$/.test(req)) return { logAction: async () => {}, getSettings: async () => null };
    return orig.call(this, req, ...a);
};
const portal = require('./artistportal');

(async () => {
    const { cleanText, cleanUrl } = portal._test;

    // --- cleaning
    assert.strictEqual(cleanText('  hi\u0000 there\r\nline2  ', 50), 'hi there\nline2');
    assert.strictEqual(cleanText('x'.repeat(5000), 1000).length, 1000);
    assert.strictEqual(cleanUrl('', 300), '');
    assert.strictEqual(cleanUrl('https://example.com/a.png', 300), 'https://example.com/a.png');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.com', 'not a url', 'https://a.com/ b', 'https://a.com/' + 'x'.repeat(400)]) {
        assert.strictEqual(cleanUrl(bad, 300), null, bad + ' rejected');
    }

    // --- form parsing
    const ok = portal.parseForm({ tos_text: ' my tos ', banner_url: 'https://e.com/b.png', link_other: 'https://k.com', link_other_label: 'Ko-fi', price_0: '$10', price_4: 'x'.repeat(99) });
    assert.ok(ok.ok);
    assert.strictEqual(ok.values.tos_text, 'my tos');
    assert.strictEqual(ok.values.prices.length, portal.CATEGORIES.length);
    assert.strictEqual(ok.values.prices[0].price, '$10');
    assert.strictEqual(ok.values.prices[4].price.length, 30, 'price capped');
    assert.strictEqual(ok.values.prices[1].price, '', 'blank price clears');
    assert.deepStrictEqual(portal.parseForm({ link_portfolio: 'javascript:alert(1)' }), { ok: false, error: 'bad_url' });
    assert.ok(portal.parseForm({}).ok, 'empty form is a valid "reset to defaults"');

    // --- authorization: only a person who is in the server AND an artist there
    const GID = '111111111111111111', UID = '222222222222222222', OTHER = '333333333333333333';
    artistRows = [{ guild_id: GID, user_id: UID }];
    const member = (id) => ({ id, guild: { id: GID }, roles: { cache: { has: () => false } }, displayName: 'N' });
    const members = { [UID]: member(UID), [OTHER]: member(OTHER) };
    const client = { guilds: { cache: { get: (id) => (id === GID ? { id: GID, members: { fetch: async (u) => { if (!members[u]) throw new Error('unknown'); return members[u]; } } } : undefined) } } };
    assert.ok(await portal.artistContext(client, GID, UID), 'registered artist allowed');
    assert.strictEqual(await portal.artistContext(client, GID, OTHER), null, 'member who is not an artist refused');
    assert.strictEqual(await portal.artistContext(client, '999999999999999999', UID), null, 'unknown server refused');
    delete members[UID];
    assert.strictEqual(await portal.artistContext(client, GID, UID), null, 'artist who left the server refused');
    assert.strictEqual(await portal.artistContext(client, 'abc', UID), null, 'bad id refused');
    assert.strictEqual(await portal.artistContext(client, GID, "1' OR '1'='1"), null, 'bad user id refused');

    // --- save is scoped to exactly that guild + user, in one transaction
    queries.length = 0;
    await portal.savePanel(GID, UID, ok.values);
    const sqls = queries.map((q) => q.sql);
    assert.strictEqual(sqls[0], 'BEGIN');
    assert.ok(sqls.includes('COMMIT') && sqls.includes('RELEASE'));
    const update = queries.find((q) => /UPDATE artists SET/.test(q.sql));
    assert.deepStrictEqual(update.p.slice(-2), [GID, UID], 'update only touches this artist');
    assert.ok(queries.filter((q) => /artist_pricing/.test(q.sql)).every((q) => q.p[0] === GID && q.p[1] === UID));
    assert.ok(queries.some((q) => /DELETE FROM artist_pricing/.test(q.sql)), 'blank price removed');
    assert.ok(update.p.includes('Ko-fi'), 'custom link label kept');
    // --- registering an artist gives the artist role; removing takes it back; powerful roles are never handed out
    const tickets = require('./commands/tickets');
    const perms = (bits) => ({ has: (f) => bits.includes(f) });
    const mkRole = (id, powerful) => ({ id, editable: true, managed: false, permissions: perms(powerful ? ['Administrator'] : []) });
    const ROLE = mkRole('500000000000000001'), BOSS = mkRole('500000000000000002', true);
    const rolesById = new Map([[ROLE.id, ROLE], [BOSS.id, BOSS]]);
    const held = new Set();
    const g = { id: GID, roles: { cache: { get: (id) => rolesById.get(id) } },
        members: { fetch: async () => ({ roles: { cache: { has: (id) => held.has(id) }, add: async (r) => { held.add(r.id); }, remove: async (r) => { held.delete(r.id); } } }) } };
    artistRoleRows = [];
    assert.strictEqual(await tickets.grantArtistRole(g, UID), null, 'no artist role configured: nothing happens');
    artistRoleRows = [{ role_id: BOSS.id }];
    assert.strictEqual(await tickets.grantArtistRole(g, UID), null, 'a role with admin powers is never handed out');
    artistRoleRows = [{ role_id: BOSS.id }, { role_id: ROLE.id }];
    assert.strictEqual((await tickets.grantArtistRole(g, UID)).id, ROLE.id, 'first safe artist role is used');
    assert.ok(held.has(ROLE.id) && !held.has(BOSS.id));
    await tickets.revokeArtistRole(g, UID);
    assert.ok(!held.has(ROLE.id), 'removing the artist takes the role back');
    console.log('✅ artist portal OK');
})().catch((e) => { console.error(e); process.exit(1); });