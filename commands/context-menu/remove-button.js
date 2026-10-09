const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    Routes,
} = require("discord.js");

const STRINGS = {
    command: {
        name: "Remove Button",
    },
    errors: {
        notOwnMessage: "I can only remove buttons from my own messages.",
        noButtonsFound: "This message does not contain any removable buttons.",
        buttonNotFound: "The selected button was not found on this message.",
    },
    modals: {
        title: "Remove Button",
        selectLabel: "Select Button to Remove",
        selectDesc: "Choose which button to permanently delete from this message",
    },
    success: (label) => `Successfully removed button **${label}**.`,
};

function getButtonsFromMessage(components) {
    const buttons = [];
    if (!components) return buttons;
    for (const comp of components) {
        if (comp.type === 1 && comp.components) {
            for (const sub of comp.components) {
                if (sub.type === 2 && sub.custom_id) {
                    buttons.push(sub);
                }
            }
        }
    }
    return buttons;
}

function removeButtonFromComponents(components, customId) {
    const updated = [];
    for (const comp of components) {
        if (comp.type === 1 && comp.components) {
            const filtered = comp.components.filter(
                (sub) => sub.type !== 2 || sub.custom_id !== customId,
            );
            if (filtered.length > 0) {
                updated.push({ ...comp, components: filtered });
            }
        } else {
            updated.push(comp);
        }
    }
    return updated;
}

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName(STRINGS.command.name)
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (interaction.targetMessage.author.id !== interaction.client.user.id) {
            return interaction.reply({
                content: STRINGS.errors.notOwnMessage,
                flags: MessageFlags.Ephemeral,
            });
        }

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, interaction.targetId),
        );

        const buttons = getButtonsFromMessage(rawMessage.components);
        if (buttons.length === 0) {
            return interaction.reply({
                content: STRINGS.errors.noButtonsFound,
                flags: MessageFlags.Ephemeral,
            });
        }

        // If only 1 button, remove directly
        if (buttons.length === 1) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const btnToRemove = buttons[0];
            const updatedComponents = removeButtonFromComponents(
                rawMessage.components,
                btnToRemove.custom_id,
            );

            await interaction.client.rest.patch(
                Routes.channelMessage(interaction.channelId, interaction.targetId),
                {
                    body: {
                        components: updatedComponents,
                        flags: MessageFlags.IsComponentsV2 || (1 << 15),
                    },
                },
            );

            return interaction.editReply({
                content: STRINGS.success(btnToRemove.label || btnToRemove.custom_id),
            });
        }

        // If multiple buttons, prompt with a modal
        const options = buttons.map((b, i) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(b.label ? b.label.substring(0, 100) : `Button ${i + 1}`)
                .setValue(b.custom_id)
                .setDescription(`ID: ${b.custom_id}`.substring(0, 100)),
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("remove_button_select")
            .setPlaceholder("Select button to remove")
            .setRequired(true)
            .addOptions(options);

        const selectLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.selectLabel)
            .setDescription(STRINGS.modals.selectDesc)
            .setStringSelectMenuComponent(selectMenu);

        const modal = new ModalBuilder()
            .setCustomId(`btn_remove_modal_${interaction.targetId}`)
            .setTitle(STRINGS.modals.title)
            .addComponents(selectLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.customId.replace("btn_remove_modal_", "");
        const selectField = interaction.fields?.fields?.get("remove_button_select");
        const customIdToRemove = selectField?.values?.[0];

        if (!customIdToRemove) {
            return interaction.editReply({
                content: STRINGS.errors.buttonNotFound,
            });
        }

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, messageId),
        );

        const updatedComponents = removeButtonFromComponents(
            rawMessage.components,
            customIdToRemove,
        );

        await interaction.client.rest.patch(
            Routes.channelMessage(interaction.channelId, messageId),
            {
                body: {
                    components: updatedComponents,
                    flags: MessageFlags.IsComponentsV2 || (1 << 15),
                },
            },
        );

        return interaction.editReply({
            content: STRINGS.success(customIdToRemove),
        });
    },
};
