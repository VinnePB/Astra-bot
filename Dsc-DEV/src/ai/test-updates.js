// test-updates.js: checks commands/updates.js with a fake discord.js, fake
// database and fake servers. Needs no Discord, database or network:
//     node src/test-updates.js
// (It does use the real discord.js builders when installed, and a stand-in when not.)

const Module = require('module');
const path = require('path');

// ---- fake database: an in-memory guild_settings table
const table = new Map(); // guild_id -> row
const fakeDb = {
    async query(sql, p = []) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (/^SELECT language, updates_enabled/.test(s)) return { rows: table.has(p[0]) ? [{ ...table.get(p[0]) }] : [] };
        if (/^SELECT guild_id, updates_channel_id, updates_role_id, updates_last_version/.test(s)) return { rows: [...table.values()].filter((r) => r.updates_enabled).map((r) => ({ ...r })) };
        if (/^SELECT guild_id, updates_channel_id, updates_role_id, language/.test(s)) return { rows: [...table.values()].filter((r) => r.updates_enabled).map((r) => ({ ...r })) };
        if (/^UPDATE guild_settings SET updates_last_version/.test(s)) { table.get(p[0]).updates_last_version = p[1]; return { rows: [] }; }
        if (/^INSERT INTO guild_settings \(guild_id, updates_enabled, updates_channel_id/.test(s)) {
            const r = table.get(p[0]) || { guild_id: p[0], language: 'en' };
            Object.assign(r, { updates_enabled: true, updates_channel_id: p[1], updates_role_id: p[2], updates_last_version: p[3] });
            table.set(p[0], r); return { rows: [] };
        }
        if (/^INSERT INTO guild_settings \(guild_id, updates_enabled\) VALUES \(\$1, FALSE\)/.test(s)) {
            const r = table.get(p[0]) || { guild_id: p[0], language: 'en' }; r.updates_enabled = false; table.set(p[0], r); return { rows: [] };
        }
        throw new Error('unexpected SQL: ' + s);
    },
};

let adminOk = true;
const logs = [];
const origLoad = Module._load;
let real = null;
try { real = require('discord.js'); } catch (e) { /* fall back to the stand-in below */ }
const perms = real ? real.PermissionFlagsBits : new Proxy({}, { get: (_, k) => BigInt(String(k).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) });
class Chain { constructor() { const p = new Proxy(this, { get: (_, k) => k === 'toJSON' ? () => ({}) : (...a) => { for (const x of a) if (typeof x === 'function') { try { x(new Chain()); } catch (e) {} } return p; } }); return p; } }
class FakeEmbed { constructor() { this.d = {}; } setColor(c) { this.d.color = c; return this; } setTitle(x) { this.d.title = x; return this; } setDescription(x) { this.d.description = x; return this; } setFooter(x) { this.d.footer = x; return this; } addFields(...f) { (this.d.fields ||= []).push(...f.flat()); return this; } }
const fakeDiscord = { SlashCommandBuilder: Chain, EmbedBuilder: FakeEmbed, ChannelType: { GuildText: 0, GuildAnnouncement: 5 }, PermissionFlagsBits: perms };
Module._load = function (req, parent, ...r) {
    if (req === 'discord.js') return real || fakeDiscord;
    if (req === '../database') return fakeDb;
    if (req === '../permissions') return { isAstraAdmin: async () => adminOk };
    if (req === './config') return { logAction: async (g, m) => logs.push(m) };
    return origLoad.call(this, req, parent, ...r);
};
const updates = require('./commands/updates');
const T = updates._test;

let failed = 0;
const check = (name, ok) => { if (!ok) { failed++; console.log('FAIL', name); } };
const embedData = (e) => (e.d || e.data || e.toJSON?.() || e);

