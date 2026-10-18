// Run: node test-ownertools.js   (no Discord, database or network needed)
const assert = require('assert');
const path = require('path');
const Module = require('module');

const queries = [];
let rowsFor = () => [];
const fakeConn = { query: async (sql, p) => { queries.push({ sql, p }); return { rows: rowsFor(sql, p), rowCount: 2 }; }, release() {} };
const fakeDb = { query: async (sql, p) => { queries.push({ sql, p }); return { rows: rowsFor(sql, p), rowCount: 0 }; }, pool: { connect: async () => fakeConn, on() {} } };
const chain = new Proxy(function () {}, { get: (t, p) => (p === 'toJSON' ? () => ({}) : chain), apply: () => chain });
const fakeDiscord = {
    SlashCommandBuilder: function () { return chain; }, EmbedBuilder: function () { return chain; },
    AttachmentBuilder: function (b, o) { this.buffer = b; this.name = o.name; },
    ActionRowBuilder: function () { return chain; }, ButtonBuilder: function () { return chain; }, ButtonStyle: {},
    PermissionFlagsBits: { Administrator: 8n }, InteractionContextType: { BotDM: 1 },
};
const posts = [];
const fakeAxios = { post: async (url, body) => { posts.push({ url, body }); return {}; } };

const orig = Module._load;
Module._load = function (req, parent, ...a) {
    if (req === 'discord.js') return fakeDiscord;
    if (req === 'axios') return fakeAxios;
    if (req === 'dotenv') return { config() {} };
    if (/(^|\/)database$/.test(req)) return fakeDb;
    return orig.call(this, req, parent, ...a);
};

