const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ActionRowBuilder,
    MessageFlags,
    Routes,
} = require("discord.js");
const { BUTTON_ACTIONS, BUTTON_STYLES } = require("../../utils/buttonRegistry");
const { resolveButtonEmoji } = require("./add-button");

const STRINGS = {
    command: {
        name: "Edit Button",
    },
    errors: {
        notOwnMessage: "I can only edit buttons on my own messages.",
        noButtonsFound: "This message does not contain any buttons to edit.",
        buttonNotFound: "Selected button was not found on this message.",
        failedToEdit: "Failed to edit button on this message.",
    },
    selectMenu: {
        placeholder: "Select button to edit",
        promptText: "Select which button on this message you want to edit:",
    },
    modals: {
        editTitle: "Edit Button",
        actionLabel: "Button Action",
        actionDesc: "Select the action this button triggers",
        labelLabel: "Button Label",
        labelDesc: "Text displayed on the button (max 80 chars)",
        emojiLabel: "Button Emoji (Optional)",
        emojiDesc: "Custom emoji <:name:id> or :name: (leave empty if none)",
        styleLabel: "Button Style / Color",
        styleDesc: "Choose button color style",
        stateLabel: "Button State",
        stateDesc: "Choose whether the button is active or disabled",
    },
    success: "Button edited successfully.",
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

function buildEditModal(targetButton, messageId) {
    // 1. Action Select (Label 1)
    const actionOptions = BUTTON_ACTIONS.map((a) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(a.label)
            .setValue(a.id)
            .setDescription(a.description || "")
            .setDefault(targetButton.custom_id === a.id),
    );

    const actionSelect = new StringSelectMenuBuilder()
        .setCustomId("edit_btn_action")
        .setPlaceholder("Select action")
        .setRequired(true)
        .addOptions(actionOptions);

    const actionLabel = new LabelBuilder()
        .setLabel(STRINGS.modals.actionLabel)
        .setDescription(STRINGS.modals.actionDesc)
        .setStringSelectMenuComponent(actionSelect);

    // 2. Label Input (Label 2)
    const labelInput = new TextInputBuilder()
        .setCustomId("edit_btn_label")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setValue(targetButton.label || "");

    const textLabel = new LabelBuilder()
        .setLabel(STRINGS.modals.labelLabel)
        .setDescription(STRINGS.modals.labelDesc)
        .setTextInputComponent(labelInput);

    // 3. Emoji Input (Label 3)
    let initialEmoji = "";
    if (targetButton.emoji?.id) {
        initialEmoji = `<${targetButton.emoji.animated ? "a" : ""}:${targetButton.emoji.name}:${targetButton.emoji.id}>`;
    }

    const emojiInput = new TextInputBuilder()
        .setCustomId("edit_btn_emoji")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setPlaceholder("e.g. <:emoji_name:id> or :name: (optional)")
        .setValue(initialEmoji);

    const emojiLabel = new LabelBuilder()
        .setLabel(STRINGS.modals.emojiLabel)
        .setDescription(STRINGS.modals.emojiDesc)
        .setTextInputComponent(emojiInput);

    // 4. Style Select (Label 4)
    const styleOptions = BUTTON_STYLES.map((s) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(s.label)
            .setValue(s.value)
            .setDefault(String(targetButton.style) === s.value),
    );

    const styleSelect = new StringSelectMenuBuilder()
        .setCustomId("edit_btn_style")
        .setPlaceholder("Select button color")
        .setRequired(false)
        .addOptions(styleOptions);

    const styleLabel = new LabelBuilder()
        .setLabel(STRINGS.modals.styleLabel)
        .setDescription(STRINGS.modals.styleDesc)
        .setStringSelectMenuComponent(styleSelect);

    // 5. State Select (Label 5)
    const stateSelect = new StringSelectMenuBuilder()
        .setCustomId("edit_btn_state")
        .setPlaceholder("Select state")
        .setRequired(false)
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel("Enabled")
                .setValue("enabled")
                .setDefault(!targetButton.disabled),
            new StringSelectMenuOptionBuilder()
                .setLabel("Disabled")
                .setValue("disabled")
                .setDefault(Boolean(targetButton.disabled)),
        );

    const stateLabel = new LabelBuilder()
        .setLabel(STRINGS.modals.stateLabel)
        .setDescription(STRINGS.modals.stateDesc)
        .setStringSelectMenuComponent(stateSelect);

    const modal = new ModalBuilder()
        .setCustomId(`btn_edit_form_${messageId}_${targetButton.custom_id}`)
        .setTitle(STRINGS.modals.editTitle)
        .addComponents(actionLabel, textLabel, emojiLabel, styleLabel, stateLabel);

    return modal;
}

