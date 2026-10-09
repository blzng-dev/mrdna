const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("emojis")
        .setDescription("Spits out all application emojis"),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            if (!interaction.client.application) {
                await interaction.client.fetchApplication();
            }

            const emojis = await interaction.client.application.emojis.fetch();

            if (!emojis || emojis.size === 0) {
                return interaction.editReply({
                    content: "No application emojis found.",
                });
            }

            const chunks = [];
            let currentChunk = "";

            for (const emoji of emojis.values()) {
                const emojiStr = emoji.toString();
                if (currentChunk.length + emojiStr.length > 2000) {
                    if (currentChunk) chunks.push(currentChunk);
                    currentChunk = emojiStr;
                } else {
                    currentChunk += emojiStr;
                }
            }

            if (currentChunk) {
                chunks.push(currentChunk);
            }

            await interaction.editReply({
                content: chunks[0],
                allowedMentions: { parse: [] },
            });

            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({
                    content: chunks[i],
                    allowedMentions: { parse: [] },
                });
            }
        } catch (error) {
            console.error("Error executing emojis command:", error);
            await interaction.editReply({
                content: "An error occurred while fetching application emojis.",
            });
        }
    },
};
