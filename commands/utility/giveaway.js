const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} = require('discord.js');
const db = require('../../db');
const {
    STRINGS: HELPER_STRINGS,
    createGiveawayModal,
    buildGiveawayComponents,
    endGiveaway,
    rerollGiveaway,
} = require('../../utils/giveawayHelper');

const STRINGS = {
    command: {
        name: 'giveaway',
        description: 'Manage server giveaways',
        subcommands: {
            start: {
                name: 'start',
                description: 'Start a new giveaway via modal',
                options: {
                    channel: {
                        name: 'channel',
                        description: 'Channel to host the giveaway (defaults to current channel)',
                    },
                },
            },
            edit: {
                name: 'edit',
                description: 'Edit an active giveaway via modal',
                options: {
                    giveaway: {
                        name: 'giveaway',
                        description: 'Select the active giveaway to edit',
                    },
                },
            },
            end: {
                name: 'end',
                description: 'Immediately end an active giveaway and draw winners',
                options: {
                    giveaway: {
                        name: 'giveaway',
                        description: 'Select the active giveaway to end',
                    },
                },
            },
            reroll: {
                name: 'reroll',
                description: 'Reroll winner(s) for a finished giveaway',
                options: {
                    giveaway: {
                        name: 'giveaway',
                        description: 'Select the ended giveaway to reroll',
                    },
                    winners: {
                        name: 'winners',
                        description: 'Number of winners to reroll (defaults to original count)',
                    },
                },
            },
            cancel: {
                name: 'cancel',
                description: 'Cancel an active giveaway without picking winners',
                options: {
                    giveaway: {
                        name: 'giveaway',
                        description: 'Select the active giveaway to cancel',
                    },
                },
            },
        },
    },
    errors: {
        missingChannelPerms: (channelId) => `:x_: I do not have permission to view or send messages in <#${channelId}>.`,
        notFoundOrNotEnded: ":warning: That giveaway was not found or has not ended yet.",
        notActive: HELPER_STRINGS.NOT_ACTIVE,
    },
    messages: {
        endedSuccess: (prize) => `:checkmark: Successfully ended giveaway **${prize}** and announced winners.`,
        rerolledSuccess: (prize) => `:sync: Successfully rerolled winners for **${prize}**.`,
        cancelledAnnouncement: (prize) => `🚫 Giveaway for **${prize}** was cancelled.`,
        cancelledSuccess: (prize) => `🚫 Successfully cancelled giveaway **${prize}**.`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((subcommand) =>
            subcommand
                .setName(STRINGS.command.subcommands.start.name)
                .setDescription(STRINGS.command.subcommands.start.description)
                .addChannelOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.start.options.channel.name)
                        .setDescription(STRINGS.command.subcommands.start.options.channel.description)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(STRINGS.command.subcommands.edit.name)
                .setDescription(STRINGS.command.subcommands.edit.description)
                .addStringOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.edit.options.giveaway.name)
                        .setDescription(STRINGS.command.subcommands.edit.options.giveaway.description)
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(STRINGS.command.subcommands.end.name)
                .setDescription(STRINGS.command.subcommands.end.description)
                .addStringOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.end.options.giveaway.name)
                        .setDescription(STRINGS.command.subcommands.end.options.giveaway.description)
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(STRINGS.command.subcommands.reroll.name)
                .setDescription(STRINGS.command.subcommands.reroll.description)
                .addStringOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.reroll.options.giveaway.name)
                        .setDescription(STRINGS.command.subcommands.reroll.options.giveaway.description)
                        .setAutocomplete(true)
                        .setRequired(true)
                )
                .addIntegerOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.reroll.options.winners.name)
                        .setDescription(STRINGS.command.subcommands.reroll.options.winners.description)
                        .setMinValue(1)
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(STRINGS.command.subcommands.cancel.name)
                .setDescription(STRINGS.command.subcommands.cancel.description)
                .addStringOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.cancel.options.giveaway.name)
                        .setDescription(STRINGS.command.subcommands.cancel.options.giveaway.description)
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        ),

    async autocomplete(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();
            const focusedValue = interaction.options.getFocused().toLowerCase();
            const guildId = interaction.guildId;

            let query;
            let params;

            if (subcommand === 'reroll') {
                query = "SELECT id, prize, ends_at FROM utility.giveaways WHERE guild_id = $1 AND status = 'ended' ORDER BY ends_at DESC LIMIT 25";
                params = [guildId];
            } else {
                // start / edit / end / cancel
                query = "SELECT id, prize, ends_at FROM utility.giveaways WHERE guild_id = $1 AND status = 'active' ORDER BY ends_at ASC LIMIT 25";
                params = [guildId];
            }

            const { rows } = await db.query(query, params);

            const filtered = rows.filter((row) =>
                row.prize.toLowerCase().includes(focusedValue) || row.id.includes(focusedValue)
            );

            await interaction.respond(
                filtered.slice(0, 25).map((row) => {
                    const truncatedPrize = row.prize.length > 50 ? row.prize.slice(0, 47) + '...' : row.prize;
                    return {
                        name: `${truncatedPrize} (${row.id})`,
                        value: row.id,
                    };
                })
            );
        } catch (err) {
            console.error('[Giveaway Autocomplete] Error:', err);
            await interaction.respond([]).catch(() => {});
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'start') {
            const targetChannel = interaction.options.getChannel(STRINGS.command.subcommands.start.options.channel.name) || interaction.channel;
            const perms = targetChannel.permissionsFor(interaction.client.user);
            if (!perms || !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                return interaction.reply({
                    content: STRINGS.errors.missingChannelPerms(targetChannel.id),
                    flags: MessageFlags.Ephemeral,
                });
            }

            const modal = createGiveawayModal({ isEdit: false, channelId: targetChannel.id });
            return interaction.showModal(modal);
        }

        if (subcommand === 'edit') {
            const giveawayId = interaction.options.getString(STRINGS.command.subcommands.edit.options.giveaway.name);
            const { rows } = await db.query(
                "SELECT * FROM utility.giveaways WHERE id = $1 AND guild_id = $2 AND status = 'active'",
                [giveawayId, interaction.guildId]
            );

            if (rows.length === 0) {
                return interaction.reply({
                    content: STRINGS.errors.notActive,
                    flags: MessageFlags.Ephemeral,
                });
            }

            const modal = createGiveawayModal({ isEdit: true, giveaway: rows[0] });
            return interaction.showModal(modal);
        }

        if (subcommand === 'end') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const giveawayId = interaction.options.getString(STRINGS.command.subcommands.end.options.giveaway.name);

            const { rows } = await db.query(
                "SELECT * FROM utility.giveaways WHERE id = $1 AND guild_id = $2 AND status = 'active'",
                [giveawayId, interaction.guildId]
            );

            if (rows.length === 0) {
                return interaction.editReply({ content: STRINGS.errors.notActive });
            }

            await endGiveaway(interaction.client, rows[0]);
            return interaction.editReply({ content: STRINGS.messages.endedSuccess(rows[0].prize) });
        }

        if (subcommand === 'reroll') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const giveawayId = interaction.options.getString(STRINGS.command.subcommands.reroll.options.giveaway.name);
            const count = interaction.options.getInteger(STRINGS.command.subcommands.reroll.options.winners.name);

            const { rows } = await db.query(
                "SELECT * FROM utility.giveaways WHERE id = $1 AND guild_id = $2 AND status = 'ended'",
                [giveawayId, interaction.guildId]
            );

            if (rows.length === 0) {
                return interaction.editReply({ content: STRINGS.errors.notFoundOrNotEnded });
            }

            const result = await rerollGiveaway(interaction.client, rows[0], count);
            if (result.error) {
                return interaction.editReply({ content: result.error });
            }

            return interaction.editReply({ content: STRINGS.messages.rerolledSuccess(rows[0].prize) });
        }

        if (subcommand === 'cancel') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const giveawayId = interaction.options.getString(STRINGS.command.subcommands.cancel.options.giveaway.name);

            const { rows } = await db.query(
                "UPDATE utility.giveaways SET status = 'cancelled' WHERE id = $1 AND guild_id = $2 AND status = 'active' RETURNING *",
                [giveawayId, interaction.guildId]
            );

            if (rows.length === 0) {
                return interaction.editReply({ content: STRINGS.errors.notActive });
            }

            const giveaway = rows[0];
            const channel = await interaction.client.channels.fetch(giveaway.channel_id).catch(() => null);
            if (channel) {
                const message = await channel.messages.fetch(giveaway.id).catch(() => null);
                if (message) {
                    const disabledComponents = buildGiveawayComponents(giveaway, true, []);
                    await message.edit({
                        components: disabledComponents,
                        flags: MessageFlags.IsComponentsV2 || 1 << 15,
                        allowedMentions: { parse: [] },
                    }).catch(console.error);
                    await message.reply({
                        content: STRINGS.messages.cancelledAnnouncement(giveaway.prize),
                        allowedMentions: { parse: [] },
                    }).catch(console.error);
                } else {
                    await channel.send({
                        content: STRINGS.messages.cancelledAnnouncement(giveaway.prize),
                        allowedMentions: { parse: [] },
                    }).catch(console.error);
                }
            }

            return interaction.editReply({ content: STRINGS.messages.cancelledSuccess(giveaway.prize) });
        }
    },
};
