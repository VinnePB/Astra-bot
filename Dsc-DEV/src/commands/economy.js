const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

async function getSettings(guildId) {
    const { rows } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return rows[0] || null;
}

async function getAccount(guildId, userId) {
    const { rows } = await db.query('SELECT * FROM user_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    return rows[0] || { guild_id: guildId, user_id: userId, balance: 0, daily_streak: 0, last_daily_at: null };
}

// Makes sure the member has a balance row so atomic UPDATEs have something to hit.
async function ensureAccount(guildId, userId) {
    await db.query('INSERT INTO user_economy (guild_id, user_id, balance) VALUES ($1, $2, 0) ON CONFLICT (guild_id, user_id) DO NOTHING', [guildId, userId]);
}

// Consecutive-day streak bonus is capped so it can't grow forever — 10
// days in, the bonus is maxed out and /daily just pays the flat base rate
// plus that ceiling from then on.
const MAX_STREAK_BONUS_DAYS = 10;

module.exports = {
    // --- SLASH COMMAND DATA ---
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your (or someone else\'s) currency balance')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Whose balance to check (default: you)')
                .setRequired(false)),

    dailyData: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily currency reward'),

    payData: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Send some of your currency to another member')
        .addUserOption(option => option.setName('user').setDescription('Who to pay').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('How much to send').setMinValue(1).setRequired(true)),

    richestData: new SlashCommandBuilder()
        .setName('richest')
        .setDescription('See the top 10 richest members in this server'),

    async executeSlashBalance(interaction) {
        const settings = await getSettings(interaction.guild.id);
        if (!settings || !settings.economy_enabled) {
            return interaction.reply({ content: '❌ The economy system isn\'t enabled on this server.', ephemeral: true });
        }

        const target = interaction.options.getUser('user') || interaction.user;
        const currencyName = settings.currency_name || 'Coins';
        const currencySymbol = settings.currency_symbol || '🪙';

        try {
            const account = await getAccount(interaction.guild.id, target.id);
            const embed = new EmbedBuilder()
                .setColor('#22E5FF')
                .setAuthor({ name: target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
                .setDescription(`${currencySymbol} **${Number(account.balance).toLocaleString()}** ${currencyName}`);
            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error fetching balance:', error);
            return interaction.reply({ content: '❌ Database error while fetching the balance.', ephemeral: true });
        }
    },

    async executeSlashDaily(interaction) {
        const settings = await getSettings(interaction.guild.id);
        if (!settings || !settings.economy_enabled) {
            return interaction.reply({ content: '❌ The economy system isn\'t enabled on this server.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const currencyName = settings.currency_name || 'Coins';
        const currencySymbol = settings.currency_symbol || '🪙';

        try {
            await ensureAccount(guildId, userId);
            const dailyMin = settings.daily_min || 50;
            const dailyMax = settings.daily_max || 150;
            const base = Math.floor(Math.random() * (dailyMax - dailyMin + 1)) + dailyMin;
            const perDay = settings.daily_streak_bonus || 10;

            // One atomic statement: the 24h check, the streak and the payout all
            // happen together, so two simultaneous /daily can never both pay out.
            const { rows } = await db.query(`
                UPDATE user_economy SET
                    daily_streak = CASE WHEN last_daily_at IS NOT NULL AND last_daily_at > NOW() - INTERVAL '48 hours'
                                        THEN daily_streak + 1 ELSE 1 END,
                    balance = balance + $3 + LEAST(
                        (CASE WHEN last_daily_at IS NOT NULL AND last_daily_at > NOW() - INTERVAL '48 hours'
                              THEN daily_streak + 1 ELSE 1 END) - 1, $4) * $5,
                    last_daily_at = NOW()
                WHERE guild_id = $1 AND user_id = $2
                  AND (last_daily_at IS NULL OR last_daily_at <= NOW() - INTERVAL '24 hours')
                RETURNING balance, daily_streak
            `, [guildId, userId, base, MAX_STREAK_BONUS_DAYS, perDay]);

            if (rows.length === 0) {
                const { rows: cur } = await db.query('SELECT last_daily_at FROM user_economy WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
                const remaining = Math.max(0, 24 * 60 * 60 * 1000 - (Date.now() - new Date(cur[0].last_daily_at).getTime()));
                const hours = Math.floor(remaining / (60 * 60 * 1000));
                const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
                return interaction.reply({ content: `⏱️ You already claimed today's reward. Try again in **${hours}h ${minutes}m**.`, ephemeral: true });
            }

            const account = { daily_streak: Number(rows[0].daily_streak) };
            const newBalance = Number(rows[0].balance);
            const streakBonus = Math.min(account.daily_streak - 1, MAX_STREAK_BONUS_DAYS) * perDay;
            const total = base + streakBonus;

            const embed = new EmbedBuilder()
                .setColor('#22E5FF')
                .setTitle('💰 Daily Reward Claimed!')
                .setDescription(
                    `You got ${currencySymbol} **${total.toLocaleString()}** ${currencyName}` +
                    (streakBonus > 0 ? ` (${base} base + ${streakBonus} streak bonus)` : '') +
                    `.\n🔥 Streak: **${account.daily_streak}** day${account.daily_streak === 1 ? '' : 's'}` +
                    `\n${currencySymbol} New balance: **${newBalance.toLocaleString()}**`
                );
            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error claiming daily reward:', error);
            return interaction.reply({ content: '❌ Database error while claiming the reward.', ephemeral: true });
        }
    },

    async executeSlashPay(interaction) {
        const settings = await getSettings(interaction.guild.id);
        if (!settings || !settings.economy_enabled) {
            return interaction.reply({ content: '❌ The economy system isn\'t enabled on this server.', ephemeral: true });
        }

        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const currencyName = settings.currency_name || 'Coins';
        const currencySymbol = settings.currency_symbol || '🪙';

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: '❌ You can\'t pay yourself.', ephemeral: true });
        }
        if (target.bot) {
            return interaction.reply({ content: '❌ You can\'t pay a bot.', ephemeral: true });
        }

        try {
            await ensureAccount(interaction.guild.id, interaction.user.id);
            await ensureAccount(interaction.guild.id, target.id);

            // Take from the sender only if they can afford it, and give to the
            // receiver, in one transaction: no double-spend, no lost coins.
            const conn = await db.pool.connect();
            let paid = false, senderBalance = 0;
            try {
                await conn.query('BEGIN');
                const take = await conn.query(
                    'UPDATE user_economy SET balance = balance - $3 WHERE guild_id = $1 AND user_id = $2 AND balance >= $3 RETURNING balance',
                    [interaction.guild.id, interaction.user.id, amount]
                );
                if (take.rows.length) {
                    await conn.query('UPDATE user_economy SET balance = balance + $3 WHERE guild_id = $1 AND user_id = $2', [interaction.guild.id, target.id, amount]);
                    paid = true; senderBalance = Number(take.rows[0].balance);
                }
                await conn.query(paid ? 'COMMIT' : 'ROLLBACK');
            } catch (e) {
                await conn.query('ROLLBACK').catch(() => {});
                throw e;
            } finally { conn.release(); }

            if (!paid) {
                const sender = await getAccount(interaction.guild.id, interaction.user.id);
                return interaction.reply({ content: `❌ You don't have enough ${currencyName}. Your balance: ${currencySymbol} ${Number(sender.balance).toLocaleString()}.`, ephemeral: true });
            }

            return interaction.reply({ content: `✅ Sent ${currencySymbol} **${amount.toLocaleString()}** ${currencyName} to ${target}.` });
        } catch (error) {
            console.error('❌ Error processing payment:', error);
            return interaction.reply({ content: '❌ Database error while processing the payment.', ephemeral: true });
        }
    },

    async executeSlashRichest(interaction) {
        const settings = await getSettings(interaction.guild.id);
        if (!settings || !settings.economy_enabled) {
            return interaction.reply({ content: '❌ The economy system isn\'t enabled on this server.', ephemeral: true });
        }

        const currencyName = settings.currency_name || 'Coins';
        const currencySymbol = settings.currency_symbol || '🪙';

        try {
            const { rows } = await db.query(
                'SELECT user_id, balance FROM user_economy WHERE guild_id = $1 ORDER BY balance DESC LIMIT 10',
                [interaction.guild.id]
            );

            if (rows.length === 0) {
                return interaction.reply({ content: 'No one has any balance here yet — try `/daily`!', ephemeral: true });
            }

            const medals = ['🥇', '🥈', '🥉'];
            const lines = await Promise.all(rows.map(async (row, i) => {
                const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
                const name = member ? member.user.username : `Unknown (${row.user_id})`;
                const prefix = medals[i] || `**${i + 1}.**`;
                return `${prefix} ${name} — ${currencySymbol} ${Number(row.balance).toLocaleString()}`;
            }));

            const embed = new EmbedBuilder()
                .setTitle(`💰 ${interaction.guild.name}'s Richest`)
                .setColor('#22E5FF')
                .setDescription(lines.join('\n'))
                .setFooter({ text: currencyName });

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error fetching richest list:', error);
            return interaction.reply({ content: '❌ Database error while fetching the leaderboard.', ephemeral: true });
        }
    }
};