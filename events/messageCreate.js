const { Events } = require("discord.js");
const db = require("../db");

const TARGET_ROLES = ["857990235194261514", "913864890916147270"];

// Cache to prevent DB spam: userId -> "YYYY-MM-DD"
const lastActivityCache = new Map();

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // 1. Ignore bots and DMs
        if (!message.guild || message.author.bot) return;

        // 2. Role Check
        const hasRole =
            message.member &&
            TARGET_ROLES.some((roleId) =>
                message.member.roles.cache.has(roleId)
            );

        // If not staff, we don't care about tracking them
        if (!hasRole) return;

        // --- General Activity Tracking (Once per day) ---
        const userId = message.author.id;
        const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

        if (lastActivityCache.get(userId) !== today) {
            try {
                // Upsert: Try to update today's activity, if row doesn't exist, insert
                await db.query(
                    `INSERT INTO moderation.activity (user_id, last_seen)
                     VALUES ($1, NOW())
                     ON CONFLICT (user_id) 
                     DO UPDATE SET last_seen = NOW()`,
                    [userId]
                );

                // Update Cache
                lastActivityCache.set(userId, today);
            } catch (err) {
                console.error(`[Activity Error] Could not log activity for ${userId}:`, err);
            }
        }
    },
};

