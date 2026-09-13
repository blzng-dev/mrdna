const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    LabelBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    FileUploadBuilder,
    AttachmentBuilder,
    ChannelType
} = require('discord.js');
const { resolveEmojisInText } = require('../../utils/emojiResolver');

const STRINGS = {
    command: {
        name: 'message',
        description: 'Send a formatted message using components v2'
    },
    modal: {
        title: 'Message',
        input_label: 'Text',
        channel_label: 'Target Channel',
        mentions_label: 'Allow Mentions',
        files_label: 'Upload Attachments'
    },
    errors: {
        no_content: 'No content was provided.'
    }
};

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

    // If there are any unused media items left, bundle them in a gallery at the bottom
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description),
        
    async execute(interaction) {
        const textInput = new TextInputBuilder()
            .setCustomId('message_input')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const textLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.input_label)
            .setTextInputComponent(textInput);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('message_channel')
            .setPlaceholder('Select a channel (defaults to current)')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
        
        const channelLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.channel_label)
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
            .setLabel(STRINGS.modal.mentions_label)
            .setStringSelectMenuComponent(mentionsSelect);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('message_files')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(10);

        const filesLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.files_label)
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId('message_modal')
            .setTitle(STRINGS.modal.title)
            .addComponents(textLabel, channelLabel, mentionsLabel, filesLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let channelId = interaction.channelId;
        const channelField = interaction.fields?.fields?.get('message_channel');
        if (channelField?.values?.length > 0) {
            channelId = channelField.values[0];
        }

        let mentions = false;
        const mentionsField = interaction.fields?.fields?.get('message_mentions');
        if (mentionsField?.values?.length > 0) {
            mentions = mentionsField.values[0] === 'true';
        }

        let rawText = '';
        try {
            rawText = interaction.fields.getTextInputValue('message_input');
        } catch {
            const textfield = interaction.fields?.fields?.get('message_input');
            rawText = textfield?.value || '';
        }

        rawText = await resolveEmojisInText(interaction.client, rawText);

        // Extract uploaded files
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
        const allMediaItems = [];
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            let filename = att.name || `file_${i + 1}.png`;
            filename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            if (att.url) {
                filesToSend.push(new AttachmentBuilder(att.url, { name: filename }));
                // No alt text (description) as requested
                allMediaItems.push({
                    media: { url: `attachment://${filename}` }
                });
            }
        }

        const components = parseComponents(rawText, allMediaItems);

        if (components.length === 0 && filesToSend.length === 0) {
            return interaction.editReply({
                content: STRINGS.errors.no_content
            });
        }

        try {
            const targetChannel = await interaction.client.channels.fetch(channelId);
            if (!targetChannel || !targetChannel.send) {
                throw new Error('Target channel not found or cannot send messages.');
            }

            const sendOptions = {
                components: components,
                flags: MessageFlags.IsComponentsV2 || (1 << 15),
                allowedMentions: mentions ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] }
            };
            if (filesToSend.length > 0) {
                sendOptions.files = filesToSend;
            }

            await targetChannel.send(sendOptions);

            await interaction.editReply({
                content: 'Message sent successfully!'
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'Failed to send message. Make sure I have permissions in that channel.'
            });
        }
    }
};
