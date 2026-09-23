const { SlashCommandBuilder, ChannelType, ActionRowBuilder, UserSelectMenuBuilder, ComponentType, MessageFlags } = require('discord.js');

const CATEGORY_ID = '860078313631383552';

const STRINGS = {
    command: {
        name: 'create-a-ticket',
        description: 'Creates a generic ticket channel',
        optionUserDescription: 'An initial user to add to the ticket',
    },
    selectMenu: {
        placeholder: 'Select users to add to the ticket',
        prompt: 'Please select the users to add to the ticket:',
    },
    status: {
        creating: 'Creating ticket...',
        created: (channel) => `Ticket channel created: ${channel}`,
    },
    errors: {
        failed: 'Failed to create ticket channel.',
        timeoutOrFailed: 'Ticket creation timed out or failed.',
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addUserOption(option =>
            option.setName('user')
                .setDescription(STRINGS.command.optionUserDescription)
                .setRequired(false)
        ),

    async execute(interaction) {
        const optionUser = interaction.options.getUser('user');

        if (optionUser) {
            // A user was mentioned
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channel = await createTicketChannel(interaction, [optionUser.id]);

            if (channel) {
                await interaction.editReply(STRINGS.status.created(channel));
            } else {
                await interaction.editReply(STRINGS.errors.failed);
            }
        } else {
            // No user mentioned -> Show user select menu
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('ticket_user_select')
                .setPlaceholder(STRINGS.selectMenu.placeholder)
                .setMinValues(1)
                .setMaxValues(10);

            const row = new ActionRowBuilder().addComponents(userSelect);

            const response = await interaction.reply({
                content: STRINGS.selectMenu.prompt,
                components: [row],
                flags: MessageFlags.Ephemeral
            });

            try {
                // Wait for the select menu interaction
                const confirmation = await response.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id && i.customId === 'ticket_user_select',
                    time: 60000, // 1 minute collector
                    componentType: ComponentType.UserSelect
                });

                await confirmation.update({
                    content: STRINGS.status.creating,
                    components: []
                });

                const selectedUserIds = confirmation.values;
                const channel = await createTicketChannel(interaction, selectedUserIds);

                if (channel) {
                    await confirmation.editReply(STRINGS.status.created(channel));
                } else {
                    await confirmation.editReply(STRINGS.errors.failed);
                }
            } catch (error) {
                // If it times out or fails
                await interaction.editReply({
                    content: STRINGS.errors.timeoutOrFailed,
                    components: []
                }).catch(() => { });
            }
        }
    }
};

async function createTicketChannel(interaction, userIds) {
    try {
        // Fetch usernames for the channel name
        const usernames = [];
        for (const id of userIds) {
            try {
                const user = await interaction.client.users.fetch(id);
                usernames.push(user.username);
            } catch (err) {
                usernames.push(id); // Fallback to ID if fetch fails
            }
        }

        const channelName = `ticket-${usernames.join('-')}`.substring(0, 100); // Discord channel names are max 100 characters

        // Create the channel under the category. This automatically inherits the category's permissions initially.
        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: CATEGORY_ID,
        });

        // Add the explicitly chosen users to view the channel
        const overwrites = [...userIds];

        // Also add the command executor so they can view the ticket they just created
        if (!overwrites.includes(interaction.user.id)) {
            overwrites.push(interaction.user.id);
        }

        // Create an overwrite for each selected user and the executor
        for (const userId of overwrites) {
            await channel.permissionOverwrites.create(userId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
        }

        return channel;
    } catch (error) {
        console.error('Error creating ticket channel:', error);
        return null;
    }
}
