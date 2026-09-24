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
const { reconstructText, parseComponents, collectAllMediaItems } = require('../../utils/messageParser');
const { createForumDraft } = require('../../utils/forumHandler');

const STRINGS = {
    command: {
        name: 'Edit Message',
    },
    modals: {
        title: 'Edit Message',
        textLabel: 'Text',
        channelLabel: 'Target Channel',
        channelPlaceholder: 'Select a channel (defaults to current)',
        mentionsLabel: 'Allow Mentions',
        mentionsPlaceholder: 'Mention users/roles? (defaults to No)',
        mentionsOptionNo: 'No (Default)',
        mentionsOptionYes: 'Yes',
        filesLabel: 'Upload New Image(s) (Appended to index list)',
    },
    errors: {
        notOwnMessage: 'I can only edit my own messages.',
        noContent: 'No content was provided.',
        targetChannelNotFound: 'Target channel not found.',
        failedToEdit: 'Failed to edit/move message.',
    },
    messages: {
        movedAndEdited: (channelId) => `Message moved and edited in <#${channelId}> successfully.`,
        editedSuccess: 'Message edited successfully.',
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
            .setLabel(STRINGS.modals.textLabel)
            .setTextInputComponent(textInput);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('message_channel')
            .setPlaceholder(STRINGS.modals.channelPlaceholder)
            .setRequired(false)
            .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildForum,
                ChannelType.GuildMedia,
                ChannelType.PublicThread,
                ChannelType.PrivateThread,
                ChannelType.AnnouncementThread,
                ChannelType.GuildVoice,
                ChannelType.GuildStageVoice
            );

        const channelLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.channelLabel)
            .setChannelSelectMenuComponent(channelSelect);

        const mentionsSelect = new StringSelectMenuBuilder()
            .setCustomId('message_mentions')
            .setPlaceholder(STRINGS.modals.mentionsPlaceholder)
            .setRequired(false)
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel(STRINGS.modals.mentionsOptionNo).setValue('false'),
                new StringSelectMenuOptionBuilder().setLabel(STRINGS.modals.mentionsOptionYes).setValue('true')
            );

        const mentionsLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.mentionsLabel)
            .setStringSelectMenuComponent(mentionsSelect);

        const fileUpload = new FileUploadBuilder()
            .setCustomId('message_files')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(10);

        const fileLabel = new LabelBuilder()
            .setLabel(STRINGS.modals.filesLabel)
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId(`edit_message_modal_${interaction.targetId}`)
            .setTitle(STRINGS.modals.title)
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

        rawText = await resolveEmojisInText(interaction.client, rawText, true);

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
            const targetChannel = await interaction.client.channels.fetch(targetChannelId);
            if (!targetChannel) {
                throw new Error(STRINGS.errors.targetChannelNotFound);
            }

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
                    content: STRINGS.errors.noContent
                });
            }
            
            // Keep ActionRows (e.g. link buttons)
            const existingOtherComponents = rawMessage.components ? 
                rawMessage.components.filter(c => c.type === 1) : [];

            const allowedMentionsPayload = mentions ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] };

            // Check if moving to a Forum or Media channel
            if (targetChannel.type === ChannelType.GuildForum || targetChannel.type === ChannelType.GuildMedia) {
                const draftId = `${interaction.id}_${Date.now()}`;

                let defaultTitle = '';
                const firstLine = rawText.split('\n').map(l => l.trim()).find(l => l.length > 0 && !l.startsWith('c---') && !l.startsWith('-media') && !l.startsWith('---'));
                if (firstLine) {
                    defaultTitle = firstLine.replace(/^[#\s]+/, '').substring(0, 80);
                }

                const setupPayload = createForumDraft({
                    id: draftId,
                    userId: interaction.user.id,
                    targetChannel,
                    components: [...components, ...existingOtherComponents],
                    files: filesToSend,
                    allowedMentions: allowedMentionsPayload,
                    defaultTitle,
                    oldMessageId: messageId,
                    oldChannelId: interaction.channelId
                });

                return interaction.editReply(setupPayload);
            }

            if (targetChannelId !== interaction.channelId) {
                // Post edited message in the new channel
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
                    const originChannel = await interaction.client.channels.fetch(interaction.channelId);
                    const originMessage = await originChannel.messages.fetch(messageId);
                    await originMessage.delete();
                } catch (delErr) {
                    console.warn('Failed to delete old message during move:', delErr);
                }

                await interaction.editReply({
                    content: STRINGS.messages.movedAndEdited(targetChannelId)
                });
            } else {
                // Edit in-place
                const originChannel = await interaction.client.channels.fetch(interaction.channelId);
                const targetMessage = await originChannel.messages.fetch(messageId);
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
                    content: STRINGS.messages.editedSuccess
                });
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: STRINGS.errors.failedToEdit
            });
        }
    }
};
