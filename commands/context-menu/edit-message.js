const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    MessageFlags,
    Routes
} = require('discord.js');

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
            for (const comp of rawMessage.components) {
                if (comp.type === 10) {
                    text += comp.content;
                } else if (comp.type === 14) {
                    const spacing = comp.spacing !== undefined ? comp.spacing : 1;
                    const divider = comp.divider !== undefined ? comp.divider : true;

                    const spacingStr = spacing !== 1 ? spacing.toString() : '';
                    const divStrFinal = divider === false ? 'false' : '';
                    text += `\n${spacingStr}---${divStrFinal}\n`;
                }
            }
        }

        if (!text && rawMessage.content) {
            text = rawMessage.content;
        }

        if (text.length > 4000) {
            text = text.substring(0, 4000);
        }

        const modal = new ModalBuilder()
            .setCustomId(`edit_message_modal_${interaction.targetId}`)
            .setTitle('Edit Message');

        const textInput = new TextInputBuilder()
            .setCustomId('message_input')
            .setLabel('Text')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(text || ' '); // Must provide some value if empty but required

        const actionRow = new ActionRowBuilder().addComponents(textInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        const messageId = interaction.customId.replace('edit_message_modal_', '');
        const rawText = interaction.fields.getTextInputValue('message_input');

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
            
            const existingOtherComponents = rawMessage.components ? 
                rawMessage.components.filter(c => c.type !== 10 && c.type !== 14) : [];

            await interaction.client.rest.patch(
                Routes.channelMessage(interaction.channelId, messageId),
                {
                    body: {
                        content: '', // Clear old content if migrating to V2
                        components: [...components, ...existingOtherComponents],
                        flags: MessageFlags.IsComponentsV2 || (1 << 15)
                    }
                }
            );

            await interaction.reply({
                content: 'Message edited successfully.',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: 'Failed to edit message.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