// ---- parsing
const entries = T.loadChangelog();
check('changelog.md parsed', entries.length >= 30);
check('oldest first', entries[0].version === 'b.0.0.6');
check('versions in order and unique', new Set(entries.map((e) => e.version)).size === entries.length);
check('current marker stripped from titles', entries.every((e) => !/current/.test(e.title)));
check('no separators or placeholders in bodies', entries.every((e) => !/^---$/m.test(e.body) && !/UPCOMING UPDATE/.test(e.body)));
const sample = T.parseChangelog('# x\n\n## b.1.0.0 — One *(current)*\nbody one\n\n---\n\n## nope\nignored\n\n## b.1.1.0 — Two\nbody two\n\n{UPCOMING UPDATE, SOON}\n');
check('duplicate headings merge', T.parseChangelog('## b.1.0.0 — A\none\n\n## b.1.0.0 — B\ntwo\n').length === 1 && /one[\s\S]*two/.test(T.parseChangelog('## b.1.0.0 — A\none\n\n## b.1.0.0 — B\ntwo\n')[0].body));
check('parse: 2 entries', sample.length === 2 && sample[0].title === 'One' && sample[1].body === 'body two');

// ---- chunking
const long = Array.from({ length: 400 }, (_, i) => `- line number ${i} with some padding text here`).join('\n');
const chunks = T.chunkText(long, 3800);
check('chunks within limit', chunks.every((c) => c.length <= 3800) && chunks.length > 1);
check('chunking loses nothing', chunks.join('\n').replace(/\s+/g, '') === long.replace(/\s+/g, ''));
check('absurd single line is cut', T.chunkText('x'.repeat(9000), 3800).every((c) => c.length <= 3800));
check('every real entry fits in embeds', entries.every((e) => T.chunkText(e.body).every((c) => c.length <= 4096)));

// ---- pending logic
const mk = (...v) => v.map((version) => ({ version, title: 't', body: 'b' }));
const e5 = mk('b.1.0.0', 'b.1.1.0', 'b.1.2.0', 'b.1.3.0', 'b.1.4.0');
let r = T.pendingFor(e5, 'b.1.4.0');
check('up to date: nothing', r.toPost.length === 0 && !r.resync);
r = T.pendingFor(e5, 'b.1.3.0');
check('one behind: that one', r.toPost.length === 1 && r.toPost[0].version === 'b.1.4.0');
r = T.pendingFor(e5, 'b.1.0.0');
check('far behind: newest 3, oldest first, skipped counted', r.toPost.map((e) => e.version).join() === 'b.1.2.0,b.1.3.0,b.1.4.0' && r.skipped === 1);
check('null last version: resync, no dump', T.pendingFor(e5, null).resync === true && T.pendingFor(e5, null).toPost.length === 0);
check('unknown last version: resync', T.pendingFor(e5, 'b.9.9.9').resync === true);

// ---- fake discord objects
function makeChannel(id, { canPost = true } = {}) {
    const sent = [];
    return { id, sent, isTextBased: () => true, permissionsFor: () => ({ has: () => canPost }), send: async (p) => { sent.push(p); return {}; } };
}
function makeGuild(id, channels, { manage = true } = {}) {
    const chans = new Map(channels.map((c) => [c.id, c]));
    const me = { id: 'BOT', permissions: { has: () => manage } };
    return {
        id, name: 'Guild ' + id, ownerId: 'OWN', members: { me }, roles: { everyone: { id: 'EVERYONE' } },
        channels: { fetch: async (cid) => chans.get(cid) || null, create: async (o) => { const c = makeChannel('new-' + id); chans.set(c.id, c); c.created = o; return c; } },
    };
}
const client = (guilds) => ({ guilds: { cache: new Map(guilds.map((g) => [g.id, g])) }, application: { fetch: async () => ({ owner: { id: 'OWNER1' } }) } });
function interaction(guild, sub, opts = {}, user = 'U1') {
    const replies = [];
    return {
        guild, member: { id: user }, user: { id: user, username: 'u', toString: () => `<@${user}>` }, client: opts.client,
        options: { getSubcommand: () => sub, getChannel: () => opts.channel ?? null, getBoolean: (k) => opts.bool?.[k] ?? null, getRole: () => opts.role ?? null, getString: (k) => opts.str?.[k] ?? null },
        replied: false, deferred: false,
        reply: async (o) => { replies.push(o); return {}; }, deferReply: async () => {}, editReply: async (o) => { replies.push(o); }, followUp: async (o) => { replies.push(o); },
        _r: replies,
    };
}
const current = entries[entries.length - 1];
const older = entries[entries.length - 3];

