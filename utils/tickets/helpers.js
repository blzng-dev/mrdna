const CONFIG = require("../ticketConfig");
const { findEmojiByNameOrId } = require("../emojiResolver");

/**
 * Resolves an emoji name dynamically for a button via findEmojiByNameOrId
 */
async function resolveButtonEmoji(client, emojiName) {
    if (!emojiName) return null;
    try {
        const found = await findEmojiByNameOrId(client, emojiName);
        if (found?.id) {
            return { id: found.id, name: found.name || emojiName, animated: Boolean(found.animated) };
        }
    } catch (_) {}
    return null;
}

/**
 * Resolves a forum tag ID by matching tag name against available forum tags
 */
function resolveTagId(forumChannel, tagName) {
    if (!forumChannel || !forumChannel.availableTags) return null;
    const tag = forumChannel.availableTags.find(
        (t) => t.name.toLowerCase() === tagName.toLowerCase() || t.id === tagName,
    );
    return tag ? tag.id : null;
}

/**
 * Checks if a member has staff permissions
 */
function isStaff(member) {
    if (!member) return false;
    if (member.permissions.has("Administrator")) return true;
    return CONFIG.STAFF_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Sanitizes channel name for Discord: lowercase, alphanumeric and dashes, max 100 chars
 */
function sanitizeChannelName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 100);
}

/**
 * Formats a Discord timestamp string: "Tuesday, 8 September 2026 at 05:30 (a month ago)"
 */
function formatDiscordTimestamp(timestampMs) {
    const sec = Math.floor(timestampMs / 1000);
    return `<t:${sec}:f> (<t:${sec}:R>)`;
}

/**
 * Formats standard Discord timestamp line for logs: -# <t:timestamp:R> <t:timestamp:t> <t:timestamp:d>
 */
function formatLogTimestampLine(timestampMs = Date.now()) {
    const sec = Math.floor(timestampMs / 1000);
    return `-# <t:${sec}:R> <t:${sec}:t> <t:${sec}:d>`;
}

/**
 * Builds a post URL for a forum thread
 */
function buildPostUrl(guildId, forumId, threadId) {
    return `https://discord.com/channels/${guildId}/${forumId}/${threadId}`;
}

/**
 * Helper to get ticket creator ID from channel name: ticket-{username}-{userid}
 */
function getChannelCreatorId(channel) {
    if (!channel) return null;
    if (channel.topic) {
        const topicMatch = channel.topic.match(/author:\s*(\d{17,20})/i);
        if (topicMatch) return topicMatch[1];
    }
    if (channel.name) {
        const match = channel.name.match(/ticket-.*-(\d{17,20})$/);
        if (match) return match[1];
    }
    if (channel.permissionOverwrites?.cache) {
        for (const [id, overwrite] of channel.permissionOverwrites.cache) {
            if (overwrite.type !== 1) continue; // 1 = Member
            if (id === channel.client.user.id) continue;
            const member = channel.guild?.members?.cache?.get(id);
            if (member && (member.user.bot || isStaff(member))) continue;
            if (overwrite.allow.has("ViewChannel")) return id;
        }
    }
    return null;
}

/**
 * Helper to get staff ID that claimed/created the ticket channel from topic
 */
function getChannelStaffId(channel) {
    if (!channel || !channel.topic) return null;
    const match = channel.topic.match(/staff:\s*(\d{17,20})/i);
    return match ? match[1] : null;
}

/**
 * Helper to get ticket forum thread ID from channel topic or description
 */
function getChannelThreadId(channel) {
    if (!channel || !channel.topic) return null;
    const match = channel.topic.match(/thread:\s*(\d{17,20})/i) ||
        channel.topic.match(/^(\d{17,20})/) ||
        channel.topic.match(/(\d{17,20})/);
    return match ? match[1] : null;
}

/**
 * Helper to get all non-staff member IDs associated with a ticket channel
 */
function getChannelAddedMemberIds(channel) {
    const memberIds = new Set();
    const creatorId = getChannelCreatorId(channel);
    if (creatorId) memberIds.add(creatorId);

    if (channel.permissionOverwrites?.cache) {
        for (const [id, overwrite] of channel.permissionOverwrites.cache) {
            if (overwrite.type !== 1) continue; // 1 = Member
            if (id === channel.client.user.id) continue;
            const member = channel.guild.members.cache.get(id);
            if (member && isStaff(member)) continue;
            memberIds.add(id);
        }
    }
    return Array.from(memberIds);
}

function isChannelClosed(channel) {
    const creatorId = getChannelCreatorId(channel);
    if (creatorId) {
        const creatorOverwrite = channel.permissionOverwrites.cache.get(creatorId);
        return Boolean(!creatorOverwrite || !creatorOverwrite.allow.has("ViewChannel"));
    }
    const memberIds = getChannelAddedMemberIds(channel);
    if (memberIds.length === 0) return false;
    const firstOverwrite = channel.permissionOverwrites.cache.get(memberIds[0]);
    return Boolean(!firstOverwrite || !firstOverwrite.allow.has("ViewChannel"));
}

function isChannelLocked(channel) {
    const creatorId = getChannelCreatorId(channel);
    if (creatorId) {
        const creatorOverwrite = channel.permissionOverwrites.cache.get(creatorId);
        return Boolean(creatorOverwrite && creatorOverwrite.deny.has("SendMessages"));
    }
    const memberIds = getChannelAddedMemberIds(channel);
    if (memberIds.length === 0) return false;
    const firstOverwrite = channel.permissionOverwrites.cache.get(memberIds[0]);
    return Boolean(firstOverwrite && firstOverwrite.deny.has("SendMessages"));
}

/**
 * Formats a user mention line: <@id> `@username` (DisplayName)
 */
function formatUserMentionLine(user) {
    if (!user) return "";
    const id = typeof user === "string" ? user : user.id;
    if (!id) return "";

    const username = typeof user === "object" ? user.username : null;
    const displayName = typeof user === "object" ? (user.displayName || user.nickname || user.globalName || user.name) : null;

    if (username && displayName) {
        return `<@${id}> \`@${username.replace(/^@/, "")}\` (${displayName})`;
    } else if (username) {
        return `<@${id}> \`@${username.replace(/^@/, "")}\` (${username})`;
    } else if (displayName) {
        return `<@${id}> \`@${displayName.toLowerCase().replace(/\s+/g, "")}\` (${displayName})`;
    }
    return `<@${id}>`;
}

module.exports = {
    resolveTagId,
    isStaff,
    sanitizeChannelName,
    formatDiscordTimestamp,
    formatLogTimestampLine,
    buildPostUrl,
    getChannelCreatorId,
    getChannelStaffId,
    getChannelThreadId,
    getChannelAddedMemberIds,
    isChannelClosed,
    isChannelLocked,
    resolveButtonEmoji,
    formatUserMentionLine,
};
