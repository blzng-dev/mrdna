const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits } = require("discord.js");
const db = require("../../db.js");

const STAFF_ROLE_ID = "857990235194261514";
const LOG_CHANNEL_ID = "1461971930880938129";

function normalizeLink(link) {
    return link.replace(
        /https?:\/\/(canary\.|ptb\.)?discord\.com/,
        "https://discord.com"
    );
}

async function sendLog(interaction, header, contentCodeBlock) {
    try {
        const channel = await interaction.client.channels
            .fetch(LOG_CHANNEL_ID)
            .catch(() => null);
        if (channel) {
            await channel.send(
                `${header} by ${interaction.user.username} (${interaction.user.id})\n${contentCodeBlock}`,
            );
        }
    } catch (err) {
        console.error("Failed to send log:", err);
    }
}

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName("Remove Quote")
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
        );
        const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);

        if (!isAdmin && !isStaff) {
            return interaction.reply({
                content: "❌ Permission Denied.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const quoteMsg = interaction.targetMessage;
        const link = normalizeLink(quoteMsg.url);

        try {
            const res = await db.query(
                "DELETE FROM quotes WHERE link = $1 RETURNING *",
                [link]
            );

            if (res.rowCount === 0) {
                return interaction.editReply("⚠️ Quote not found.");
            }

            const jsonLog = JSON.stringify(res.rows[0], null, 2);
            await sendLog(
                interaction,
                "Quote deleted",
                `\`\`\`json\n${jsonLog}\n\`\`\``
            );

            return interaction.editReply("✅ Quote removed.");
        } catch (error) {
            console.error(error);
            return interaction.editReply({
                content: `An error occurred: ${error.message}`,
            });
        }
    },
};
