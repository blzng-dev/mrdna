const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    Routes,
    LabelBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    FileUploadBuilder,
    AttachmentBuilder,
    ChannelType
} = require('discord.js');
const { resolveEmojisInText } = require('../../utils/emojiResolver');

function parseTextAndSeparators(rawText, allMediaItems, usedIndices) {
    const lines = rawText.split(/\r?\n/);
    const components = [];
    let currentTextLines = [];

    function flushText() {
        const text = currentTextLines.join('\n').trim();
        if (text.length > 0) {
            components.push({
                type: 10,
                content: text
            });
        }
        currentTextLines = [];
    }

    for (const line of lines) {
        const trimmed = line.trim();
        const sepMatch = trimmed.match(/^(\d+)?---(true|false)?$/);
        const mediaMatch = trimmed.match(/^-media(?:\[([\d\s,]+)\])?$/);

        if (sepMatch) {
            flushText();
            const sizeStr = sepMatch[1];
            const divStr = sepMatch[2];
            const spacing = sizeStr ? parseInt(sizeStr, 10) : 1;
            const divider = divStr === 'false' ? false : true;
            components.push({
                type: 14,
                divider: divider,
                spacing: spacing
            });
        } else if (mediaMatch) {
            flushText();
            if (allMediaItems && allMediaItems.length > 0) {
                let galleryItems = [];
                if (mediaMatch[1]) {
                    const indices = mediaMatch[1].split(',').map(n => parseInt(n.trim(), 10) - 1).filter(n => !isNaN(n));
                    for (const idx of indices) {
                        if (allMediaItems[idx] && !usedIndices.has(idx)) {
                            galleryItems.push(allMediaItems[idx]);
                            usedIndices.add(idx);
                        }
                    }
                } else {
                    for (let i = 0; i < allMediaItems.length; i++) {
                        if (!usedIndices.has(i)) {
                            galleryItems.push(allMediaItems[i]);
                            usedIndices.add(i);
                        }
                    }
                }
                if (galleryItems.length > 0) {
                    components.push({
                        type: 12,
                        items: galleryItems.slice(0, 10)
                    });
                }
            }
        } else {
            currentTextLines.push(line);
        }
    }
    flushText();
    return components;
}

function parseComponents(rawText, allMediaItems) {
    const usedIndices = new Set();
    const components = [];
    const lines = rawText.split(/\r?\n/);

    let insideContainer = false;
    let containerHeader = '';
    let containerLines = [];
    let outsideLines = [];

    function flushOutside() {
        if (outsideLines.length > 0) {
            const text = outsideLines.join('\n');
            if (text.trim().length > 0) {
                components.push(...parseTextAndSeparators(text, allMediaItems, usedIndices));
            }
            outsideLines = [];
        }
    }

    function flushContainer() {
        if (containerLines.length > 0) {
            const text = containerLines.join('\n');
            const innerComponents = parseTextAndSeparators(text, allMediaItems, usedIndices);
            if (innerComponents.length > 0) {
                const container = {
                    type: 17,
                    components: innerComponents
                };
                if (containerHeader) {
                    const hexMatch = containerHeader.match(/#?([0-9a-fA-F]{6})/);
                    if (hexMatch) {
                        container.accent_color = parseInt(hexMatch[1], 16);
                    }
                    if (/\bspoiler\b/i.test(containerHeader)) {
                        container.spoiler = true;
                    }
                }
                components.push(container);
            }
            containerLines = [];
            containerHeader = '';
        }
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!insideContainer && trimmed.startsWith('c---')) {
            flushOutside();
            insideContainer = true;
            containerHeader = trimmed.slice(4).trim();
            containerLines = [];
        } else if (insideContainer && (trimmed === '/c---' || trimmed === 'c---')) {
            flushContainer();
            insideContainer = false;
        } else if (insideContainer) {
            containerLines.push(line);
        } else {
            outsideLines.push(line);
        }
    }

    if (insideContainer) {
        flushContainer();
    } else {
        flushOutside();
    }

    if (allMediaItems && allMediaItems.length > 0) {
        const remainingItems = [];
        for (let i = 0; i < allMediaItems.length; i++) {
            if (!usedIndices.has(i)) {
                remainingItems.push(allMediaItems[i]);
                usedIndices.add(i);
            }
        }
        if (remainingItems.length > 0) {
            components.push({
                type: 12,
                items: remainingItems.slice(0, 10)
            });
        }
    }

    return components;
}

