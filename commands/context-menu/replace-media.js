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

function collectAllMediaItems(components) {
    if (!components) return [];
    let list = [];
    for (const comp of components) {
        if (comp.type === 12 && comp.items) {
            list.push(...comp.items);
        } else if (comp.type === 17 && comp.components) {
            list.push(...collectAllMediaItems(comp.components));
        }
    }
    return list;
}

function replaceMediaInComponents(components, selectedIndices, newMediaItems) {
    let globalIndex = 0;
    let replacementIndex = 0;
    const selectedSet = new Set(selectedIndices);

    function processItems(items) {
        const newItems = [];
        for (const item of items) {
            globalIndex++;
            if (selectedSet.has(globalIndex)) {
                if (replacementIndex < newMediaItems.length) {
                    newItems.push(newMediaItems[replacementIndex]);
                    replacementIndex++;
                }
            } else {
                newItems.push(item);
            }
        }
        return newItems;
    }

    function traverse(comps) {
        const result = [];
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                const processed = processItems(comp.items);
                if (processed.length > 0) {
                    result.push({ ...comp, items: processed });
                }
            } else if (comp.type === 17 && comp.components) {
                const inner = traverse(comp.components);
                if (inner.length > 0) {
                    result.push({ ...comp, components: inner });
                }
            } else {
                result.push(comp);
            }
        }
        return result;
    }

    let updated = traverse(components);

    // If extra replacement items remain, append them to the last media gallery
    if (replacementIndex < newMediaItems.length) {
        const extras = newMediaItems.slice(replacementIndex);
        let attached = false;
        for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].type === 12) {
                updated[i].items.push(...extras);
                attached = true;
                break;
            }
        }
        if (!attached) {
            updated.push({ type: 12, items: extras });
        }
    }

    return updated;
}

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Replace Media')
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
                content: 'This message does not contain any images or media gallery items to replace.',
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
                    .setDescription(`Replace Image #${index}`)
            );
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('media_indices')
            .setPlaceholder('Select image index(es) to replace')
            .setMinValues(1)
            .setMaxValues(existingMedia.length)
            .addOptions(selectOptions);

        const selectLabel = new LabelBuilder()
            .setLabel('Target Image Index(es) to Replace')
            .setStringSelectMenuComponent(selectMenu);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('replacement_files')
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(10);

        const fileLabel = new LabelBuilder()
            .setLabel('Upload Replacement Image(s)')
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId(`replace_media_modal_${interaction.targetId}`)
            .setTitle('Replace Media')
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
                content: 'No image index was selected.'
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
                content: 'No replacement images were uploaded.'
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
                content: `Image(s) at index [${selectedIndices.join(', ')}] replaced successfully!`
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'Failed to replace media on this message.'
            });
        }
    }
};