module.exports = {
    STRINGS,
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

        // If only 1 button, directly open the edit modal
        if (buttons.length === 1) {
            const modal = buildEditModal(buttons[0], interaction.targetId);
            return interaction.showModal(modal);
        }

        // If multiple buttons, reply ephemerally with a StringSelectMenu
        const options = buttons.map((b, i) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(b.label ? b.label.substring(0, 100) : `Button ${i + 1}`)
                .setValue(b.custom_id)
                .setDescription(`ID: ${b.custom_id}`.substring(0, 100)),
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`edit_btn_select_${interaction.targetId}`)
            .setPlaceholder(STRINGS.selectMenu.placeholder)
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return interaction.reply({
            content: STRINGS.selectMenu.promptText,
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    },

    async handleSelectMenu(interaction) {
        const messageId = interaction.customId.replace("edit_btn_select_", "");
        const selectedCustomId = interaction.values[0];

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, messageId),
        );

        const buttons = getButtonsFromMessage(rawMessage.components);
        const targetBtn = buttons.find((b) => b.custom_id === selectedCustomId);
        if (!targetBtn) {
            return interaction.reply({
                content: STRINGS.errors.buttonNotFound,
                flags: MessageFlags.Ephemeral,
            });
        }

        // User clicked an option in the select menu -> show the edit modal
        const modal = buildEditModal(targetBtn, messageId);
        return interaction.showModal(modal);
    },

    async handleModal(interaction) {
        if (!interaction.customId.startsWith("btn_edit_form_")) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const parts = interaction.customId.replace("btn_edit_form_", "").split("_");
        const messageId = parts[0];
        const originalCustomId = parts.slice(1).join("_");

        let actionId = "";
        const actionField = interaction.fields?.fields?.get("edit_btn_action");
        if (actionField?.values?.length > 0) actionId = actionField.values[0];

        let label = "";
        try {
            label = interaction.fields.getTextInputValue("edit_btn_label");
        } catch {
            label = interaction.fields?.fields?.get("edit_btn_label")?.value || "";
        }
        label = label.trim();

        let emojiRaw = "";
        try {
            emojiRaw = interaction.fields.getTextInputValue("edit_btn_emoji");
        } catch {
            emojiRaw = interaction.fields?.fields?.get("edit_btn_emoji")?.value || "";
        }
        emojiRaw = emojiRaw.trim();

        let styleVal = 1;
        const styleField = interaction.fields?.fields?.get("edit_btn_style");
        if (styleField?.values?.length > 0) styleVal = parseInt(styleField.values[0], 10);

        let disabled = false;
        const stateField = interaction.fields?.fields?.get("edit_btn_state");
        if (stateField?.values?.length > 0) disabled = stateField.values[0] === "disabled";

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, messageId),
        );

        const components = Array.isArray(rawMessage.components)
            ? JSON.parse(JSON.stringify(rawMessage.components))
            : [];

        const newButtonObj = {
            type: 2,
            custom_id: actionId,
            label: label,
            style: styleVal,
            disabled: disabled,
        };

        if (emojiRaw) {
            const resolved = await resolveButtonEmoji(interaction.client, emojiRaw);
            if (resolved) {
                newButtonObj.emoji = resolved;
            }
        }

        let found = false;
        for (const comp of components) {
            if (comp.type === 1 && comp.components) {
                const idx = comp.components.findIndex((b) => b.type === 2 && b.custom_id === originalCustomId);
                if (idx !== -1) {
                    comp.components[idx] = newButtonObj;
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            return interaction.editReply({
                content: STRINGS.errors.buttonNotFound,
            });
        }

        try {
            await interaction.client.rest.patch(
                Routes.channelMessage(interaction.channelId, messageId),
                {
                    body: {
                        components: components,
                        flags: MessageFlags.IsComponentsV2 || (1 << 15),
                    },
                },
            );

            return interaction.editReply({
                content: STRINGS.success,
            });
        } catch (err) {
            console.error("Error in Edit Button PATCH:", err);
            return interaction.editReply({
                content: `${STRINGS.errors.failedToEdit}: ${err.message}`,
            });
        }
    },
};
