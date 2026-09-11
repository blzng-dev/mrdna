const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    MessageFlags,
    Routes
} = require('discord.js');

const { findEmojiByNameOrId } = require('../../utils/emojiResolver');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Add Link Button')
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (interaction.targetMessage.author.id !== interaction.client.user.id) {
            return interaction.reply({
                content: 'I can only add buttons to my own messages.',
                flags: MessageFlags.Ephemeral
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`add_link_modal_${interaction.targetId}`)
            .setTitle('Add Link Button');

        const labelInput = new TextInputBuilder()
            .setCustomId('button_label')
            .setLabel('Label')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const urlInput = new TextInputBuilder()
            .setCustomId('button_url')
            .setLabel('Link URL')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const emojiInput = new TextInputBuilder()
            .setCustomId('button_emoji')
            .setLabel('Emoji (Name, ID, or <a:name:id>)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(labelInput),
            new ActionRowBuilder().addComponents(urlInput),
            new ActionRowBuilder().addComponents(emojiInput)
        );

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        const messageId = interaction.customId.replace('add_link_modal_', '');
        const label = interaction.fields.getTextInputValue('button_label');
        const url = interaction.fields.getTextInputValue('button_url');
        const emojiStr = interaction.fields.getTextInputValue('button_emoji');

        const button = {
            type: 2,
            style: 5,
            label: label,
            url: url
        };

        if (emojiStr && emojiStr.trim().length > 0) {
            const emoji = await findEmojiByNameOrId(interaction.client, emojiStr);
            if (emoji) {
                button.emoji = emoji;
            }
        }

        try {
            const rawMessage = await interaction.client.rest.get(
                Routes.channelMessage(interaction.channelId, messageId)
            );

            const components = rawMessage.components ? [...rawMessage.components] : [];
            
            // Find existing ActionRow that contains buttons, or create a new one.
            // V1 ActionRow is type: 1. It can hold up to 5 buttons.
            let buttonRow = null;
            for (const row of components) {
                if (row.type === 1 && (!row.components || row.components.every(c => c.type === 2)) && (row.components && row.components.length < 5)) {
                    buttonRow = row;
                    break;
                }
            }

            if (buttonRow) {
                buttonRow.components.push(button);
            } else {
                components.push({
                    type: 1,
                    components: [button]
                });
            }

            await interaction.client.rest.patch(
                Routes.channelMessage(interaction.channelId, messageId),
                {
                    body: {
                        components: components,
                        flags: rawMessage.flags
                    }
                }
            );

            await interaction.reply({
                content: 'Link button added successfully.',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: 'Failed to add link button. Make sure the URL is valid.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
