const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits } = require("discord.js");
const db = require("../../db.js");

const STAFF_ROLE_ID = "857990235194261514";
const LOG_CHANNEL_ID = "1461971930880938129";

const STRINGS = {
    command: {
        name: "Add Quote",
    },
    errors: {
        permissionDenied: ":x_: Permission Denied.",
        alreadyExists: ":warning: Quote already exists.",
        error: (msg) => `An error occurred: ${msg}`,
    },
    messages: {
        added: (content) => `:checkmark: Quote added!\n> ${content}`,
        logHeader: "Quote added",
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
            const check = await db.query(
                "SELECT * FROM fun.quotes WHERE link = $1",
                [link]
            );
            if (check.rows.length > 0) {
                return interaction.editReply(STRINGS.errors.alreadyExists);
            }

            const res = await db.query(
                "INSERT INTO fun.quotes (text, link, reply) VALUES ($1, $2, $3) RETURNING *",
                [quoteMsg.content, link, null]
            );

            const jsonLog = JSON.stringify(res.rows[0], null, 2);
            await sendLog(
                interaction,
                STRINGS.messages.logHeader,
                `\`\`\`json\n${jsonLog}\n\`\`\``
            );

            return interaction.editReply(
                STRINGS.messages.added(quoteMsg.content)
            );
        } catch (error) {
            console.error(error);
            return interaction.editReply({
                content: STRINGS.errors.error(error.message),
            });
        }
    },
};
