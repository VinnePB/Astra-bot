// Run: node test-tickets.js   (no Discord, database or network needed)
const assert = require('assert');
const Module = require('module');

const chain = new Proxy(function () {}, { get: (t, p) => (p === 'toJSON' ? () => ({}) : chain), apply: () => chain, construct: () => chain });
const fakeDiscord = {
    SlashCommandBuilder: function () { return chain; }, EmbedBuilder: function () { return chain; },
    ActionRowBuilder: function () { return chain; }, ButtonBuilder: function () { return chain; },
    StringSelectMenuBuilder: function () { return chain; }, ModalBuilder: function () { return chain; }, TextInputBuilder: function () { return chain; },
    AttachmentBuilder: function (b, o) { this.buffer = b; this.name = o.name; }, ButtonStyle: {}, TextInputStyle: {}, ChannelType: {}, PermissionFlagsBits: { Administrator: 8n },
};

// One ticket row, kept in memory.
let ticket;
const log = [];
const STAFF_ROLE = '700000000000000007';
const ownerDms = [];
const fakeDb = {
    async query(sql, p = []) {
        if (/^SELECT \* FROM tickets WHERE channel_id/.test(sql)) return { rows: ticket && ticket.channel_id === p[0] ? [{ ...ticket }] : [] };
        if (/^SELECT ticket_staff_role_id/.test(sql)) return { rows: [{ ticket_staff_role_id: STAFF_ROLE }] };
        if (/^UPDATE tickets SET staff_called/.test(sql)) { if (ticket) ticket.staff_called = true; return { rows: [] }; }
        if (/^SELECT log_channel_id/.test(sql)) return { rows: [] };
        if (/^SELECT language/.test(sql) || /FROM guild_settings/.test(sql)) return { rows: [{ language: 'en' }] };
        if (/^UPDATE tickets SET close_reason/.test(sql)) { Object.assign(ticket, { close_reason: p[1], close_requested_at: new Date(), close_message_id: p[2], close_denied_at: null }); return { rows: [] }; }
        if (/^UPDATE tickets SET close_message_id = NULL/.test(sql)) { Object.assign(ticket, { close_message_id: null, close_requested_at: null, close_denied_at: new Date() }); return { rows: [] }; }
        if (/^DELETE FROM tickets WHERE channel_id/.test(sql)) { log.push('deleted'); ticket = null; return { rows: [] }; }
        return { rows: [] };
    },
};
const orig = Module._load;
Module._load = function (req, parent, ...a) {
    if (req === 'discord.js') return fakeDiscord;
    if (req === 'dotenv') return { config() {} };
    if (/(^|\/)database$/.test(req)) return fakeDb;
    if (/(^|\/)permissions$/.test(req)) return { isAstraAdmin: async (m) => !!(m && (m.astraAdmin || m.sadmin)), isServerAdministrator: async (m) => !!(m && m.sadmin) };
    if (/(^|\/)config$/.test(req)) return { logAction: async () => {} };
    return orig.call(this, req, parent, ...a);
};
const tickets = require('./commands/tickets');

const CH = '900000000000000001', OPENER = '100000000000000001', ARTIST = '200000000000000002', ADMIN = '300000000000000003', OTHER = '400000000000000004';
const mkTicket = () => ({ channel_id: CH, guild_id: 'g1', user_id: OPENER, artist_id: ARTIST, close_reason: null, close_requested_at: null, close_message_id: null, close_denied_at: null });
const guild = { id: 'g1', name: 'Guild One', fetchOwner: async () => ({ send: async (o) => { ownerDms.push(o); } }), channels: { fetch: async () => ({ name: 'ticket-x', delete: async () => {}, send: async () => {} }) } };
const member = (id, admin = false, extra = {}) => ({ id, sadmin: admin, astraAdmin: !!extra.astraAdmin, roles: { cache: { has: (r) => (extra.roles || []).includes(r) } } });

// A fake interaction that records what the bot did.
function inter(userId, extra = {}) {
    const out = { replies: [], sent: [], updated: null, modal: false };
    return Object.assign({
        out, guild, user: { id: userId, toString: () => `<@${userId}>` }, member: member(userId, userId === ADMIN),
        channel: { id: CH, send: async (o) => { out.sent.push(o); return { id: 'MSG1' }; } },
        message: { id: 'MSG1' }, fields: { getTextInputValue: () => extra.reason || '' },
        reply: async (o) => { out.replies.push(o); }, update: async (o) => { out.updated = o; }, showModal: async () => { out.modal = true; },
    }, extra);
}

