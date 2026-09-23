const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    Routes
} = require('discord.js');

const { collectAllMediaItems, removeMediaFromComponents } = require('../../utils/messageParser');

const STRINGS = {
    command: {
        name: 'Remove Media',
    },
    modals: {
        title: 'Remove Media',
        label: 'Images to Remove',
        placeholder: 'Select image index(es) to remove',
        optionLabel: (index) => `Image ${index}`,
        optionDesc: (index) => `Remove Image #${index}`,
    },
    errors: {
        notOwnMessage: 'I can only manage media on my own messages.',
        noMedia: 'This message does not contain any images or media gallery items to remove.',
        noSelection: 'No image index was selected.',
        failedToRemove: 'Failed to remove media from the message.',
    },
    messages: {
        removedSuccess: (count, indicesStr) =>
            `Successfully removed ${count} image(s) (Image #${indicesStr}) from the message!`,
    },
};

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName(STRINGS.command.name)
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (interaction.targetMessage.author.id !== interaction.client.user.id) {
            return interaction.reply({
                content: STRINGS.errors.notOwnMessage,
                flags: MessageFlags.Ephemeral
            });
        }

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, interaction.targetId)
        );

        const existingMedia = collectAllMediaItems(rawMessage.components);
        if (existingMedia.length === 0) {
            return interaction.reply({
                content: STRINGS.errors.noMedia,
                flags: MessageFlags.Ephemeral
            });
        }

        const selectOptions = [];
        for (let i = 0; i < existingMedia.length; i++) {
            const index = i + 1;
            selectOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(STRINGS.modals.optionLabel(index))
                    .setValue(`${index}`)
                    .setDescription(STRINGS.modals.optionDesc(index))
            );
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('remove_media_indices')
            .setPlaceholder(STRINGS.modals.placeholder)
            .setMinValues(1)
            .setMaxValues(existingMedia.length)
            .addOptions(selectOptions);

        const selectLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.label)
            .setStringSelectMenuComponent(selectMenu);

        const modal = new ModalBuilder()
            .setCustomId(`remove_media_modal_${interaction.targetId}`)
            .setTitle(STRINGS.modals.title)
            .addComponents(selectLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.customId.replace('remove_media_modal_', '');

        const indicesField = interaction.fields?.fields?.get('remove_media_indices');
        const selectedIndices = (indicesField?.values || []).map(Number).sort((a, b) => a - b);

        if (selectedIndices.length === 0) {
            return interaction.editReply({
                content: STRINGS.errors.noSelection
            });
        }

        try {
            const channel = await interaction.client.channels.fetch(interaction.channelId);
            const targetMessage = await channel.messages.fetch(messageId);

            const rawMessage = await interaction.client.rest.get(
                Routes.channelMessage(interaction.channelId, messageId)
            );

            const updatedComponents = removeMediaFromComponents(
                rawMessage.components || [],
                selectedIndices
            );

            await targetMessage.edit({
                components: updatedComponents,
                flags: MessageFlags.IsComponentsV2 || (1 << 15)
            });

            await interaction.editReply({
                content: STRINGS.messages.removedSuccess(selectedIndices.length, selectedIndices.join(', #'))
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: STRINGS.errors.failedToRemove
            });
        }
    }
};
