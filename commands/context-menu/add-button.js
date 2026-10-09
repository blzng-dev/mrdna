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
    MessageFlags,
    Routes,
    parseEmoji,
} = require("discord.js");
const { BUTTON_ACTIONS, BUTTON_STYLES } = require("../../utils/buttonRegistry");
const { findEmojiByNameOrId } = require("../../utils/emojiResolver");

const STRINGS = {
    command: {
        name: "Add Button",
    },
    errors: {
        notOwnMessage: "I can only add buttons to my own messages.",
        noActionsAvailable: "No registered button actions are available.",
        actionNotFound: "Selected action is not registered.",
        maxButtonsReached: "This message has reached the maximum number of buttons.",
        invalidEmoji: "The emoji could not be found or is invalid.",
        failedToEdit: "Failed to add button to this message.",
    },
    modals: {
        title: "Add Button",
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
    success: "Button added successfully.",
};

async function resolveButtonEmoji(client, rawInput) {
    if (!rawInput || typeof rawInput !== "string") return null;
    const trimmed = rawInput.trim();
    if (!trimmed) return null;

    try {
        const found = await findEmojiByNameOrId(client, trimmed);
        if (found && found.id) {
            return {
                id: found.id,
                name: found.name || "emoji",
                animated: Boolean(found.animated),
            };
        }
    } catch (_) {
        // Skip on any emoji resolution failure
    }

    return null;
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

        // 1. Action Select (Label 1)
        const actionOptions = BUTTON_ACTIONS.map((a) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(a.label)
                .setValue(a.id)
                .setDescription(a.description || ""),
        );

        const actionSelect = new StringSelectMenuBuilder()
            .setCustomId("add_btn_action")
            .setPlaceholder("Select action")
            .setRequired(true)
            .addOptions(actionOptions);

        const actionLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.actionLabel)
            .setDescription(STRINGS.modals.actionDesc)
            .setStringSelectMenuComponent(actionSelect);

        // 2. Label Input (Label 2) - Blank by default, no prefill
        const labelInput = new TextInputBuilder()
            .setCustomId("add_btn_label")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80)
            .setPlaceholder("Button text");

        const textLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.labelLabel)
            .setDescription(STRINGS.modals.labelDesc)
            .setTextInputComponent(labelInput);

        // 3. Emoji Input (Label 3)
        const emojiInput = new TextInputBuilder()
            .setCustomId("add_btn_emoji")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100)
            .setPlaceholder("e.g. <:emoji_name:id> or :name: (optional)");

        const emojiLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.emojiLabel)
            .setDescription(STRINGS.modals.emojiDesc)
            .setTextInputComponent(emojiInput);

        // 4. Style Select (Label 4)
        const styleOptions = BUTTON_STYLES.map((s, idx) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(s.label)
                .setValue(s.value)
                .setDefault(idx === 0),
        );

        const styleSelect = new StringSelectMenuBuilder()
            .setCustomId("add_btn_style")
            .setPlaceholder("Select button color")
            .setRequired(false)
            .addOptions(styleOptions);

        const styleLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.styleLabel)
            .setDescription(STRINGS.modals.styleDesc)
            .setStringSelectMenuComponent(styleSelect);

        // 5. State Select (Label 5)
        const stateSelect = new StringSelectMenuBuilder()
            .setCustomId("add_btn_state")
            .setPlaceholder("Select state")
            .setRequired(false)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel("Enabled")
                    .setValue("enabled")
                    .setDefault(true),
                new StringSelectMenuOptionBuilder()
                    .setLabel("Disabled")
                    .setValue("disabled"),
            );

        const stateLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.stateLabel)
            .setDescription(STRINGS.modals.stateDesc)
            .setStringSelectMenuComponent(stateSelect);

        const modal = new ModalBuilder()
            .setCustomId(`btn_add_modal_${interaction.targetId}`)
            .setTitle(STRINGS.modals.title)
            .addComponents(actionLabel, textLabel, emojiLabel, styleLabel, stateLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.customId.replace("btn_add_modal_", "");

        // 1. Extract inputs
        let actionId = "";
        const actionField = interaction.fields?.fields?.get("add_btn_action");
        if (actionField?.values?.length > 0) {
            actionId = actionField.values[0];
        }

        let label = "";
        try {
            label = interaction.fields.getTextInputValue("add_btn_label");
        } catch {
            label = interaction.fields?.fields?.get("add_btn_label")?.value || "";
        }
        label = label.trim();

        let emojiRaw = "";
        try {
            emojiRaw = interaction.fields.getTextInputValue("add_btn_emoji");
        } catch {
            emojiRaw = interaction.fields?.fields?.get("add_btn_emoji")?.value || "";
        }
        emojiRaw = emojiRaw.trim();

        let styleVal = 1;
        const styleField = interaction.fields?.fields?.get("add_btn_style");
        if (styleField?.values?.length > 0) {
            styleVal = parseInt(styleField.values[0], 10);
        }

        let disabled = false;
        const stateField = interaction.fields?.fields?.get("add_btn_state");
        if (stateField?.values?.length > 0) {
            disabled = stateField.values[0] === "disabled";
        }

        // Fetch original message
        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, messageId),
        );

        const components = Array.isArray(rawMessage.components)
            ? JSON.parse(JSON.stringify(rawMessage.components))
            : [];

        // Build button object
        const buttonObj = {
            type: 2,
            custom_id: actionId,
            label: label,
            style: styleVal,
            disabled: disabled,
        };

        if (emojiRaw) {
            const resolved = await resolveButtonEmoji(interaction.client, emojiRaw);
            if (resolved) {
                buttonObj.emoji = resolved;
            }
        }

        // Add to an existing ActionRow with space or create new row
        let added = false;
        for (const comp of components) {
            if (comp.type === 1 && comp.components && comp.components.length < 5) {
                comp.components.push(buttonObj);
                added = true;
                break;
            }
        }
        if (!added) {
            components.push({
                type: 1,
                components: [buttonObj],
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
            console.error("Error in Add Button PATCH:", err);
            return interaction.editReply({
                content: `${STRINGS.errors.failedToEdit}: ${err.message}`,
            });
        }
    },
    resolveButtonEmoji,
};
