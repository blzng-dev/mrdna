const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
} = require("discord.js");
const menuData = require("../../data/menu-data.json");

const STRINGS = {
    command: {
        name: "menu",
        description: "Display the welcome menu with server information",
        optionMessageIdDescription: "ID of an existing message to update (optional)",
    },
    selectMenu: {
        defaultPlaceholder: "Select an option",
    },
    status: {
        updated: "Menu updated!",
        sent: "Menu sent!",
    },
    errors: {
        notFound: "Welcome message configuration not found.",
        editFailed: "Failed to edit message. Check ID and permissions.",
        generic: (msg) => `Error: ${msg}`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription(STRINGS.command.optionMessageIdDescription)
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            const welcomeMsg = menuData.find(
                (item) => item.id === "welcome-msg"
            );
            if (!welcomeMsg) {
                return interaction.reply({
                    content: STRINGS.errors.notFound,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // --- BUILD COMPONENTS ---
            const actionRowMap = new Map();

            welcomeMsg.components.forEach((comp) => {
                if (comp["action-row"]) {
                    const rowNumber = comp["action-row"];
                    if (!actionRowMap.has(rowNumber)) {
                        actionRowMap.set(rowNumber, new ActionRowBuilder());
                    }
                    const actionRow = actionRowMap.get(rowNumber);

                    if (comp.type === "string-select-menu") {
                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(comp.custom_id)
                            .setPlaceholder(
                                comp.placeholder || STRINGS.selectMenu.defaultPlaceholder
                            );

                        comp.options.forEach((opt) => {
                            const optionData = {
                                label: opt.label,
                                value: opt.value,
                                description: opt.description,
                            };
                            if (opt.emoji_id)
                                optionData.emoji = { id: opt.emoji_id };
                            selectMenu.addOptions(optionData);
                        });
                        actionRow.addComponents(selectMenu);
                    } else if (comp.type === "button") {
                        const button = new ButtonBuilder()
                            .setCustomId(comp.custom_id)
                            .setLabel(comp.label)
                            .setStyle(getButtonStyle(comp.style));

                        if (comp.emoji_id) {
                            button.setEmoji({
                                id: String(comp.emoji_id),
                                name: comp.emoji_name,
                                animated: comp.emoji_animated || false,
                            });
                        } else if (comp.emoji_name) {
                            button.setEmoji(comp.emoji_name);
                        }

                        if (comp.disabled !== undefined)
                            button.setDisabled(comp.disabled);
                        actionRow.addComponents(button);
                    }
                }
            });

            const components = Array.from(actionRowMap.entries())
                .sort((a, b) => a[0] - b[0])
                .map((entry) => entry[1]);

            // --- SEND MESSAGE ---
            const messageId = interaction.options.getString("messageid");

            if (messageId) {
                try {
                    const sentMessage =
                        await interaction.channel.messages.fetch(messageId);
                    await sentMessage.edit({
                        content: welcomeMsg.content,
                        components,
                    });
                    await interaction.reply({
                        content: STRINGS.status.updated,
                        flags: MessageFlags.Ephemeral,
                    });
                } catch (e) {
                    return interaction.reply({
                        content: STRINGS.errors.editFailed,
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } else {
                await interaction.channel.send({
                    content: welcomeMsg.content,
                    components: components,
                });
                await interaction.reply({
                    content: STRINGS.status.sent,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            console.error("Error in menu command:", error);
            if (!interaction.replied)
                await interaction.reply({
                    content: STRINGS.errors.generic(error.message),
                    flags: MessageFlags.Ephemeral,
                });
        }
    },
};

function getButtonStyle(style) {
    switch (style?.toLowerCase()) {
        case "primary":
            return ButtonStyle.Primary;
        case "secondary":
            return ButtonStyle.Secondary;
        case "success":
            return ButtonStyle.Success;
        case "danger":
            return ButtonStyle.Danger;
        case "link":
            return ButtonStyle.Link;
        default:
            return ButtonStyle.Primary;
    }
}