(async () => {
    // ---------- alerts: redaction, dedupe, rate limit
    // Fake token, assembled from pieces so secret scanners don't mistake this file for a leak.
    const FAKE_TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GabcDE', 'abcdefghijklmnopqrstuvwxyz0'].join('.');
    process.env.DISCORD_TOKEN = FAKE_TOKEN;
    process.env.DATABASE_URL = 'postgres://user:pw@host/db';
    process.env.ALERT_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abcSECRETtoken';
    const alerts = require('./alerts');
    const red = alerts.redact(`boom ${process.env.DISCORD_TOKEN} at ${process.env.DATABASE_URL} via ${process.env.ALERT_WEBHOOK_URL}`);
    assert.ok(!red.includes('GabcDE') && !red.includes('pw@host') && !red.includes('abcSECRET'), red);
    assert.ok(alerts.redact('token ' + ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GabcDE', 'abcdefghijklmnopqrstuvwxyz1'].join('.')).includes('[hidden]'));

    assert.strictEqual(await alerts.notify('Same problem', 'x', { key: 'k1' }), true);
    assert.strictEqual(await alerts.notify('Same problem', 'x', { key: 'k1' }), false, 'dedupe inside cooldown');
    assert.strictEqual(await alerts.notify('Other', 'x', { key: 'k2' }), true);
    assert.strictEqual(await alerts.notify('Again', 'x', { key: 'k1', cooldownMs: 0 }), true, 'cooldown 0 always passes');
    let sent = 0;
    for (let i = 0; i < 30; i++) if (await alerts.notify('flood ' + i, 'x', { key: 'f' + i })) sent++;
    assert.ok(sent <= 12 - 3, `hourly cap holds (sent ${sent} more)`);
    assert.ok(posts.length <= 12, 'never more than 12 per hour');
    assert.ok(!JSON.stringify(posts).includes('GabcDE'), 'no secrets sent');

    // ---------- restore: safe INSERT building
    const { buildInsert } = require('./restore-backup');
    const ins = buildInsert('mod_cases', { id: 5, guild_id: 'g', reason: "o'neil; DROP TABLE x" });
    assert.strictEqual(ins.sql, 'INSERT INTO "mod_cases" ("id", "guild_id", "reason") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING');
    assert.deepStrictEqual(ins.values, [5, 'g', "o'neil; DROP TABLE x"]);
    assert.throws(() => buildInsert('mod_cases', { 'id"; DROP TABLE x; --': 1 }), /Unsafe/);
    assert.throws(() => buildInsert('x; drop', { id: 1 }), /Unsafe/);

    // ---------- backup file round trip
    const backup = require('./backup');
    rowsFor = (sql) => (/FROM guild_settings/.test(sql) ? [{ guild_id: 'g1', antiscam_enabled: true }] : []);
    const b = await backup.createBackup();
    const data = JSON.parse(require('zlib').gunzipSync(b.buffer).toString());
    assert.strictEqual(data.format, 'astra-backup-1');
    assert.deepStrictEqual(Object.keys(data.tables), backup.BACKUP_TABLES);
    assert.strictEqual(data.tables.guild_settings[0].guild_id, 'g1');
    assert.ok(/^astra-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json\.gz$/.test(b.filename), b.filename);
    assert.ok(!backup.BACKUP_TABLES.includes('session'), 'sessions are not backed up');

    // ---------- user data: export + delete
    const ud = require('./userdata');
    assert.ok(ud.isUserId('123456789012345678'));
    assert.ok(!ud.isUserId('abc') && !ud.isUserId('1; DROP') && !ud.isUserId(''));
    queries.length = 0; rowsFor = () => [];
    const ex = await ud.exportUser('123456789012345678');
    assert.deepStrictEqual(Object.keys(ex), ud.USER_TABLES.map((t) => t.table));
    assert.ok(queries.every((q) => /WHERE user_id = \$1/.test(q.sql)));
    queries.length = 0;
    const del = await ud.deleteUser('123456789012345678');
    const deleted = queries.filter((q) => /^DELETE/.test(q.sql)).map((q) => q.sql);
    assert.ok(!deleted.some((s) => /mod_cases/.test(s)), 'moderation cases are kept by default');
    assert.ok(queries[0].sql === 'BEGIN' && queries[queries.length - 1].sql === 'COMMIT');
    assert.ok(!('mod_cases' in del));
    queries.length = 0;
    await ud.deleteUser('123456789012345678', { moderation: true });
    assert.ok(queries.some((q) => /DELETE FROM mod_cases/.test(q.sql)), 'owner can include moderation cases');

    // ---------- retention covers every table the backup does (except blocklist and meta)
    const retention = require('./retention');
    for (const t of backup.BACKUP_TABLES) {
        if (t === 'blocked_guilds') continue;
        assert.ok(retention.GUILD_TABLES.includes(t), `${t} is deleted when a server's data expires`);
    }

    // ---------- owner commands: plain text in a DM, never a slash command
    process.env.BOT_OWNER_ID = '111111111111111111';
    const owner = require('./commands/owner');
    assert.ok(!('data' in owner), 'no slash command is exported for /owner');
    const P = owner.parseText;
    assert.strictEqual(P('hello there'), null);
    assert.strictEqual(P('ownership matters'), null, 'only the word owner counts');
    assert.deepStrictEqual(P('owner servers 2'), { sub: 'servers', opts: { page: 2 } });
    assert.deepStrictEqual(P('!Owner leave 123456789012345678 spam and abuse'), { sub: 'leave', opts: { id: '123456789012345678', reason: 'spam and abuse' } });
    assert.deepStrictEqual(P('owner purge 1 1'), { sub: 'purge', opts: { id: '1', confirm: '1' } });
    assert.deepStrictEqual(P('owner userdelete 5 confirm moderation'), { sub: 'userdelete', opts: { user_id: '5', confirm: true, include_moderation: true } });
    assert.strictEqual(P('owner userdelete 5').opts.confirm, false, 'delete needs the word confirm');
    assert.strictEqual(P('owner nonsense').sub, 'help');
    assert.strictEqual(P('owner').sub, 'help');

    const dms = [];
    const msg = (uid, content) => ({ author: { id: uid, bot: false }, content, client: {}, channel: { sendTyping: async () => {} }, reply: async (o) => { dms.push(typeof o === 'string' ? { content: o } : o); } });
    // a stranger: gets the "add me" note once, never owner output, never learns the command exists
    dms.length = 0;
    await owner.handleDm(msg('222222222222222222', 'owner servers'), { strangerReply: 'ADD ME' });
    assert.deepStrictEqual(dms.map((m) => m.content), ['ADD ME'], 'stranger only gets the invite note');
    await owner.handleDm(msg('222222222222222222', 'owner backup'), { strangerReply: 'ADD ME' });
    assert.strictEqual(dms.length, 1, 'and only once per cooldown');
    await owner.handleDm(msg('333333333333333333', 'hi'), { strangerReply: 'ADD ME' });
    assert.strictEqual(dms.length, 2, 'another stranger still gets it');
    // the owner: help works, ordinary chat is ignored
    dms.length = 0;
    await owner.handleDm(msg('111111111111111111', 'owner help'), { strangerReply: 'ADD ME' });
    assert.ok(/Owner commands/.test(dms[0].content), 'owner sees the command list');
    const before = dms.length;
    assert.strictEqual(await owner.handleDm(msg('111111111111111111', 'just chatting'), { strangerReply: 'ADD ME' }), false);
    assert.strictEqual(dms.length, before, 'owner small talk gets no reply');
    // bad input is refused with a message, not a crash
    await owner.handleDm(msg('111111111111111111', 'owner server abc'), { strangerReply: 'ADD ME' });
    assert.ok(/server ID/.test(dms[dms.length - 1].content), 'bad id refused');
    // bots are ignored
    assert.strictEqual(await owner.handleDm({ ...msg('111111111111111111', 'owner help'), author: { id: '1', bot: true } }, {}), false);

    // ---------- /invite
    const invite = require('./invite');
    const links = { inviteUrl: 'https://discord.com/x', siteUrl: 'https://projeckt-v.dev' };
    assert.ok(/discord\.com\/x/.test(invite.strangerText(links)) && /projeckt-v\.dev/.test(invite.strangerText(links)));
    assert.ok(invite.buildReply('pt-BR', links).ephemeral === true);
    console.log('✅ owner tools OK');
})().catch((e) => { console.error('❌', e); process.exit(1); });