(async () => {
    // ---- startup pass: only opted-in guilds, only unseen versions, each version once
    table.clear();
    const chA = makeChannel('cA'), chB = makeChannel('cB'), chC = makeChannel('cC', { canPost: false });
    const gA = makeGuild('A', [chA]), gB = makeGuild('B', [chB]), gC = makeGuild('C', [chC]), gOff = makeGuild('OFF', [makeChannel('cO')]);
    table.set('A', { guild_id: 'A', language: 'en', updates_enabled: true, updates_channel_id: 'cA', updates_role_id: 'ROLE1', updates_last_version: older.version });
    table.set('B', { guild_id: 'B', language: 'en', updates_enabled: true, updates_channel_id: 'cB', updates_role_id: null, updates_last_version: current.version });
    table.set('C', { guild_id: 'C', language: 'en', updates_enabled: true, updates_channel_id: 'cC', updates_role_id: null, updates_last_version: older.version });
    table.set('OFF', { guild_id: 'OFF', language: 'en', updates_enabled: false, updates_channel_id: 'cO', updates_last_version: older.version });
    const c = client([gA, gB, gC, gOff]);
    let s = await updates.postPendingToAll(c);
    check('A got the 2 unseen versions', chA.sent.length >= 2 && table.get('A').updates_last_version === current.version);
    const firstEmbed = embedData(chA.sent[0].embeds[0]);
    check('oldest of the unseen first', firstEmbed.title.startsWith(entries[entries.length - 2].version));
    check('role pinged once, only on the first message', chA.sent[0].content?.includes('<@&ROLE1>') && !chA.sent.slice(1).some((m) => m.content?.includes('<@&ROLE1>')) && chA.sent[0].allowedMentions.roles[0] === 'ROLE1');
    check('B was up to date: silent', chB.sent.length === 0);
    check('C has no permission: nothing sent, will retry', chC.sent.length === 0 && table.get('C').updates_last_version === older.version && s.failed === 1);
    check('off guild untouched', table.get('OFF').updates_last_version === older.version);
    const before = chA.sent.length;
    await updates.postPendingToAll(c);
    check('second pass posts nothing new', chA.sent.length === before);

    // ---- resync: a server with no remembered version is NOT flooded
    table.set('B', { ...table.get('B'), updates_last_version: null });
    await updates.postPendingToAll(c);
    check('null version resyncs silently', chB.sent.length === 0 && table.get('B').updates_last_version === current.version);

    // ---- /updates on / view / off / preview
    table.clear();
    const chX = makeChannel('cX');
    const gX = makeGuild('X', [chX]);
    let i = interaction(gX, 'on', { channel: { id: 'cX' }, client: c });
    await updates.executeSlashUpdates(i);
    check('/updates on saves and starts at current', table.get('X').updates_enabled && table.get('X').updates_last_version === current.version && /✅/.test(i._r[0].content));
    i = interaction(gX, 'view', {}); await updates.executeSlashUpdates(i);
    check('/updates view shows channel', i._r[0].content.includes('<#cX>') && i._r[0].content.includes(current.version));
    i = interaction(gX, 'preview', {}); await updates.executeSlashUpdates(i);
    check('/updates preview posts latest without a ping', chX.sent.length >= 1 && !chX.sent[0].content && /✅/.test(i._r[0].content));
    i = interaction(gX, 'off', {}); await updates.executeSlashUpdates(i);
    check('/updates off', table.get('X').updates_enabled === false);
    i = interaction(gX, 'preview', {}); await updates.executeSlashUpdates(i);
    check('preview refused when off', /❌/.test(i._r[0].content));

    // no channel, no create
    table.clear();
    i = interaction(gX, 'on', {}); await updates.executeSlashUpdates(i);
    check('/updates on with nothing asks for a channel', /❌/.test(i._r[0].content) && !table.has('X'));

    // create channel
    i = interaction(gX, 'on', { bool: { create: true } }); await updates.executeSlashUpdates(i);
    check('create:True makes a read-only channel', table.get('X')?.updates_channel_id === 'new-X' && /✅/.test(i._r[0].content));
    const created = (await gX.channels.fetch('new-X')).created;
    check('created channel: everyone cannot send, Astra can', created.permissionOverwrites[0].deny.length === 1 && created.permissionOverwrites[1].allow.length === 3);

    // create without permission
    table.clear();
    const gNoManage = makeGuild('N', [], { manage: false });
    i = interaction(gNoManage, 'on', { bool: { create: true } }); await updates.executeSlashUpdates(i);
    check('create without Manage Channels refused', /Manage Channels/.test(i._r[0].content) && !table.has('N'));

    // channel I cannot post in
    const chBad = makeChannel('cBad', { canPost: false });
    const gBad = makeGuild('BAD', [chBad]);
    i = interaction(gBad, 'on', { channel: { id: 'cBad' } }); await updates.executeSlashUpdates(i);
    check('unusable channel refused', /❌/.test(i._r[0].content) && !table.has('BAD'));

    // role set and cleared
    table.clear();
    i = interaction(gX, 'on', { channel: { id: 'cX' }, role: { id: 'R9' } }); await updates.executeSlashUpdates(i);
    check('role saved', table.get('X').updates_role_id === 'R9');
    i = interaction(gX, 'on', { bool: { clear_role: true } }); await updates.executeSlashUpdates(i);
    check('role cleared, channel kept', table.get('X').updates_role_id === null && table.get('X').updates_channel_id === 'cX');

    // not admin
    adminOk = false;
    i = interaction(gX, 'on', { channel: { id: 'cX' } }); await updates.executeSlashUpdates(i);
    check('non-admin refused', /Administrator/.test(i._r[0].content));
    adminOk = true;

    // ---- /announce soon: owner only
    table.clear();
    const chP = makeChannel('cP'), chQ = makeChannel('cQ');
    const gP = makeGuild('P', [chP]), gQ = makeGuild('Q', [chQ]);
    table.set('P', { guild_id: 'P', language: 'pt-br', updates_enabled: true, updates_channel_id: 'cP', updates_role_id: 'RP' });
    table.set('Q', { guild_id: 'Q', language: 'en', updates_enabled: true, updates_channel_id: 'cQ', updates_role_id: null });
    const c2 = client([gP, gQ]);
    delete process.env.BOT_OWNER_ID;
    i = interaction(gP, 'soon', { client: c2, str: { eta: 'tonight' } }, 'RANDOM'); await updates.executeSlashAnnounce(i);
    check('announce refused for non-owner', /Only the bot owner/.test(i._r[0].content) && chP.sent.length === 0);
    i = interaction(gP, 'soon', { client: c2, str: { eta: 'tonight', teaser: '' } }, 'OWNER1'); await updates.executeSlashAnnounce(i);
    check('application owner may announce', chP.sent.length === 1 && chQ.sent.length === 1 && /2 server/.test(i._r[0].content));
    check('notice follows the server language', embedData(chP.sent[0].embeds[0]).title.includes('Atualização') && embedData(chQ.sent[0].embeds[0]).title.includes('Update incoming'));
    check('notice pings only the configured role', chP.sent[0].content === '<@&RP>' && !chQ.sent[0].content);
    process.env.BOT_OWNER_ID = 'ENV9, OWNER1';
    check('BOT_OWNER_ID env takes priority', (await T.getOwnerIds(c2)).join() === 'ENV9,OWNER1');
    delete process.env.BOT_OWNER_ID;

    console.log(failed ? `\n${failed} FAILED` : '\n✅ updates OK');
    process.exit(failed ? 1 : 0);
})();