(async () => {
    // --- direct close: only the artist or an admin
    ticket = mkTicket();
    let r = await tickets._test.close(guild, CH, { id: OPENER }, { member: member(OPENER) });
    assert.ok(!r.ok && /artist or an admin/.test(r.message), 'the opener cannot close it');
    assert.ok(ticket, 'ticket still there');
    r = await tickets._test.close(guild, CH, { id: OTHER }, { member: member(OTHER) });
    assert.ok(!r.ok, 'a stranger cannot close it');
    r = await tickets._test.close(guild, CH, { id: ARTIST }, { member: member(ARTIST) });
    assert.ok(r.ok && ticket === null, 'the artist can close it');
    ticket = mkTicket();
    r = await tickets._test.close(guild, CH, { id: ADMIN }, { member: member(ADMIN, true) });
    assert.ok(r.ok, 'the server owner / a Discord Administrator can close it');
    ticket = mkTicket();
    r = await tickets._test.close(guild, CH, { id: OTHER }, { member: member(OTHER, false, { astraAdmin: true }) });
    assert.ok(!r.ok && ticket, 'an Astra Admin role on its own can NOT close a ticket');
    r = await tickets._test.close(guild, CH, { id: OTHER }, { member: member(OTHER, false, { roles: [STAFF_ROLE] }) });
    assert.ok(r.ok, 'a member of the ticket staff role can close it');
    ownerDms.length = 0;
    ticket = mkTicket();
    await tickets._test.close(guild, CH, { id: ARTIST, username: 'artist' }, { member: member(ARTIST) });
    assert.ok(ownerDms.some((o) => /Ticket closed/.test(o.content)), 'the server owner gets the log by DM');

    // --- the opener's request
    ticket = mkTicket();
    let i = inter(OPENER, { reason: 'too short' });
    await tickets._test.requestClose(i, 'nope');
    assert.ok(/at least 10/.test(i.out.replies[0].content) && !ticket.close_message_id, 'a tiny reason is refused');
    i = inter(OTHER);
    await tickets._test.requestClose(i, 'I am not the opener but typed a long reason');
    assert.ok(!ticket.close_message_id, 'only the opener can ask');
    i = inter(OPENER);
    await tickets._test.requestClose(i, 'I changed my mind about the commission, sorry');
    assert.ok(ticket.close_message_id === 'MSG1' && ticket.close_reason.startsWith('I changed my mind'), 'request saved');
    assert.strictEqual(i.out.sent.length, 1, 'the artist is asked in the channel');
    assert.deepStrictEqual(i.out.sent[0].allowedMentions, { users: [ARTIST] }, 'only the artist is pinged');
    i = inter(OPENER);
    await tickets._test.requestClose(i, 'asking a second time while one is pending');
    assert.ok(/already waiting/.test(i.out.replies[0].content) && i.out.sent.length === 0, 'no second request while one waits');

    // --- the answer
    i = inter(OPENER);
    await tickets._test.answer(i, true);
    assert.ok(ticket && /Only the ticket/.test(i.out.replies[0].content), 'the opener cannot approve their own request');
    i = inter(OTHER);
    await tickets._test.answer(i, true);
    assert.ok(ticket, 'a stranger cannot approve');
    i = inter(ARTIST, { message: { id: 'OLDER' } });
    await tickets._test.answer(i, true);
    assert.ok(ticket && /no longer active/.test(i.out.replies[0].content), 'a stale button does nothing');

    // keep open -> cooldown for the opener
    i = inter(ARTIST);
    await tickets._test.answer(i, false);
    assert.ok(ticket && !ticket.close_message_id && ticket.close_denied_at, 'declined: ticket stays, request cleared');
    i = inter(OPENER);
    await tickets._test.requestClose(i, 'trying again right after being declined');
    assert.ok(/minute/.test(i.out.replies[0].content) && i.out.sent.length === 0, 'the opener has to wait after a decline');
    ticket.close_denied_at = new Date(Date.now() - 11 * 60 * 1000);
    i = inter(OPENER);
    await tickets._test.requestClose(i, 'asking again after the waiting time');
    assert.ok(ticket.close_message_id, 'after the wait the opener can ask again');

    // approve -> closed
    log.length = 0;
    i = inter(ADMIN);
    await tickets._test.answer(i, true);
    assert.ok(ticket === null && log.includes('deleted'), 'an admin approves and the ticket closes');
    // --- middleman: only the two parties can call the ticket staff, once, and only then does the role see the ticket
    {
        ticket = mkTicket();
        const edits = [];
        const mmInter = (uid) => { const i = inter(uid); i.channel.permissionOverwrites = { edit: async (role, perms) => { edits.push({ role, perms }); } };
            i.guild = { ...guild, roles: { cache: new Map([[STAFF_ROLE, { id: STAFF_ROLE }]]) } }; return i; };
        let i = mmInter(OTHER);
        await tickets._test.callMiddleman(i);
        assert.ok(edits.length === 0 && !ticket.staff_called, 'a stranger cannot call the middleman');
        i = mmInter(OPENER);
        await tickets._test.callMiddleman(i);
        assert.strictEqual(edits.length, 1, 'the opener can call the middleman');
        assert.strictEqual(edits[0].role.id, STAFF_ROLE);
        assert.ok(edits[0].perms.ViewChannel && edits[0].perms.SendMessages, 'the role is let into this one ticket');
        assert.deepStrictEqual(i.out.replies[0].allowedMentions, { roles: [STAFF_ROLE] }, 'only the staff role is pinged');
        i = mmInter(ARTIST);
        await tickets._test.callMiddleman(i);
        assert.strictEqual(edits.length, 1, 'only once per ticket');
    }

    // --- transcript: a text copy of the conversation goes privately to the artist
    {
        const mkMsg = (id, ts, name, uid, text, extra = {}) => ({ id, createdTimestamp: ts, member: { displayName: name }, author: { id: uid, username: name }, cleanContent: text, content: text, system: false, attachments: new Map(), embeds: [], ...extra });
        const t0 = Date.UTC(2026, 9, 17, 22, 0);
        const msgs = [
            mkMsg('3', t0 + 120000, 'Artist', ARTIST, 'Sure, it is 40.\nSecond line'),
            mkMsg('1', t0, 'Opener', OPENER, 'Hi, can I get a bust?'),
            mkMsg('2', t0 + 60000, 'Opener', OPENER, '', { attachments: new Map([['a', { name: 'ref.png', url: 'https://cdn.example/ref.png' }]]) }),
            mkMsg('4', t0 + 130000, 'Astra', 'BOT', '', { system: true }),
        ];
        const mkChannel = (all) => ({ name: 'ticket-opener', delete: async () => {}, send: async () => {},
            messages: { fetch: async ({ before }) => { const sorted = [...all].sort((a, b) => b.createdTimestamp - a.createdTimestamp); const list = before ? sorted.filter((m) => m.createdTimestamp < all.find((x) => x.id === before).createdTimestamp) : sorted; const page = list.slice(0, 100); const c = new Map(page.map((m) => [m.id, m])); c.last = () => page[page.length - 1]; return c; } } });
        const tk = { ...mkTicket(), created_at: new Date(t0 - 60000), close_reason: 'all done here, thanks' };
        const out = await tickets._test.buildTranscript(mkChannel(msgs), tk, { guild: { name: 'Guild One' }, closedBy: { username: 'artist' } });
        const lines = out.text.split('\n');
        assert.strictEqual(out.count, 3, 'system messages are left out');
        assert.ok(/Ticket transcript - #ticket-opener/.test(out.text) && /Server: Guild One/.test(out.text) && /Close reason: all done here/.test(out.text), 'header');
        const iHi = lines.findIndex((l) => /Hi, can I get a bust/.test(l)), iSure = lines.findIndex((l) => /Sure, it is 40/.test(l));
        assert.ok(iHi > 0 && iSure > iHi, 'oldest first');
        assert.ok(/\[attachment\] ref\.png https:\/\/cdn\.example\/ref\.png/.test(out.text), 'attachments are listed');
        assert.ok(lines[iSure + 1].startsWith('    Second line'), 'multi-line messages stay readable');

        // closing: the artist gets the file in a DM; if DMs are closed it falls back to the log channel
        const dmFiles = [], logFiles = [];
        const ownerFiles = [];
        const g2 = { id: 'g1', name: 'Guild One', fetchOwner: async () => ({ send: async (o) => { ownerFiles.push(o); } }), client: { users: { fetch: async () => ({ send: async (o) => { dmFiles.push(o); } }) } },
            channels: { fetch: async (id) => (id === 'LOG' ? { send: async (o) => { logFiles.push(o); } } : mkChannel(msgs)) } };
        const dbq = fakeDb.query; fakeDb.query = async (sql, p) => (/^SELECT log_channel_id/.test(sql) ? { rows: [{ log_channel_id: 'LOG' }] } : dbq(sql, p));
        ticket = { ...mkTicket(), created_at: new Date(t0) };
        let r2 = await tickets._test.close(g2, CH, { id: ARTIST, username: 'artist' }, { member: member(ARTIST) });
        assert.ok(r2.ok && dmFiles.length === 1, 'artist received the transcript in a DM');
        assert.ok(dmFiles[0].files[0].name.endsWith('.txt') && /Hi, can I get a bust/.test(dmFiles[0].files[0].buffer.toString()), 'it is a text file with the chat');
        assert.ok(!logFiles.some((o) => o.files) && !ownerFiles.some((o) => o.files), 'nobody else gets the file when the artist DM works');

        g2.client.users.fetch = async () => ({ send: async () => { throw new Error('Cannot send messages to this user'); } });
        ticket = { ...mkTicket(), created_at: new Date(t0) };
        r2 = await tickets._test.close(g2, CH, { id: ARTIST, username: 'artist' }, { member: member(ARTIST) });
        assert.ok(r2.ok && ownerFiles.some((o) => o.files), 'DMs closed: the transcript goes to the server owner instead');
        assert.ok(!logFiles.some((o) => o.files), 'and never to the log channel, which staff can read');

        // a failure while reading the channel never stops the ticket from closing
        const broken = { ...mkChannel(msgs), messages: { fetch: async () => { throw new Error('boom'); } } };
        g2.channels.fetch = async (id) => (id === 'LOG' ? { send: async () => {} } : broken);
        ticket = { ...mkTicket(), created_at: new Date(t0) };
        r2 = await tickets._test.close(g2, CH, { id: ARTIST, username: 'artist' }, { member: member(ARTIST) });
        assert.ok(r2.ok && ticket === null, 'closing still works if the transcript cannot be built');
        fakeDb.query = dbq;
    }

    console.log('✅ tickets OK');
})().catch((e) => { console.error('❌', e); process.exit(1); });