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
        .setDMPermission(false),

    async execute(interaction) {
        const isEphemeral =
            interaction.options.getBoolean("ephemeral") || false;
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
                        !msg.author.bot &&
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
                    content: "No user messages found to transcribe.",
                });
            }

            allMessages.reverse();

            // Generate Transcript Text
            let transcript = allMessages
                .map((m) => {
                    const time = new Date(m.createdTimestamp).toLocaleString();
                    const content = m.content || "[No Content]";
                    const attach =
                        m.attachments.size > 0
                            ? ` [Attachments: ${m.attachments
                                  .map((a) => a.url)
                                  .join(", ")}]`
                            : "";
                    return `${time} ${m.author.tag}: ${content}${attach}`;
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

            const buttonCustomId = "send_to_logs";

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(buttonCustomId)
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