function reconstructText(components) {
    let globalImageCounter = 0;

    function formatTextAndSeparators(comps) {
        let res = '';
        for (const comp of comps) {
            if (comp.type === 10) {
                res += (res.length > 0 && !res.endsWith('\n') ? '\n' : '') + comp.content;
            } else if (comp.type === 14) {
                const spacing = comp.spacing !== undefined ? comp.spacing : 1;
                const divider = comp.divider !== undefined ? comp.divider : true;
                const spacingStr = spacing !== 1 ? spacing.toString() : '';
                const divStrFinal = divider === false ? 'false' : '';
                res += '\n' + spacingStr + '---' + divStrFinal + '\n';
            } else if (comp.type === 12 && comp.items) {
                const indices = [];
                for (let i = 0; i < comp.items.length; i++) {
                    globalImageCounter++;
                    indices.push(globalImageCounter);
                }
                res += (res.length > 0 && !res.endsWith('\n') ? '\n' : '') + `-media[${indices.join(', ')}]\n`;
            }
        }
        return res;
    }

    let text = '';
    for (const comp of components) {
        if (comp.type === 10) {
            text += (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + comp.content;
        } else if (comp.type === 14) {
            const spacing = comp.spacing !== undefined ? comp.spacing : 1;
            const divider = comp.divider !== undefined ? comp.divider : true;
            const spacingStr = spacing !== 1 ? spacing.toString() : '';
            const divStrFinal = divider === false ? 'false' : '';
            text += '\n' + spacingStr + '---' + divStrFinal + '\n';
        } else if (comp.type === 12 && comp.items) {
            const indices = [];
            for (let i = 0; i < comp.items.length; i++) {
                globalImageCounter++;
                indices.push(globalImageCounter);
            }
            text += (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + `-media[${indices.join(', ')}]\n`;
        } else if (comp.type === 17 && comp.components) {
            let header = 'c---';
            if (comp.accent_color !== undefined && comp.accent_color !== null) {
                header += '#' + comp.accent_color.toString(16).padStart(6, '0').toUpperCase();
            }
            if (comp.spoiler) {
                header += (header.length > 4 ? ' ' : '') + 'spoiler';
            }
            const innerText = formatTextAndSeparators(comp.components);
            text += (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + header + '\n' + innerText.trim() + '\n/c---\n';
        }
    }
    return text.trim();
}

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

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Edit Message')
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (interaction.targetMessage.author.id !== interaction.client.user.id) {
            return interaction.reply({
                content: 'I can only edit my own messages.',
                flags: MessageFlags.Ephemeral
            });
        }

        const rawMessage = await interaction.client.rest.get(
            Routes.channelMessage(interaction.channelId, interaction.targetId)
        );

        let text = '';

        if (rawMessage.components) {
            text = reconstructText(rawMessage.components);
        }

        if (!text && rawMessage.content) {
            text = rawMessage.content;
        }

        // Simplify <a:name:id> and <:name:id> to :name: for clean editing
        if (text) {
            text = text.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ':$1:');
        }

        if (text.length > 4000) {
            text = text.substring(0, 4000);
        }

        const textInput = new TextInputBuilder()
            .setCustomId('message_input')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(text || ' ');

        const textLabel = new LabelBuilder()
            .setLabel('Text')
            .setTextInputComponent(textInput);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('message_channel')
            .setPlaceholder('Select a channel (defaults to current)')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

        const channelLabel = new LabelBuilder()
            .setLabel('Target Channel')
            .setChannelSelectMenuComponent(channelSelect);

        const mentionsSelect = new StringSelectMenuBuilder()
            .setCustomId('message_mentions')
            .setPlaceholder('Mention users/roles? (defaults to No)')
            .setRequired(false)
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('No (Default)').setValue('false'),
                new StringSelectMenuOptionBuilder().setLabel('Yes').setValue('true')
            );

        const mentionsLabel = new LabelBuilder()
            .setLabel('Allow Mentions')
            .setStringSelectMenuComponent(mentionsSelect);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('message_files')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(10);

        const fileLabel = new LabelBuilder()
            .setLabel('Upload New Image(s) (Appended to index list)')
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId(`edit_message_modal_${interaction.targetId}`)
            .setTitle('Edit Message')
            .addComponents(textLabel, channelLabel, mentionsLabel, fileLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.customId.replace('edit_message_modal_', '');
        
        let rawText = '';
        try {
            rawText = interaction.fields.getTextInputValue('message_input');
        } catch {
            const textfield = interaction.fields?.fields?.get('message_input');
            rawText = textfield?.value || '';
        }

        rawText = await resolveEmojisInText(interaction.client, rawText);

        let targetChannelId = interaction.channelId;
        const channelField = interaction.fields?.fields?.get('message_channel');
        if (channelField?.values?.length > 0) {
            targetChannelId = channelField.values[0];
        }

        let mentions = false;
        const mentionsField = interaction.fields?.fields?.get('message_mentions');
        if (mentionsField?.values?.length > 0) {
            mentions = mentionsField.values[0] === 'true';
        }

        // Extract newly uploaded files if any
        let attachments = [];
        try {
            const files = interaction.fields.getUploadedFiles('message_files');
            if (files && files.size > 0) attachments = Array.from(files.values());
        } catch (_) {}
        if (attachments.length === 0) {
            if (interaction.fields?.attachments?.size > 0) {
                attachments = Array.from(interaction.fields.attachments.values());
            } else if (interaction.data?.resolved?.attachments) {
                attachments = Object.values(interaction.data.resolved.attachments);
            }
        }

        const filesToSend = [];
        const newMediaItems = [];
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            let filename = att.name || `image_${Date.now()}_${i + 1}.png`;
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

            // Existing media items in order
            const existingMediaItems = collectAllMediaItems(rawMessage.components);
            // All media items = existing items + newly uploaded items
            const allMediaItems = [...existingMediaItems, ...newMediaItems];

            const components = parseComponents(rawText, allMediaItems);

            if (components.length === 0) {
                return interaction.editReply({
                    content: 'No content was provided.'
                });
            }
            
            // Keep ActionRows (e.g. link buttons)
            const existingOtherComponents = rawMessage.components ? 
                rawMessage.components.filter(c => c.type === 1) : [];

            const allowedMentionsPayload = mentions ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] };

            if (targetChannelId !== interaction.channelId) {
                // Post edited message in the new channel
                const targetChannel = await interaction.client.channels.fetch(targetChannelId);
                const sendOptions = {
                    components: [...components, ...existingOtherComponents],
                    flags: MessageFlags.IsComponentsV2 || (1 << 15),
                    allowedMentions: allowedMentionsPayload
                };
                if (filesToSend.length > 0) {
                    sendOptions.files = filesToSend;
                }
                await targetChannel.send(sendOptions);

                // Delete old message from the original channel
                try {
                    await targetMessage.delete();
                } catch (delErr) {
                    console.warn('Failed to delete old message during move:', delErr);
                }

                await interaction.editReply({
                    content: `Message moved and edited in <#${targetChannelId}> successfully.`
                });
            } else {
                // Edit in-place
                const editOptions = {
                    content: '',
                    components: [...components, ...existingOtherComponents],
                    flags: MessageFlags.IsComponentsV2 || (1 << 15),
                    allowedMentions: allowedMentionsPayload
                };
                if (filesToSend.length > 0) {
                    editOptions.files = filesToSend;
                }
                await targetMessage.edit(editOptions);

                await interaction.editReply({
                    content: 'Message edited successfully.'
                });
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'Failed to edit/move message.'
            });
        }
    }
};
