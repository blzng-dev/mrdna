const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    FileUploadBuilder,
    AttachmentBuilder,
    MessageFlags,
    Routes
} = require('discord.js');

const { collectAllMediaItems, replaceMediaInComponents } = require('../../utils/messageParser');

const STRINGS = {
    command: {
        name: 'Replace Media',
    },
    modals: {
        title: 'Replace Media',
        selectLabel: 'Target Image Index(es) to Replace',
        placeholder: 'Select image index(es) to replace',
        optionLabel: (index) => `Image ${index}`,
        optionDesc: (index) => `Replace Image #${index}`,
        uploadLabel: 'Upload Replacement Image(s)',
    },
    errors: {
        notOwnMessage: 'I can only manage media on my own messages.',
        noMedia: 'This message does not contain any images or media gallery items to replace.',
        noSelection: 'No image index was selected.',
        noReplacementUploaded: 'No replacement images were uploaded.',
        failedToReplace: 'Failed to replace media on this message.',
    },
    messages: {
        replacedSuccess: (indicesStr) => `Image(s) at index [${indicesStr}] replaced successfully!`,
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
            .setCustomId('media_indices')
            .setPlaceholder(STRINGS.modals.placeholder)
            .setMinValues(1)
            .setMaxValues(existingMedia.length)
            .addOptions(selectOptions);

        const selectLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.selectLabel)
            .setStringSelectMenuComponent(selectMenu);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('replacement_files')
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(10);

        const fileLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.uploadLabel)
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId(`replace_media_modal_${interaction.targetId}`)
            .setTitle(STRINGS.modals.title)
            .addComponents(selectLabel, fileLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.customId.replace('replace_media_modal_', '');

        const indicesField = interaction.fields?.fields?.get('media_indices');
        const selectedIndices = (indicesField?.values || []).map(Number).sort((a, b) => a - b);

        if (selectedIndices.length === 0) {
            return interaction.editReply({
                content: STRINGS.errors.noSelection
            });
        }

        // Extract uploaded files
        let attachments = [];
        try {
            const files = interaction.fields.getUploadedFiles('replacement_files');
            if (files && files.size > 0) attachments = Array.from(files.values());
        } catch (_) {}
        if (attachments.length === 0) {
            if (interaction.fields?.attachments?.size > 0) {
                attachments = Array.from(interaction.fields.attachments.values());
            } else if (interaction.data?.resolved?.attachments) {
                attachments = Object.values(interaction.data.resolved.attachments);
            }
        }

        if (attachments.length === 0) {
            return interaction.editReply({
                content: STRINGS.errors.noReplacementUploaded
            });
        }

        const filesToSend = [];
        const newMediaItems = [];
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            let filename = att.name || `replacement_${Date.now()}_${i + 1}.png`;
            filename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            if (att.url) {
                filesToSend.push(new AttachmentBuilder(att.url, { name: filename }));
                newMediaItems.push({
                    media: { url: `attachment://${filename}` }
                });
            }
        }

        try {
            const channel = await interaction.client.channels.fetch(interaction.channelId);
            const targetMessage = await channel.messages.fetch(messageId);

            const rawMessage = await interaction.client.rest.get(
                Routes.channelMessage(interaction.channelId, messageId)
            );

            const updatedComponents = replaceMediaInComponents(
                rawMessage.components || [],
                selectedIndices,
                newMediaItems
            );

            await targetMessage.edit({
                components: updatedComponents,
                files: filesToSend,
                flags: MessageFlags.IsComponentsV2 || (1 << 15)
            });

            await interaction.editReply({
                content: STRINGS.messages.replacedSuccess(selectedIndices.join(', '))
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: STRINGS.errors.failedToReplace
            });
        }
    }
};
