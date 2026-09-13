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

function countGalleriesAndItems(components) {
    let galleryCount = 0;
    let totalItems = 0;
    const galleryInfo = [];

    function traverse(comps) {
        if (!comps) return;
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                galleryCount++;
                totalItems += comp.items.length;
                galleryInfo.push({
                    galleryNumber: galleryCount,
                    itemCount: comp.items.length
                });
            } else if (comp.type === 17 && comp.components) {
                traverse(comp.components);
            }
        }
    }

    traverse(components);
    return { galleryCount, totalItems, galleryInfo };
}

function insertMediaIntoComponents(components, targetChoice, positionChoice, newMediaItems) {
    let currentGalleryIndex = 0;

    function insertIntoArray(existing, newItems, pos) {
        if (pos === 'start' || pos === '1') {
            return [...newItems, ...existing].slice(0, 10);
        }
        if (pos === 'end' || isNaN(Number(pos))) {
            return [...existing, ...newItems].slice(0, 10);
        }
        const insertIdx = Math.min(Math.max(0, Number(pos) - 1), existing.length);
        return [...existing.slice(0, insertIdx), ...newItems, ...existing.slice(insertIdx)].slice(0, 10);
    }

    function traverse(comps) {
        const result = [];
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                currentGalleryIndex++;
                if (targetChoice === `${currentGalleryIndex}`) {
                    const mergedItems = insertIntoArray(comp.items, newMediaItems, positionChoice);
                    result.push({
                        ...comp,
                        items: mergedItems
                    });
                } else {
                    result.push(comp);
                }
            } else if (comp.type === 17 && comp.components) {
                result.push({
                    ...comp,
                    components: traverse(comp.components)
                });
            } else {
                result.push(comp);
            }
        }
        return result;
    }

    if (targetChoice === 'new') {
        const updated = traverse(components);
        const newGallery = {
            type: 12,
            items: newMediaItems.slice(0, 10)
        };
        if (positionChoice === 'start' || positionChoice === '1') {
            updated.unshift(newGallery);
        } else if (positionChoice === 'end' || isNaN(Number(positionChoice))) {
            updated.push(newGallery);
        } else {
            const insertIdx = Math.min(Math.max(0, Number(positionChoice) - 1), updated.length);
            updated.splice(insertIdx, 0, newGallery);
        }
        return updated;
    }

    return traverse(components);
}

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Add Media')
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

        const { galleryCount, galleryInfo } = countGalleriesAndItems(rawMessage.components);

        const selectOptions = [];
        for (const info of galleryInfo) {
            selectOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Gallery ${info.galleryNumber}`)
                    .setValue(`${info.galleryNumber}`)
                    .setDescription(`Add to Gallery ${info.galleryNumber} (${info.itemCount} image${info.itemCount === 1 ? '' : 's'})`)
            );
        }

        selectOptions.push(
            new StringSelectMenuOptionBuilder()
                .setLabel('New Gallery')
                .setValue('new')
                .setDescription('Create a new Media Gallery in the message')
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('target_gallery')
            .setPlaceholder('Select which gallery to add media to')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(selectOptions);

        const selectLabel = new LabelBuilder()
            .setLabel('Target Gallery')
            .setStringSelectMenuComponent(selectMenu);

        const positionOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel('End / Bottom (Default)')
                .setValue('end')
                .setDescription('Append to the end of the gallery / bottom of message'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Start / Top (Position 1)')
                .setValue('1')
                .setDescription('Insert at the beginning of the gallery / top of message')
        ];

        for (let p = 2; p <= 10; p++) {
            positionOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Position ${p}`)
                    .setValue(`${p}`)
                    .setDescription(`Insert at position ${p} (after image ${p - 1})`)
            );
        }

        const positionSelect = new StringSelectMenuBuilder()
            .setCustomId('media_position')
            .setPlaceholder('Select position (defaults to End/Bottom)')
            .setRequired(false)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(positionOptions);

        const positionLabel = new LabelBuilder()
            .setLabel('Position in Gallery / Message')
            .setStringSelectMenuComponent(positionSelect);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('media_files')
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(10);

        const fileLabel = new LabelBuilder()
            .setLabel('Upload Image(s)')
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId(`add_media_modal_${interaction.targetId}`)
            .setTitle('Add Media')
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
                content: 'No images were uploaded.'
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
            await interaction.editReply({
                content: `Successfully added ${newMediaItems.length} image(s) to ${targetChoice === 'new' ? 'a new gallery' : `Gallery ${targetChoice}`} at ${posDesc}!`
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'Failed to add media to the message.'
            });
        }
    }
};
