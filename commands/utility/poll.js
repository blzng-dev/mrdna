const {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

const STRINGS = {
    command: {
        name: "poll",
        description: "Create a poll for users to vote on",
        options: {
            question: {
                name: "question",
                description: "The poll question to be displayed",
            },
            preset: {
                name: "preset",
                description:
                    "If true, ignore custom options and automatically react with :checkmark:, 🟧, :x_:",
            },
            option1: {
                name: "option1",
                description: "Emoji for option 1",
            },
            option2: {
                name: "option2",
                description: "Emoji for option 2",
            },
            option3: {
                name: "option3",
                description: "Emoji for option 3",
            },
            option4: {
                name: "option4",
                description: "Emoji for option 4",
            },
        },
    },
    buttons: {
        fixEmojis: "Fix Emojis",
    },
    modals: {
        fixEmojisTitle: "Fix Poll Emojis",
        emojiLabel: (index) => `Emoji ${index}`,
    },
    messages: {
        invalidEmojis:
            ":warning: Some of your input emojis were invalid and failed to react! Click below to fix them.",
        stillFailed:
            "Still had trouble with some emojis! The valid ones were applied.",
        fixedSuccess: "All emojis fixed and applied successfully!",
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.question.name)
                .setDescription(STRINGS.command.options.question.description)
                .setRequired(true),
        )
        .addBooleanOption((option) =>
            option
                .setName(STRINGS.command.options.preset.name)
                .setDescription(STRINGS.command.options.preset.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.option1.name)
                .setDescription(STRINGS.command.options.option1.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.option2.name)
                .setDescription(STRINGS.command.options.option2.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.option3.name)
                .setDescription(STRINGS.command.options.option3.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.option4.name)
                .setDescription(STRINGS.command.options.option4.description)
                .setRequired(false),
        ),

    async execute(interaction) {
        const question = interaction.options.getString(
            STRINGS.command.options.question.name,
        );
        const preset =
            interaction.options.getBoolean(
                STRINGS.command.options.preset.name,
            ) ?? false;

        const rawCustomEmojis = [
            interaction.options.getString(STRINGS.command.options.option1.name),
            interaction.options.getString(STRINGS.command.options.option2.name),
            interaction.options.getString(STRINGS.command.options.option3.name),
            interaction.options.getString(STRINGS.command.options.option4.name),
        ];

        const customEmojis = rawCustomEmojis.filter((emoji) => emoji !== null);

        await interaction.reply({ content: `${question}` });
        const message = await interaction.fetchReply();

        try {
            if (preset) {
                await message.react(":checkmark:");
                await message.react("🟧");
                await message.react(":x_:");
            } else if (customEmojis.length > 0) {
                let failedEmojis = false;

                for (const emoji of customEmojis) {
                    try {
                        await message.react(emoji);
                    } catch (e) {
                        failedEmojis = true;
                    }
                }

                if (failedEmojis) {
                    const fixButton = new ButtonBuilder()
                        .setCustomId("fix_poll_emojis")
                        .setLabel(STRINGS.buttons.fixEmojis)
                        .setStyle(ButtonStyle.Primary);

                    const row = new ActionRowBuilder().addComponents(fixButton);

                    const followUpMsg = await interaction.followUp({
                        content: STRINGS.messages.invalidEmojis,
                        components: [row],
                        flags: MessageFlags.Ephemeral,
                        withResponse: true,
                    });

                    // Resolve the proper object to listen on (handling both native Message or InteractionResponse wrappers)
                    const resTarget = followUpMsg.resource
                        ? followUpMsg.resource.message
                        : followUpMsg;

                    try {
                        const btnInteraction =
                            await resTarget.awaitMessageComponent({
                                filter: (i) =>
                                    i.customId === "fix_poll_emojis" &&
                                    i.user.id === interaction.user.id,
                                time: 60000,
                            });

                        const modal = new ModalBuilder()
                            .setCustomId("fix_poll_emojis_modal")
                            .setTitle(STRINGS.modals.fixEmojisTitle);

                        for (let k = 0; k < 4; k++) {
                            const input = new TextInputBuilder()
                                .setCustomId(`emoji_input_${k}`)
                                .setLabel(STRINGS.modals.emojiLabel(k + 1))
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setValue(rawCustomEmojis[k] || "");
                            modal.addComponents(
                                new ActionRowBuilder().addComponents(input),
                            );
                        }

                        await btnInteraction.showModal(modal);

                        const modalSubmit =
                            await btnInteraction.awaitModalSubmit({
                                filter: (i) =>
                                    i.customId === "fix_poll_emojis_modal" &&
                                    i.user.id === interaction.user.id,
                                time: 120000,
                            });

                        const newEmojis = [
                            modalSubmit.fields.getTextInputValue(
                                "emoji_input_0",
                            ),
                            modalSubmit.fields.getTextInputValue(
                                "emoji_input_1",
                            ),
                            modalSubmit.fields.getTextInputValue(
                                "emoji_input_2",
                            ),
                            modalSubmit.fields.getTextInputValue(
                                "emoji_input_3",
                            ),
                        ].filter((e) => e !== null && e.trim() !== "");

                        await modalSubmit.deferUpdate();

                        // Try applying new emojis to the same message
                        let newFailed = false;
                        for (const em of newEmojis) {
                            try {
                                await message.react(em.trim());
                            } catch (e) {
                                newFailed = true;
                            }
                        }

                        if (newFailed) {
                            await modalSubmit.followUp({
                                content: STRINGS.messages.stillFailed,
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            await modalSubmit.followUp({
                                content: STRINGS.messages.fixedSuccess,
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                    } catch (e) {
                        // User ignored the button or modal timed out
                        console.error(
                            "Modal logic error or timeout:",
                            e.message,
                        );
                    }
                }
            } else {
                await message.react("👍");
                await message.react("👎");
            }
        } catch (error) {
            console.error(
                "Failed to react to poll message with preset/default emojis:",
                error,
            );
        }
    },
};
