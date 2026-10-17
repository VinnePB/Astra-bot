const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

// Classic "Mee6-style" curve: the XP needed to go from `level` to `level+1`
// grows quadratically, so early levels come fast and later ones take much
// longer. xpForNextLevel(0) = 100, xpForNextLevel(10) = 1100, etc.
function xpForNextLevel(level) {
    return 5 * level * level + 50 * level + 100;
}

// Derives a level purely from a running total XP count — nothing is stored
// that can drift out of sync with this formula; user_levels.level is just a
// cache of this, recomputed every time xp changes.
function calculateLevel(totalXp) {
    let level = 0;
    let remaining = totalXp;
    // Capped at 1000 iterations as a sanity ceiling — no realistic XP total
    // gets remotely close to that many levels.
    while (remaining >= xpForNextLevel(level) && level < 1000) {
        remaining -= xpForNextLevel(level);
        level++;
    }
    return level;
}

function fillRankTemplate(template, vars) {
    return String(template)
        .replace(/\{user\}/g, vars.user)
        .replace(/\{username\}/g, vars.username)
        .replace(/\{level\}/g, vars.level)
        .replace(/\{xp\}/g, vars.xp);
}

// guild:role pairs we've already warned admins about (resets on restart)
const warnedRoles = new Set();

module.exports = {
    calculateLevel,
    xpForNextLevel,

    // --- SLASH COMMAND DATA ---
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Check your (or someone else\'s) level and XP in this server')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Whose rank to check (default: you)')
                .setRequired(false)),

    leaderboardData: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('See the top 10 members by XP in this server'),

    async executeSlashRank(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guild.id;

        try {
            const { rows } = await db.query(
                'SELECT xp, level FROM user_levels WHERE guild_id = $1 AND user_id = $2',
                [guildId, target.id]
            );
            const xp = rows[0]?.xp ? Number(rows[0].xp) : 0;
            const level = rows[0]?.level ?? 0;

            const { rows: rankRows } = await db.query(
                'SELECT COUNT(*) + 1 AS rank FROM user_levels WHERE guild_id = $1 AND xp > $2',
                [guildId, xp]
            );
            const rank = rows[0] ? parseInt(rankRows[0].rank, 10) : null;

            const currentLevelFloor = (() => {
                let total = 0;
                for (let l = 0; l < level; l++) total += xpForNextLevel(l);
                return total;
            })();
            const xpIntoLevel = xp - currentLevelFloor;
            const xpNeeded = xpForNextLevel(level);

            const embed = new EmbedBuilder()
                .setColor('#22E5FF')
                .setAuthor({ name: target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
                .addFields(
                    { name: 'Level', value: `${level}`, inline: true },
                    { name: 'Total XP', value: `${xp.toLocaleString()}`, inline: true },
                    { name: 'Rank', value: rank ? `#${rank}` : '—', inline: true },
                    { name: 'Progress to Next Level', value: `${xpIntoLevel.toLocaleString()} / ${xpNeeded.toLocaleString()} XP` }
                );

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error fetching rank:', error);
            return interaction.reply({ content: '❌ Database error while fetching rank.', ephemeral: true });
        }
    },

    async executeSlashLeaderboard(interaction) {
        const guildId = interaction.guild.id;

        try {
            const { rows } = await db.query(
                'SELECT user_id, xp, level FROM user_levels WHERE guild_id = $1 ORDER BY xp DESC LIMIT 10',
                [guildId]
            );

            if (rows.length === 0) {
                return interaction.reply({ content: 'No one has earned any XP here yet — start chatting!', ephemeral: true });
            }

            const medals = ['🥇', '🥈', '🥉'];
            const lines = await Promise.all(rows.map(async (row, i) => {
                const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
                const name = member ? member.user.username : `Unknown (${row.user_id})`;
                const prefix = medals[i] || `**${i + 1}.**`;
                return `${prefix} ${name} — Level ${row.level} (${Number(row.xp).toLocaleString()} XP)`;
            }));

            const embed = new EmbedBuilder()
                .setTitle(`🏆 ${interaction.guild.name} Leaderboard`)
                .setColor('#22E5FF')
                .setDescription(lines.join('\n'));

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error fetching leaderboard:', error);
            return interaction.reply({ content: '❌ Database error while fetching the leaderboard.', ephemeral: true });
        }
    },

    // --- MESSAGE XP AWARD ---
    // Called from index.js on every non-bot guild message. Cooldown-gated
    // per member (xp_cooldown_seconds) so repeated messages can't farm
    // levels. On a level-up, grants any milestone roles (guild_level_roles)
    // for levels <= the new level the member doesn't already hold, and
    // announces it — to levelup_channel_id if set, otherwise the channel the
    // message was sent in.
    async handleMessageXp(message) {
        try {
            const settings = await getSettings(message.guild.id);
            if (!settings || !settings.leveling_enabled) return;

            const guildId = message.guild.id;
            const userId = message.author.id;
            const cooldownMs = (settings.xp_cooldown_seconds || 60) * 1000;

            const { rows } = await db.query(
                'SELECT xp, level, last_xp_at FROM user_levels WHERE guild_id = $1 AND user_id = $2',
                [guildId, userId]
            );
            const existing = rows[0];

            if (existing && existing.last_xp_at) {
                const elapsed = Date.now() - new Date(existing.last_xp_at).getTime();
                if (elapsed < cooldownMs) return;
            }

            const xpMin = settings.xp_min || 15;
            const xpMax = settings.xp_max || 25;
            const gained = Math.floor(Math.random() * (xpMax - xpMin + 1)) + xpMin;

            const oldXp = existing ? Number(existing.xp) : 0;
            const oldLevel = existing ? existing.level : 0;
            const newXp = oldXp + gained;
            const newLevel = calculateLevel(newXp);

            await db.query(`
                INSERT INTO user_levels (guild_id, user_id, xp, level, last_xp_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (guild_id, user_id) DO UPDATE SET
                    xp = $3, level = $4, last_xp_at = NOW();
            `, [guildId, userId, newXp, newLevel]);

            if (newLevel <= oldLevel) return;

            // Level up! Grant any milestone roles earned along the way
            // (covers the rare case of multiple levels gained from one
            // message on a huge XP range), then announce once.
            try {
                const { rows: roleRows } = await db.query(
                    'SELECT level, role_id FROM guild_level_roles WHERE guild_id = $1 AND level <= $2 ORDER BY level ASC',
                    [guildId, newLevel]
                );
                for (const { role_id } of roleRows) {
                    if (!message.member.roles.cache.has(role_id)) {
                        const gave = await message.member.roles.add(role_id).then(() => true).catch(async (err) => {
                            // Usually: the reward role sits above Astra's own role, or she
                            // lacks Manage Roles. Tell admins once per role instead of
                            // failing silently (or spamming on every level-up).
                            const key = `${guildId}:${role_id}`;
                            if (warnedRoles.has(key)) return;
                            warnedRoles.add(key);
                            console.error(`❌ Could not grant level-role ${role_id} in ${guildId}:`, err.message);
                            try {
                                const { logAction } = require('./config');
                                await logAction(message.guild, `⚠️ I couldn't give <@&${role_id}> as a level reward (to ${message.author}). Move my role **above** it in Server Settings → Roles and make sure I have Manage Roles.`);
                            } catch (_) {}
                        });
                        if (gave) await require('../rolekit').giveDivider(message.member, 'levels');
                    }
                }
            } catch (roleErr) {
                console.error('❌ Error granting level-role rewards:', roleErr);
            }

            const template = settings.levelup_message || '🎉 {user} just reached **Level {level}**!';
            const text = fillRankTemplate(template, {
                user: message.author.toString(),
                username: message.author.username,
                level: newLevel,
                xp: newXp
            });

            const targetChannel = settings.levelup_channel_id
                ? await message.guild.channels.fetch(settings.levelup_channel_id).catch(() => null)
                : message.channel;

            if (targetChannel && targetChannel.isTextBased()) {
                await targetChannel.send(text).catch(() => {});
            }
        } catch (error) {
            console.error('❌ Error handling message XP:', error);
        }
    }
};