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
    ChannelType
} = require('discord.js');
const { resolveEmojisInText } = require('../../utils/emojiResolver');

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

function reconstructText(components) {
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

        const modal = new ModalBuilder()
            .setCustomId(`edit_message_modal_${interaction.targetId}`)
            .setTitle('Edit Message')
            .addComponents(textLabel, channelLabel, mentionsLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
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

        const components = parseComponents(rawText);

        if (components.length === 0) {
            return interaction.reply({
                content: 'No content was provided.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const rawMessage = await interaction.client.rest.get(
                Routes.channelMessage(interaction.channelId, messageId)
            );
            
            // Keep ActionRows (e.g. link buttons)
            const existingOtherComponents = rawMessage.components ? 
                rawMessage.components.filter(c => c.type === 1) : [];

            const allowedMentionsPayload = mentions ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] };

            if (targetChannelId !== interaction.channelId) {
                // Post edited message in the new channel
                await interaction.client.rest.post(
                    Routes.channelMessages(targetChannelId),
                    {
                        body: {
                            components: [...components, ...existingOtherComponents],
                            flags: MessageFlags.IsComponentsV2 || (1 << 15),
                            allowed_mentions: allowedMentionsPayload
                        }
                    }
                );

                // Delete old message from the original channel
                try {
                    await interaction.client.rest.delete(
                        Routes.channelMessage(interaction.channelId, messageId)
                    );
                } catch (delErr) {
                    console.warn('Failed to delete old message during move:', delErr);
                }

                await interaction.reply({
                    content: `Message moved and edited in <#${targetChannelId}> successfully.`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                // Edit in-place
                await interaction.client.rest.patch(
                    Routes.channelMessage(interaction.channelId, messageId),
                    {
                        body: {
                            content: '', // Clear old content if migrating to V2
                            components: [...components, ...existingOtherComponents],
                            flags: MessageFlags.IsComponentsV2 || (1 << 15),
                            allowed_mentions: allowedMentionsPayload
                        }
                    }
                );

                await interaction.reply({
                    content: 'Message edited successfully.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: 'Failed to edit/move message.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
