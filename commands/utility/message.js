const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    Routes,
    LabelBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType
} = require('discord.js');

const STRINGS = {
    command: {
        name: 'message',
        description: 'Send a formatted message using components v2'
    },
    modal: {
        title: 'Message',
        input_label: 'Text',
        channel_label: 'Target Channel',
        mentions_label: 'Allow Mentions'
    },
    errors: {
        no_content: 'No content was provided.'
    }
};

function parseTextAndSeparators(rawText) {
    const parts = rawText.split(/^(\d+)?---(true|false)?$/m);
    const components = [];

    for (let i = 0; i < parts.length; i += 3) {
        const textSection = parts[i].trim();
        if (textSection.length > 0) {
            components.push({
                type: 10,
                content: textSection
            });
        }

        if (i + 3 < parts.length) {
            const sizeStr = parts[i + 1];
            const divStr = parts[i + 2];
            
            const spacing = sizeStr ? parseInt(sizeStr, 10) : 1;
            const divider = divStr === 'false' ? false : true;

            components.push({
                type: 14,
                divider: divider,
                spacing: spacing
            });
        }
    }
    return components;
}

function parseComponents(rawText) {
    const components = [];
    const containerRegex = /(?:^|\n)c---([^\n]*)\r?\n([\s\S]*?)(?:\r?\n\/?c---(?:\r?\n|$)|$)/g;
    let lastIndex = 0;
    let match;

    while ((match = containerRegex.exec(rawText)) !== null) {
        const textBefore = rawText.slice(lastIndex, match.index);
        if (textBefore.trim().length > 0) {
            components.push(...parseTextAndSeparators(textBefore));
        }

        const header = match[1].trim();
        const containerContent = match[2];
        const containerComponents = parseTextAndSeparators(containerContent);

        if (containerComponents.length > 0) {
            const container = {
                type: 17,
                components: containerComponents
            };

            if (header) {
                const hexMatch = header.match(/#?([0-9a-fA-F]{6})/);
                if (hexMatch) {
                    container.accent_color = parseInt(hexMatch[1], 16);
                }
                if (/\bspoiler\b/i.test(header)) {
                    container.spoiler = true;
                }
            }

            components.push(container);
        }

        lastIndex = containerRegex.lastIndex;
    }

    const remainingText = rawText.slice(lastIndex);
    if (remainingText.trim().length > 0) {
        components.push(...parseTextAndSeparators(remainingText));
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

        const modal = new ModalBuilder()
            .setCustomId('message_modal')
            .setTitle(STRINGS.modal.title)
            .addComponents(textLabel, channelLabel, mentionsLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
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

        const components = parseComponents(rawText);

        if (components.length === 0) {
            return interaction.reply({
                content: STRINGS.errors.no_content,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await interaction.client.rest.post(
                Routes.channelMessages(channelId),
                {
                    body: {
                        components: components,
                        flags: MessageFlags.IsComponentsV2 || (1 << 15),
                        allowed_mentions: mentions ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] }
                    }
                }
            );

            await interaction.reply({
                content: 'Message sent successfully!',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: 'Failed to send message. Make sure I have permissions in that channel.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
