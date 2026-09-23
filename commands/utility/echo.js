const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const LOG_CHANNEL_ID = "1424304322812051596";
const OVERRIDE_CODE = "7337#";

// Regex for message links and IDs
const MESSAGE_LINK_REGEX = /channels\/\d+\/(\d+)\/(\d+)/;
const MESSAGE_ID_REGEX = /^\d{17,20}$/;

const forbiddenPatterns = [
    "porn",
    "hitler",
    /\b[gG](?:[oO0]{2,})[nN]\w*\b/i, // goon
    /\bn[i1]g{2,}(?:a|er)?s?\b/i, // n word
    /f[a@]g{1,2}[o0]ts?/i, // f word
    /r[e3]t[a@]rd/i,
];

const STRINGS = {
    command: {
        name: "echo",
        description: "repeats your message",
        optionMessageDescription: "The message to send",
        optionReplyToDescription: "Message ID or link to reply to",
        optionOverrideDescription: "Admin code to bypass certain filters or to enable replying.",
    },
    errors: {
        emptyMessage: "Cannot send an empty message!",
        forbiddenMention: (name) => `Your message contains a forbidden ${name}, which is not allowed under any circumstances.`,
        userMentionForbidden: "Your message contains a user mention, which is not allowed.",
        forbiddenPattern: "Your message contains a forbidden word or pattern.",
        noReplyPermission: "You don't have permissions to use this option",
        replyTargetNotFound: "Could not find the message to reply to. Please check the ID or link.",
        genericSendError: "There was an error while sending the message!",
    },
    messages: {
        sentSuccess: "Message sent!",
        logFormat: (username, channelStr, content, sentUrl, replyUrl) => {
            const replyInfo = replyUrl ? `\n-# In reply to: ${replyUrl}` : "";
            return [
                `**${username}** sent a message in ${channelStr}:`,
                `> ${content}`,
                `-# Jump to sent message: ${sentUrl}${replyInfo}`,
            ].join("\n");
        },
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addStringOption((option) =>
            option
                .setName("message")
                .setDescription(STRINGS.command.optionMessageDescription)
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("reply_to")
                .setDescription(STRINGS.command.optionReplyToDescription)
                .setRequired(false)
        )
        .addStringOption((option) =>
            option
                .setName("override_code")
                .setDescription(STRINGS.command.optionOverrideDescription)
                .setRequired(false)
        ),

    async execute(interaction) {
        // --- Defer the reply immediately to prevent "Unknown Interaction" error ---
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageContent = interaction.options.getString("message");
        const overrideCodeInput =
            interaction.options.getString("override_code");
        const replyToInput = interaction.options.getString("reply_to");
        const hasOverride = overrideCodeInput === OVERRIDE_CODE;

        if (!messageContent.trim()) {
            return interaction.editReply({
                content: STRINGS.errors.emptyMessage,
            });
        }

        // --- Filtering Logic ---
        const alwaysForbiddenPatterns = [
            { pattern: /@everyone/, name: "@everyone mention" },
            { pattern: /@here/, name: "@here mention" },
            { pattern: /<@&\d+>/, name: "role mention" },
        ];

        for (const { pattern, name } of alwaysForbiddenPatterns) {
            if (pattern.test(messageContent)) {
                return interaction.editReply({
                    content: STRINGS.errors.forbiddenMention(name),
                });
            }
        }

        if (!hasOverride) {
            if (/<@\d+>/.test(messageContent)) {
                return interaction.editReply({
                    content: STRINGS.errors.userMentionForbidden,
                });
            }
            if (hasForbiddenContent(messageContent, forbiddenPatterns)) {
                return interaction.editReply({
                    content: STRINGS.errors.forbiddenPattern,
                });
            }
        }

        // --- Reply Logic ---
        let targetMessage = null;
        if (replyToInput) {
            if (!hasOverride) {
                return interaction.editReply({
                    content: STRINGS.errors.noReplyPermission,
                });
            }
            targetMessage = await findMessage(
                interaction.channel,
                replyToInput
            );
            if (!targetMessage) {
                return interaction.editReply({
                    content: STRINGS.errors.replyTargetNotFound,
                });
            }
        }

        // --- Send the Message and Log ---
        try {
            let sentMessage;
            if (targetMessage) {
                // Replying to a specific message
                sentMessage = await targetMessage.reply({
                    content: messageContent,
                    allowedMentions: { repliedUser: false }, // Don't ping the author of the message being replied to
                });
            } else {
                // Sending a new message in the channel
                sentMessage = await interaction.channel.send({
                    content: messageContent,
                });
            }

            await interaction.editReply({
                content: STRINGS.messages.sentSuccess,
            });

            await sendLogMessage(
                interaction,
                messageContent,
                sentMessage,
                targetMessage
            );
        } catch (error) {
            console.error("Error in echo command:", error);
            await interaction
                .editReply({
                    content: STRINGS.errors.genericSendError,
                })
                .catch(console.error); // Fallback catch
        }
    },
};

// --- Helper Functions ---

function hasForbiddenContent(message, patterns) {
    for (const item of patterns) {
        const regex =
            item instanceof RegExp
                ? item
                : new RegExp(
                      `\\b${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                      "i"
                  );
        if (regex.test(message)) return true;
    }
    return false;
}

async function findMessage(channel, input) {
    try {
        const linkMatch = input.match(MESSAGE_LINK_REGEX);
        const idMatch = input.match(MESSAGE_ID_REGEX);

        let messageId;
        if (linkMatch) {
            messageId = linkMatch[2];
        } else if (idMatch) {
            messageId = idMatch[0];
        } else {
            return null; // Invalid format
        }

        return await channel.messages.fetch(messageId);
    } catch {
        return null; // Message not found or other error
    }
}

async function sendLogMessage(
    interaction,
    content,
    sentMessage,
    repliedMessage
) {
    try {
        const logChannel = await interaction.guild.channels.fetch(
            LOG_CHANNEL_ID
        );
        if (!logChannel || !logChannel.isTextBased()) return;

        const logMessage = STRINGS.messages.logFormat(
            interaction.user.username,
            interaction.channel.toString(),
            content,
            sentMessage.url,
            repliedMessage?.url
        );

        await logChannel.send(logMessage);
    } catch (error) {
        console.error("Failed to send log message:", error);
    }
}
