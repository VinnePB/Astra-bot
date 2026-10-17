// Run: node test-moderation.js  (no Discord or database needed)
const assert = require('assert');
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...a) {
    if (req === 'discord.js') {
        const chain = new Proxy(function () {}, { get: (t, p) => (p === 'toJSON' ? () => ({}) : chain), apply: () => chain });
        return { SlashCommandBuilder: function () { return chain; }, EmbedBuilder: function () { return chain; }, ChannelType: {}, PermissionFlagsBits: new Proxy({}, { get: (t, p) => BigInt(String(p).length) }) };
    }
    if (req === '../database') return { query: async () => ({ rows: [] }) };
    return orig.call(this, req, ...a);
};
const { _test: m } = require('./commands/moderation');

// durations
assert.strictEqual(m.parseDuration('10m'), 600000);
assert.strictEqual(m.parseDuration('2h'), 7200000);
assert.strictEqual(m.parseDuration('1w'), 604800000);
assert.strictEqual(m.parseDuration('28d'), 28 * 864e5);
assert.strictEqual(m.parseDuration('29d'), null);
assert.strictEqual(m.parseDuration('0m'), null);
assert.strictEqual(m.parseDuration('abc'), null);
assert.strictEqual(m.parseDuration('-5m'), null);
assert.strictEqual(m.parseDuration(''), null);

// escalation: only on equal counts, ban > kick > timeout
const s = { mod_warn_timeout_at: 3, mod_warn_timeout_min: 30, mod_warn_kick_at: 5, mod_warn_ban_at: 7 };
assert.strictEqual(m.escalationFor(2, s), null);
assert.deepStrictEqual(m.escalationFor(3, s), { action: 'timeout', minutes: 30 });
assert.strictEqual(m.escalationFor(4, s), null);
assert.deepStrictEqual(m.escalationFor(5, s), { action: 'kick' });
assert.deepStrictEqual(m.escalationFor(7, s), { action: 'ban' });
assert.strictEqual(m.escalationFor(8, s), null);
assert.strictEqual(m.escalationFor(3, { mod_warn_timeout_at: null }), null);
assert.strictEqual(m.escalationFor(1, null), null);
assert.deepStrictEqual(m.escalationFor(3, { mod_warn_timeout_at: 3, mod_warn_kick_at: 3 }), { action: 'kick' });

// target safety
const role = (pos) => ({ position: pos });
const mem = (id, pos) => ({ id, roles: { highest: role(pos) } });
const guild = (ownerId, botPos) => ({ ownerId, members: { me: mem('BOT', botPos) } });
const run = (g, mod, target, tu) => m.targetProblem({ guild: g, moderator: mod, target, targetUser: tu, botId: 'BOT' });
const g = guild('OWNER', 10);
assert.ok(run(g, mem('M', 5), mem('M', 5), { id: 'M' }), 'self');
assert.ok(run(g, mem('M', 5), mem('BOT', 10), { id: 'BOT' }), 'bot itself');
assert.ok(run(g, mem('M', 5), mem('OWNER', 20), { id: 'OWNER' }), 'owner');
assert.ok(run(g, mem('M', 5), mem('T', 5), { id: 'T' }), 'equal role');
assert.ok(run(g, mem('M', 5), mem('T', 7), { id: 'T' }), 'higher role');
assert.ok(run(g, mem('M', 9), mem('T', 10), { id: 'T' }), 'bot cannot reach');
assert.strictEqual(run(g, mem('M', 9), mem('T', 3), { id: 'T' }), null, 'normal case is allowed');
assert.strictEqual(run(g, mem('OWNER', 1), mem('T', 3), { id: 'T' }), null, 'owner exempt from rank rule');
assert.ok(run(g, mem('OWNER', 99), mem('T', 10), { id: 'T' }), 'bot role still has to be higher, even for owner');
assert.strictEqual(run(g, mem('M', 5), null, { id: 'GONE' }), null, 'absent user (ban by id)');
assert.ok(run(g, mem('M', 5), null, { id: 'M' }), 'absent but self');

// reason cleaning
assert.strictEqual(m.cleanReason('  hi   there \n x '), 'hi there x');
assert.strictEqual(m.cleanReason('   '), null);
assert.strictEqual(m.cleanReason('a'.repeat(900)).length, 400);
console.log('✅ moderation OK');