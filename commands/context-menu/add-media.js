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

const { countGalleriesAndItems, insertMediaIntoComponents } = require('../../utils/messageParser');

const STRINGS = {
    command: {
        name: 'Add Media',
    },
    modals: {
        title: 'Add Media',
        galleryLabel: 'Target Gallery',
        galleryPlaceholder: 'Select which gallery to add media to',
        galleryOption: (num) => `Gallery ${num}`,
        galleryOptionDesc: (num, count) => `Add to Gallery ${num} (${count} image${count === 1 ? '' : 's'})`,
        newGalleryOption: 'New Gallery',
        newGalleryOptionDesc: 'Create a new Media Gallery in the message',
        positionLabel: 'Position in Gallery / Message',
        positionPlaceholder: 'Select position (defaults to End/Bottom)',
        positionEnd: 'End / Bottom (Default)',
        positionEndDesc: 'Append to the end of the gallery / bottom of message',
        positionStart: 'Start / Top (Position 1)',
        positionStartDesc: 'Insert at the beginning of the gallery / top of message',
        positionN: (p) => `Position ${p}`,
        positionNDesc: (p) => `Insert at position ${p} (after image ${p - 1})`,
        uploadLabel: 'Upload Image(s)',
    },
    errors: {
        notOwnMessage: 'I can only manage media on my own messages.',
        noImagesUploaded: 'No images were uploaded.',
        failedToAdd: 'Failed to add media to the message.',
    },
    messages: {
        success: (count, targetText, posDesc) => `Successfully added ${count} image(s) to ${targetText} at ${posDesc}!`,
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

        const { galleryCount, galleryInfo } = countGalleriesAndItems(rawMessage.components);

        const selectOptions = [];
        for (const info of galleryInfo) {
            selectOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(STRINGS.modals.galleryOption(info.galleryNumber))
                    .setValue(`${info.galleryNumber}`)
                    .setDescription(STRINGS.modals.galleryOptionDesc(info.galleryNumber, info.itemCount))
            );
        }

        selectOptions.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(STRINGS.modals.newGalleryOption)
                .setValue('new')
                .setDescription(STRINGS.modals.newGalleryOptionDesc)
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('target_gallery')
            .setPlaceholder(STRINGS.modals.galleryPlaceholder)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(selectOptions);

        const selectLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.galleryLabel)
            .setStringSelectMenuComponent(selectMenu);

        const positionOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel(STRINGS.modals.positionEnd)
                .setValue('end')
                .setDescription(STRINGS.modals.positionEndDesc),
            new StringSelectMenuOptionBuilder()
                .setLabel(STRINGS.modals.positionStart)
                .setValue('1')
                .setDescription(STRINGS.modals.positionStartDesc)
        ];

        for (let p = 2; p <= 10; p++) {
            positionOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(STRINGS.modals.positionN(p))
                    .setValue(`${p}`)
                    .setDescription(STRINGS.modals.positionNDesc(p))
            );
        }

        const positionSelect = new StringSelectMenuBuilder()
            .setCustomId('media_position')
            .setPlaceholder(STRINGS.modals.positionPlaceholder)
            .setRequired(false)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(positionOptions);

        const positionLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.positionLabel)
            .setStringSelectMenuComponent(positionSelect);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('media_files')
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(10);

        const fileLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.uploadLabel)
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId(`add_media_modal_${interaction.targetId}`)
            .setTitle(STRINGS.modals.title)
            .addComponents(selectLabel, positionLabel, fileLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.customId.replace('add_media_modal_', '');

        const targetField = interaction.fields?.fields?.get('target_gallery');
        const targetChoice = targetField?.values?.[0] || 'new';

        const positionField = interaction.fields?.fields?.get('media_position');
        const positionChoice = positionField?.values?.[0] || 'end';

        // Extract uploaded files
        let attachments = [];
        try {
            const files = interaction.fields.getUploadedFiles('media_files');
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
                content: STRINGS.errors.noImagesUploaded
            });
        }

        const filesToSend = [];
        const newMediaItems = [];
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            let filename = att.name || `media_${Date.now()}_${i + 1}.png`;
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

            const updatedComponents = insertMediaIntoComponents(
                rawMessage.components || [],
                targetChoice,
                positionChoice,
                newMediaItems
            );

            await targetMessage.edit({
                components: updatedComponents,
                files: filesToSend,
                flags: MessageFlags.IsComponentsV2 || (1 << 15)
            });

            const posDesc = positionChoice === 'end' ? 'end' : positionChoice === '1' ? 'start' : `position ${positionChoice}`;
            const targetText = targetChoice === 'new' ? 'a new gallery' : `Gallery ${targetChoice}`;
            await interaction.editReply({
                content: STRINGS.messages.success(newMediaItems.length, targetText, posDesc)
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: STRINGS.errors.failedToAdd
            });
        }
    }
};
