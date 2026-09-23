const { SlashCommandBuilder } = require("discord.js");
const db = require("../../db.js");

const STRINGS = {
    command: {
        name: "quote",
        description: "replies with a server quote",
    },
    errors: {
        noneFound: "No quotes found in the database.",
        generic: "An error occurred while fetching the quote.",
    },
    messages: {
        quoteStandard: (text, link) => `${text}\n-# jump to [original message](${link})`,
        quoteWithReply: (text, link, reply) => `${text}\n-# jump to [original message](${link}) | replied to:\n-# > ${reply}`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const result = await db.query(
                "SELECT * FROM fun.quotes ORDER BY RANDOM() LIMIT 1"
            );

            if (result.rows.length === 0) {
                return interaction.editReply(
                    STRINGS.errors.noneFound
                );
            }

            const quoteObj = result.rows[0];
            let quote;

            if (!quoteObj.reply) {
                quote = STRINGS.messages.quoteStandard(quoteObj.text, quoteObj.link);
            } else {
                quote = STRINGS.messages.quoteWithReply(quoteObj.text, quoteObj.link, quoteObj.reply);
            }

            await interaction.editReply({
                content: quote,
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply(
                STRINGS.errors.generic
            );
        }
    },
};
