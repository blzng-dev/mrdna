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

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Remove Media')
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (interaction.targetMessage.author.id !== interaction.client.user.id) {
            return interaction.reply({
                content: 'I can only manage media on my own messages.',
                flags: MessageFlags.Ephemeral
            });
        }

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, interaction.targetId)
        );

        const existingMedia = collectAllMediaItems(rawMessage.components);
        if (existingMedia.length === 0) {
            return interaction.reply({
                content: 'This message does not contain any images or media gallery items to remove.',
                flags: MessageFlags.Ephemeral
            });
        }

        const selectOptions = [];
        for (let i = 0; i < existingMedia.length; i++) {
            const index = i + 1;
            selectOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Image ${index}`)
                    .setValue(`${index}`)
                    .setDescription(`Remove Image #${index}`)
            );
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('remove_media_indices')
            .setPlaceholder('Select image index(es) to remove')
            .setMinValues(1)
            .setMaxValues(existingMedia.length)
            .addOptions(selectOptions);

        const selectLabel = new LabelBuilder()
            .setLabel('Images to Remove')
            .setStringSelectMenuComponent(selectMenu);

        const modal = new ModalBuilder()
            .setCustomId(`remove_media_modal_${interaction.targetId}`)
            .setTitle('Remove Media')
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
                content: 'No image index was selected.'
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
                content: `Successfully removed ${selectedIndices.length} image(s) (Image #${selectedIndices.join(', #')}) from the message!`
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'Failed to remove media from the message.'
            });
        }
    }
};
