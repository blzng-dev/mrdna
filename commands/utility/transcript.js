const {
    SlashCommandBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    FileBuilder,
    MessageFlags,
} = require("discord.js");
const path = require("path");
const { ZipArchive } = require("archiver");
const { findEmojiByNameOrId } = require("../../utils/emojiResolver");
const { formatLogTimestampLine } = require("../../utils/tickets/helpers");

const STRINGS = {
    command: {
        name: "transcript",
        description: "Fetches messages and saves them to a text file",
        options: {
            count: {
                name: "count",
                description: "Number of messages (default: 250)",
            },
            ephemeral: {
                name: "ephemeral",
                description: "Whether the msg is ephemeral",
            },
            include_bots: {
                name: "include_bots",
                description: "Whether to include bot messages in the transcript",
            },
        },
    },
    status: {
        fetching: (count) => `Fetching the last ${count} messages...`,
        noMessages: "No messages found to transcribe.",
    },
    buttons: {
        sendToLogs: "Send to Logs",
    },
    errors: {
        generateError: "Error generating transcript.",
    },
    noContent: "[No Content]",
};

/**
 * Downloads each attachment and packages them into an in-memory ZIP buffer.
 */
async function createAttachmentsZip(attachmentsList) {
    return new Promise((resolve, reject) => {
        const archive = new ZipArchive({ zlib: { level: 9 } });
        const buffers = [];

        archive.on("data", (chunk) => buffers.push(chunk));
        archive.on("end", () => resolve(Buffer.concat(buffers)));
        archive.on("error", (err) => reject(err));

        (async () => {
            for (const item of attachmentsList) {
                try {
                    const res = await fetch(item.url);
                    if (!res.ok) {
                        console.warn(`[transcript] Failed to download attachment ${item.url}: HTTP ${res.status}`);
                        continue;
                    }
                    const arrayBuffer = await res.arrayBuffer();
                    const fileBuf = Buffer.from(arrayBuffer);
                    archive.append(fileBuf, { name: item.zipFilename });
                } catch (err) {
                    console.error(`[transcript] Error downloading attachment ${item.url}:`, err);
                }
            }
            archive.finalize();
        })().catch(reject);
    });
}

/**
 * Checks whether the channel name contains a valid member/user ID or username.
 */
