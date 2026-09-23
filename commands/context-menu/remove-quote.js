const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits } = require("discord.js");
const db = require("../../db.js");

const STAFF_ROLE_ID = "857990235194261514";
const LOG_CHANNEL_ID = "1461971930880938129";

const STRINGS = {
    command: {
        name: "Remove Quote",
    },
    errors: {
        permissionDenied: ":x_: Permission Denied.",
        notFound: ":warning: Quote not found.",
        error: (msg) => `An error occurred: ${msg}`,
    },
    messages: {
        removed: ":checkmark: Quote removed.",
        logHeader: "Quote deleted",
    },
};

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
        .setName(STRINGS.command.name)
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
        );
        const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);

        if (!isAdmin && !isStaff) {
            return interaction.reply({
                content: STRINGS.errors.permissionDenied,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const quoteMsg = interaction.targetMessage;
        const link = normalizeLink(quoteMsg.url);

        try {
            const res = await db.query(
                "DELETE FROM fun.quotes WHERE link = $1 RETURNING *",
                [link]
            );

            if (res.rowCount === 0) {
                return interaction.editReply(STRINGS.errors.notFound);
            }

            const jsonLog = JSON.stringify(res.rows[0], null, 2);
            await sendLog(
                interaction,
                STRINGS.messages.logHeader,
                `\`\`\`json\n${jsonLog}\n\`\`\``
            );

            return interaction.editReply(STRINGS.messages.removed);
        } catch (error) {
            console.error(error);
            return interaction.editReply({
                content: STRINGS.errors.error(error.message),
            });
        }
    },
};
