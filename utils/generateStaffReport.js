const { AttachmentBuilder } = require("discord.js");
const db = require("../db");

const MOD_ROLES = ["857990235194261514", "913864890916147270"];

function getDaysAgo(dateInfo) {
    if (!dateInfo) return "Never";
    const date = new Date(dateInfo);
    const now = new Date();
    // Reset times to midnight for accurate "day" calculation? 
    // Or just simple 24h diff?
    // User asked for "today", "1 day ago". 
    // Usually "Today" means same calendar day.

    const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return `${diffDays} days ago`;
}

module.exports = async function generateStaffReport(client, guildId, lookbackDays = 14, specificUser = null) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { error: "Guild not found" };

    await guild.members.fetch().catch(console.error);
    // Filter for CURRENT staff only
    let staffMembers = guild.members.cache.filter((member) =>
        MOD_ROLES.some((roleId) => member.roles.cache.has(roleId)) && !member.user.bot
    );

    if (specificUser) {
        staffMembers = staffMembers.filter((member) => member.id === specificUser.id);
        if (staffMembers.size === 0) {
            return { error: `User ${specificUser.tag || specificUser.username} is not a current staff member.` };
        }
    }

    if (staffMembers.size === 0) return { error: "No staff members found." };

    const staffIds = staffMembers.map(m => m.id);

    // 1. User Activity (Last Message)
    const activityRes = await db.query(
        `SELECT user_id, last_seen FROM moderation.activity WHERE user_id = ANY($1::text[])`,
        [staffIds]
    );

    const reportData = { active: {}, inactive: {} };
    const activeMentions = [];
    const inactiveMentions = [];

    staffMembers.forEach(member => {
        const userId = member.id;
        const username = member.user.username;

        const activityRecord = activityRes.rows.find(r => r.user_id === userId);
        const lastSeenDate = activityRecord ? activityRecord.last_seen : null;
        
        const daysAgo = getDaysAgo(lastSeenDate);
        
        // Check if active (seen within lookbackDays)
        let isActive = false;
        if (lastSeenDate) {
            const now = new Date();
            const diffTime = Math.abs(now - new Date(lastSeenDate));
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            isActive = diffDays < lookbackDays;
        }

        const stats = {
            id: userId,
            last_seen: daysAgo,
        };

        if (isActive) {
            reportData.active[username] = stats;
            activeMentions.push(username);
        } else {
            reportData.inactive[username] = stats;
            inactiveMentions.push(username);
        }
    });

    // Output building
    const jsonOutput = JSON.stringify(reportData, null, 4);
    const buffer = Buffer.from(jsonOutput, "utf-8");
    const attachment = new AttachmentBuilder(buffer, { name: "staff_report.json" });

    const insightsEmoji = "<:insights:1459169355219603607>";

    let messageContent = "";

    if (specificUser && staffMembers.size === 1) {
        const member = staffMembers.first();
        const username = member.user.username;
        const stats = reportData.active[username] || reportData.inactive[username];

        messageContent += `${insightsEmoji} **Staff Activity Report** (${lookbackDays} days)\n`;
        messageContent += `**User:** ${username} (${member.id}) ${reportData.active[username] ? "🟢" : "🔴"}\n`;
        messageContent += `**Last Seen:** ${stats.last_seen}\n`;
    } else {
        messageContent += `${insightsEmoji} **Staff Activity Report** (Last ${lookbackDays} Days)\n\n`;
        messageContent += `**Active Staff (${activeMentions.length}):**\n`;
        messageContent += activeMentions.length ? activeMentions.join(", ") : "None";
        messageContent += `\n\n**Inactive Staff (${inactiveMentions.length}):**\n`;
        messageContent += inactiveMentions.length ? inactiveMentions.join(", ") : "None";
    }

    return { messageContent, attachment, jsonOutput };
};