async function findAuthorFromChannelName(guild, channel, participantsMap) {
    if (!channel || !channel.name) return null;
    const nameLower = channel.name.toLowerCase();

    // Helper to verify ID is an actual member/user
    async function verifyUserId(id) {
        if (!id) return null;
        if (participantsMap.has(id)) return id;
        if (guild) {
            const member = await guild.members.fetch(id).catch(() => null);
            if (member) return member.id;
        }
        const user = await channel.client.users.fetch(id).catch(() => null);
        return user ? user.id : null;
    }

    // 1. Check for snowflake ID in channel name (e.g. interview-123456789012345678)
    const idMatches = nameLower.matchAll(/(\d{17,20})/g);
    for (const match of idMatches) {
        const verifiedId = await verifyUserId(match[1]);
        if (verifiedId) return verifiedId;
    }

    // 2. Check channel topic if present
    if (channel.topic) {
        const topicMatch = channel.topic.match(/author:\s*(\d{17,20})/i);
        if (topicMatch) {
            const verifiedId = await verifyUserId(topicMatch[1]);
            if (verifiedId) return verifiedId;
        }
    }

    // 3. Match against known participants' usernames
    for (const p of participantsMap.values()) {
        const cleanedUsername = p.username.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanedUsername.length >= 3) {
            const cleanedChannel = nameLower.replace(/[^a-z0-9]/g, "");
            if (cleanedChannel.includes(cleanedUsername)) {
                return p.id;
            }
        }
    }

    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addIntegerOption((option) =>
            option
                .setName(STRINGS.command.options.count.name)
                .setDescription(STRINGS.command.options.count.description)
                .setMinValue(1)
                .setMaxValue(1000)
        )
        .addBooleanOption((option) =>
            option
                .setName(STRINGS.command.options.ephemeral.name)
                .setDescription(STRINGS.command.options.ephemeral.description)
        )
        .addBooleanOption((option) =>
            option
                .setName(STRINGS.command.options.include_bots.name)
                .setDescription(STRINGS.command.options.include_bots.description)
        )
        .setDMPermission(false),

    async execute(interaction) {
        const isEphemeral =
            interaction.options.getBoolean(STRINGS.command.options.ephemeral.name) || false;
        const includeBots =
            interaction.options.getBoolean(STRINGS.command.options.include_bots.name) || false;
        await interaction.deferReply({
            flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
        });

        try {
            let requestedCount = interaction.options.getInteger(STRINGS.command.options.count.name) || 250;
            if (requestedCount > 1000) requestedCount = 1000;

            const channel = interaction.channel;
            let allMessages = [];
            let lastId;

            while (allMessages.length < requestedCount) {
                const options = { limit: 100, before: lastId };
                const messages = await channel.messages.fetch(options);

                messages.forEach((msg) => {
                    if (
                        (!msg.author.bot || includeBots) &&
                        allMessages.length < requestedCount
                    ) {
                        allMessages.push(msg);
                    }
                });
                lastId = messages.lastKey();
                if (messages.size < 100) break;
            }

            if (allMessages.length === 0) {
                const emptyContainer = new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(STRINGS.status.noMessages)
                );
                return interaction.editReply({
                    components: [emptyContainer],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                });
            }

            allMessages.reverse();

            // Track attachments sequentially: 1, 2, 3...
            let attachmentCounter = 0;
            const allAttachmentsToDownload = [];
            const messageAttachmentsMap = new Map();

            for (const m of allMessages) {
                if (m.attachments && m.attachments.size > 0) {
                    const list = [];
                    for (const att of m.attachments.values()) {
                        attachmentCounter++;
                        const originalName = att.name || "attachment";
                        const ext = path.extname(originalName);
                        const baseName = path.basename(originalName, ext);
                        const zipFilename = `${attachmentCounter}_${baseName}${ext}`;

                        const record = {
                            index: attachmentCounter,
                            originalName,
                            zipFilename,
                            url: att.url,
                            size: att.size || 0,
                        };
                        list.push(record);
                        allAttachmentsToDownload.push(record);
                    }
                    messageAttachmentsMap.set(m.id, list);
                }
            }

            // Extract Components V2 text
            function extractComponentText(component) {
                if (!component) return "";
                const data = component.data || component;
                const parts = [];

                if (component.content || data.content) {
                    parts.push(component.content || data.content);
                } else if (component.text || data.text) {
                    parts.push(component.text || data.text);
                }

                if (component.title || data.title) {
                    parts.push(component.title || data.title);
                }
                if (component.description || data.description) {
                    parts.push(component.description || data.description);
                }

                const children = component.components || data.components;
                if (Array.isArray(children)) {
                    for (const child of children) {
                        const childText = extractComponentText(child);
                        if (childText) parts.push(childText);
                    }
                }

                const accessory = component.accessory || data.accessory;
                if (accessory) {
                    const accText = extractComponentText(accessory);
                    if (accText) parts.push(accText);
                }

                return parts.join("\n");
            }

            function formatMessageContent(m) {
                const parts = [];

                if (m.content && m.content.trim().length > 0) {
                    parts.push(m.content);
                }

                if (m.components && m.components.length > 0) {
                    m.components.forEach((comp) => {
                        const compText = extractComponentText(comp);
                        if (compText && compText.trim().length > 0) {
                            parts.push(compText.trim());
                        }
                    });
                }

                const msgAtts = messageAttachmentsMap.get(m.id);
                if (msgAtts && msgAtts.length > 0) {
                    const indices = msgAtts.map((a) => a.index).join(",");
                    parts.push(`attachment[${indices}]`);
                }

                return parts.length > 0 ? parts.join(" ") : STRINGS.noContent;
            }

            // Map non-bot participants (or all if includeBots)
            const participantMap = new Map();
            for (const m of allMessages) {
                if (!m.author || (m.author.bot && !includeBots)) continue;
                if (!participantMap.has(m.author.id)) {
                    const member = m.member || channel.guild?.members?.cache?.get(m.author.id);
                    const displayName =
                        member?.nickname || member?.displayName || m.author.globalName || m.author.username;
                    participantMap.set(m.author.id, {
                        id: m.author.id,
                        username: m.author.username,
                        displayName,
                    });
                }
            }

            const participantsList = Array.from(participantMap.values());

            // Generate Transcript Lines
            const lines = allMessages.map((m) => {
                const epoch = Math.floor(m.createdTimestamp / 1000);
                const username = m.author ? m.author.username : "Unknown";
                return `${epoch} ${username}: ${formatMessageContent(m)}`;
            });

            const transcriptText = lines.join("\n");
            const transcriptBuffer = Buffer.from(transcriptText, "utf-8");
            const transcriptFilename = `transcript-${channel.name}-${Date.now()}.txt`;

            // Build files array & internal file cards
            const filesToSend = [
                new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename }),
            ];

            const authorId = await findAuthorFromChannelName(interaction.guild, channel, participantMap);

            let cardMd = `### Channel Transcript\n`;
            if (authorId) {
                cardMd += `- author: <@${authorId}>\n`;
            }
            cardMd += `- requester: <@${interaction.user.id}>\n`;
            cardMd += `- channel: #${channel.name} (\`${channel.id}\`)\n`;
            cardMd += `- messages fetched: ${allMessages.length}\n`;

            let participantsFilename = null;
            if (participantsList.length > 10) {
                participantsFilename = `participants-${channel.name}-${Date.now()}.txt`;
                cardMd += `- participants: ${participantsList.length} participants (see attached file)\n`;

                const participantsFileLines = participantsList.map(
                    (p) => `${p.username} (${p.displayName}) - ID: ${p.id}`
                );
                const participantsBuffer = Buffer.from(participantsFileLines.join("\n"), "utf-8");
                filesToSend.push(
                    new AttachmentBuilder(participantsBuffer, { name: participantsFilename })
                );
            } else if (participantsList.length > 0) {
                cardMd += `- participants\n`;
                for (const p of participantsList) {
                    cardMd += `  - <@${p.id}> \`@${p.username}\` (${p.displayName})\n`;
                }
            } else {
                cardMd += `- participants: None\n`;
            }

            cardMd += formatLogTimestampLine();

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(cardMd))
                .addFileComponents(new FileBuilder().setURL(`attachment://${transcriptFilename}`));

            if (participantsFilename) {
                container.addFileComponents(new FileBuilder().setURL(`attachment://${participantsFilename}`));
            }

            // Download attachments & package ZIP if any exist
            if (allAttachmentsToDownload.length > 0) {
                try {
                    const zipBuffer = await createAttachmentsZip(allAttachmentsToDownload);
                    if (zipBuffer) {
                        const zipFilename = `attachments-${channel.name}-${Date.now()}.zip`;
                        filesToSend.push(new AttachmentBuilder(zipBuffer, { name: zipFilename }));
                        container.addFileComponents(new FileBuilder().setURL(`attachment://${zipFilename}`));
                    }
                } catch (err) {
                    console.error("[transcript] Failed to create attachments ZIP:", err);
                }
            }

            const categoryEmoji = await findEmojiByNameOrId(interaction.client, ":category:");
            const sendButton = new ButtonBuilder()
                .setCustomId("send_to_logs")
                .setLabel(STRINGS.buttons.sendToLogs)
                .setStyle(ButtonStyle.Secondary);

            if (categoryEmoji?.id) {
                sendButton.setEmoji(categoryEmoji);
            } else {
                sendButton.setEmoji(":category:");
            }

            const row = new ActionRowBuilder().addComponents(sendButton);

            await interaction.editReply({
                components: [container, row],
                files: filesToSend,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error("Error creating transcript:", error);
            const errContainer = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(STRINGS.errors.generateError)
            );
            await interaction.editReply({
                components: [errContainer],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
        }
    },
};

