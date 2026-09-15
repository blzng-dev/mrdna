const {
    SlashCommandBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("transcript")
        .setDescription("Fetches messages and saves them to a text file")
        .addIntegerOption((option) =>
            option
                .setName("count")
                .setDescription("Number of messages (default: 250)")
                .setMinValue(1)
                .setMaxValue(1000)
        )
        .addBooleanOption((option) =>
            option
                .setName("ephemeral")
                .setDescription("Whether the msg is ephemeral")
        )
        .addBooleanOption((option) =>
            option
                .setName("include_bots")
                .setDescription("Whether to include bot messages in the transcript")
        )
        .setDMPermission(false),

    async execute(interaction) {
        const isEphemeral =
            interaction.options.getBoolean("ephemeral") || false;
        const includeBots =
            interaction.options.getBoolean("include_bots") || false;
        await interaction.deferReply({
            flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
        });

        try {
            let requestedCount = interaction.options.getInteger("count") || 250;
            if (requestedCount > 1000) requestedCount = 1000;

            const channel = interaction.channel;
            await interaction.editReply({
                content: `Fetching the last ${requestedCount} messages...`,
            });

            let allMessages = [];
            let lastId;
            let participants = new Map();

            while (allMessages.length < requestedCount) {
                const options = { limit: 100, before: lastId };
                const messages = await channel.messages.fetch(options);

                messages.forEach((msg) => {
                    if (
                        (!msg.author.bot || includeBots) &&
                        allMessages.length < requestedCount
                    ) {
                        allMessages.push(msg);
                        participants.set(msg.author.id, msg.author.username);
                    }
                });
                lastId = messages.lastKey();
                if (messages.size < 100) break;
            }

            if (allMessages.length === 0) {
                return interaction.editReply({
                    content: "No messages found to transcribe.",
                });
            }

            allMessages.reverse();

            // Helper function to extract text content from Components V2
            function extractComponentText(component) {
                if (!component) return "";
                const data = component.data || component;
                const parts = [];

                // Text Display (Components V2) / Content / Text
                if (component.content || data.content) {
                    parts.push(component.content || data.content);
                } else if (component.text || data.text) {
                    parts.push(component.text || data.text);
                }

                // Title / Header
                if (component.title || data.title) {
                    parts.push(component.title || data.title);
                }

                // Description
                if (component.description || data.description) {
                    parts.push(component.description || data.description);
                }

                // Nested components (ActionRow, Container, Section, etc.)
                const children = component.components || data.components;
                if (Array.isArray(children)) {
                    for (const child of children) {
                        const childText = extractComponentText(child);
                        if (childText) parts.push(childText);
                    }
                }

                // Section accessory
                const accessory = component.accessory || data.accessory;
                if (accessory) {
                    const accText = extractComponentText(accessory);
                    if (accText) parts.push(accText);
                }

                return parts.join("\n");
            }

            function formatMessageContent(m) {
                const parts = [];

                // 1. Text Content
                if (m.content && m.content.trim().length > 0) {
                    parts.push(m.content);
                }

                // 2. Components V2 Text Content
                if (m.components && m.components.length > 0) {
                    m.components.forEach((comp) => {
                        const compText = extractComponentText(comp);
                        if (compText && compText.trim().length > 0) {
                            parts.push(compText.trim());
                        }
                    });
                }

                // 3. Attachments
                if (m.attachments && m.attachments.size > 0) {
                    parts.push(`[Attachments: ${m.attachments.map((a) => a.url).join(", ")}]`);
                }

                if (parts.length === 0) {
                    return "[No Content]";
                }

                return parts.join("\n");
            }

            // Generate Transcript Text
            let transcript = allMessages
                .map((m) => {
                    const time = new Date(m.createdTimestamp).toLocaleString("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                    });
                    const content = formatMessageContent(m);
                    const authorTag = m.author ? (m.author.tag || m.author.username) : "Unknown";
                    return `${time} ${authorTag}: ${content}`;
                })
                .join("\n");

            const buffer = Buffer.from(transcript, "utf-8");
            const attachment = new AttachmentBuilder(buffer, {
                name: `transcript-${channel.name}-${Date.now()}.txt`,
            });

            // Prepare Reply
            let participantsArray = [];
            participants.forEach((username, id) => {
                participantsArray.push(`${username} (${id})`);
            });
            let participantsText = participantsArray.length > 0 ? participantsArray.join(", ") : "None";

            let finalContent = `Transcript generated for "${interaction.channel.name}" (${interaction.channel.id})\nParticipants: ${participantsText}`;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("send_to_logs")
                    .setLabel("Send to Logs")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("📂")
            );

            // Send Reply (NO COLLECTOR)
            await interaction.editReply({
                content: finalContent,
                files: [attachment],
                components: [row],
            });
        } catch (error) {
            console.error("Error creating transcript:", error);
            await interaction.editReply({
                content: "Error generating transcript.",
            });
        }
    },
};
