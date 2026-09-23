const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const TARGET_CATEGORIES = [
    "1373184128203227136",
    "1260957720731979857",
    "842746033213669388",
    "842746813614129222",
];
const ALERT_CHANNEL_ID = "864756038707314698";

const USER_IDS_TO_DEMOTE = ["1333750043093631109"];

const ROLE_IDS_TO_REMOVE = [
    "867964544717295646",
    "842763148985368617",
    "857990235194261514",
    "",
];

// 🚨 USERS WHO ARE ALLOWED TO RUN THE COMMAND 🚨
const ALLOWED_LOCKDOWN_USERS = [
    "1421251752732135518",
    "1211084462662877257",
    "1411284738383282202",
    "930045738245820426",
];

const LOCKDOWN_FILE = path.join(__dirname, "../../data/lockdown.json");

const STRINGS = {
    command: {
        name: "lockdown",
        description: "Locks down the server.",
        optionLockDescription:
            "True to lock down the server, False to unlock. Defaults to True.",
    },
    errors: {
        noPermission: "You do not have permission to use the lockdown command.",
        alreadyLocked:
            "The server is already locked down. Use the command with lock=False to unlock it.",
        notLocked: "The server is not currently locked down.",
        selfUnlockProhibited:
            "You are the one who locked the server. Only a different moderator can unlock it.",
        notForYou: "This confirmation is not for you.",
        alreadyLockedRace:
            "The server has already been locked by someone else while you were confirming.",
        alreadyUnlockedRace: "The server was already unlocked by someone else.",
        processingError: (msg) =>
            `An error occurred while processing the request: ${msg}`,
    },
    confirm: {
        prompt: (isLock) =>
            `Are you sure you want to ${isLock ? "**LOCK DOWN**" : "**UNLOCK**"} the server?`,
        buttonConfirmLock: "Confirm Lockdown",
        buttonConfirmUnlock: "Confirm Unlock",
        buttonCancel: "Cancel",
        cancelled: "Action cancelled.",
        processing: "Processing...",
        timeout: "Confirmation timed out.",
    },
    alerts: {
        activated: (user) =>
            `🚨 **SERVER LOCKDOWN ACTIVATED** 🚨\nBy: ${user}\n\nThe server is currently under a lockdown state. Operations in critical categories have been paused, and server invites are disabled to prevent raiding.`,
        lifted: (user) =>
            `:checkmark: **SERVER LOCKDOWN LIFTED** :checkmark:\nBy: ${user}\n\nNormal operations have been restored. Invites are unpaused.`,
    },
    status: {
        lockedSuccess: (count) =>
            `Server locked down successfully. Modified ${count} channels, paused invites.`,
        unlockedSuccess: (count) =>
            `Server unlocked successfully. Restored ${count} channels and unpaused invites.`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        // .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addBooleanOption((option) =>
            option
                .setName("lock")
                .setDescription(STRINGS.command.optionLockDescription)
                .setRequired(false),
        ),

    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has(
            PermissionFlagsBits.Administrator,
        );

        if (!isAdmin && !ALLOWED_LOCKDOWN_USERS.includes(interaction.user.id)) {
            return interaction.reply({
                content: STRINGS.errors.noPermission,
                flags: MessageFlags.Ephemeral,
            });
        }

        const lockOption = interaction.options.getBoolean("lock") ?? true;

        // Ensure data directory exists
        const dataDir = path.dirname(LOCKDOWN_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        let state = { isLocked: false, lockedBy: null, channels: [] };
        if (fs.existsSync(LOCKDOWN_FILE)) {
            try {
                state = JSON.parse(fs.readFileSync(LOCKDOWN_FILE, "utf8"));
            } catch (e) {
                console.error("Error parsing lockdown.json", e);
            }
        }

        if (lockOption) {
            if (state.isLocked) {
                return interaction.reply({
                    content: STRINGS.errors.alreadyLocked,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } else {
            if (!state.isLocked) {
                return interaction.reply({
                    content: STRINGS.errors.notLocked,
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (state.lockedBy === interaction.user.id) {
                return interaction.reply({
                    content: STRINGS.errors.selfUnlockProhibited,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("confirm_lockdown")
                .setLabel(
                    lockOption
                        ? STRINGS.confirm.buttonConfirmLock
                        : STRINGS.confirm.buttonConfirmUnlock,
                )
                .setStyle(
                    lockOption ? ButtonStyle.Danger : ButtonStyle.Success,
                ),
            new ButtonBuilder()
                .setCustomId("cancel_lockdown")
                .setLabel(STRINGS.confirm.buttonCancel)
                .setStyle(ButtonStyle.Secondary),
        );

        const message = await interaction.reply({
            content: STRINGS.confirm.prompt(lockOption),
            components: [row],
            withResponse: true,
            flags: MessageFlags.Ephemeral,
        });

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000,
        });

        collector.on("collect", async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: STRINGS.errors.notForYou,
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (i.customId === "cancel_lockdown") {
                collector.stop("cancelled");
                return i.update({
                    content: STRINGS.confirm.cancelled,
                    components: [],
                });
            }

            if (i.customId === "confirm_lockdown") {
                collector.stop("confirmed");
                await i.update({
                    content: STRINGS.confirm.processing,
                    components: [],
                });

                // Re-read state to prevent race conditions during the confirmation wait time
                let currentState = {
                    isLocked: false,
                    lockedBy: null,
                    channels: [],
                    demotedUsers: [],
                };
                if (fs.existsSync(LOCKDOWN_FILE)) {
                    try {
                        currentState = JSON.parse(
                            fs.readFileSync(LOCKDOWN_FILE, "utf8"),
                        );
                    } catch (e) {}
                }

                if (lockOption && currentState.isLocked) {
                    return i.followUp({
                        content: STRINGS.errors.alreadyLockedRace,
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (!lockOption && !currentState.isLocked) {
                    return i.followUp({
                        content: STRINGS.errors.alreadyUnlockedRace,
                        flags: MessageFlags.Ephemeral,
                    });
                }

                const guild = interaction.guild;
                const everyoneRole = guild.roles.everyone;

                try {
                    if (lockOption) {
                        const savedChannels = [];
                        let channelsModified = 0;

                        // Lock down channels in categories
                        for (const [, channel] of guild.channels.cache) {
                            if (
                                channel.parentId &&
                                TARGET_CATEGORIES.includes(channel.parentId) &&
                                channel.isTextBased()
                            ) {
                                const overwrite =
                                    channel.permissionOverwrites.cache.get(
                                        everyoneRole.id,
                                    );
                                let previousSendMessages = null;

                                if (overwrite) {
                                    if (
                                        overwrite.deny.has(
                                            PermissionFlagsBits.SendMessages,
                                        )
                                    )
                                        previousSendMessages = false;
                                    else if (
                                        overwrite.allow.has(
                                            PermissionFlagsBits.SendMessages,
                                        )
                                    )
                                        previousSendMessages = true;
                                }

                                savedChannels.push({
                                    id: channel.id,
                                    prevSendMessages: previousSendMessages,
                                });
                                await channel.permissionOverwrites.edit(
                                    everyoneRole,
                                    { SendMessages: false },
                                );
                                channelsModified++;
                            }
                        }

                        // Pause invites
                        try {
                            if (typeof guild.disableInvites === "function") {
                                await guild.disableInvites(true);
                            } else {
                                // Manual fallback
                                if (
                                    !guild.features.includes("INVITES_DISABLED")
                                ) {
                                    await guild.edit({
                                        features: [
                                            ...guild.features,
                                            "INVITES_DISABLED",
                                        ],
                                    });
                                }
                            }
                        } catch (e) {
                            console.error("Failed to pause invites", e);
                        }

                        // Demote specified users
                        const demotedUsersState = [];
                        let usersDemotedCount = 0;

                        for (const userId of USER_IDS_TO_DEMOTE) {
                            try {
                                const member = await guild.members
                                    .fetch({ user: userId, force: true })
                                    .catch(() => null);
                                if (member) {
                                    const removedRoles = [];
                                    for (const roleId of ROLE_IDS_TO_REMOVE) {
                                        if (member.roles.cache.has(roleId)) {
                                            removedRoles.push(roleId);
                                        }
                                    }

                                    if (removedRoles.length > 0) {
                                        await member.roles.remove(removedRoles);
                                        demotedUsersState.push({
                                            userId,
                                            roles: removedRoles,
                                        });
                                        usersDemotedCount++;
                                    }
                                }
                            } catch (e) {
                                console.error(
                                    `Failed to demote user ${userId}`,
                                    e,
                                );
                            }
                        }

                        // Save state
                        currentState = {
                            isLocked: true,
                            lockedBy: interaction.user.id,
                            channels: savedChannels,
                            demotedUsers: demotedUsersState,
                        };
                        fs.writeFileSync(
                            LOCKDOWN_FILE,
                            JSON.stringify(currentState, null, 2),
                        );

                        // Send alert
                        const alertChannel =
                            guild.channels.cache.get(ALERT_CHANNEL_ID);
                        if (alertChannel && alertChannel.isTextBased()) {
                            await alertChannel.send({
                                content: STRINGS.alerts.activated(
                                    interaction.user,
                                ),
                            });
                        }

                        await i.followUp({
                            content:
                                STRINGS.status.lockedSuccess(channelsModified),
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        let channelsModified = 0;

                        // Unlock and restore channels
                        for (const chData of currentState.channels) {
                            const channel = guild.channels.cache.get(chData.id);
                            if (channel) {
                                const overwriteOpts = {};
                                if (chData.prevSendMessages === null) {
                                    overwriteOpts.SendMessages = null;
                                } else {
                                    overwriteOpts.SendMessages =
                                        chData.prevSendMessages;
                                }
                                await channel.permissionOverwrites.edit(
                                    everyoneRole,
                                    overwriteOpts,
                                );
                                channelsModified++;
                            }
                        }

                        // Unpause invites
                        try {
                            if (typeof guild.disableInvites === "function") {
                                await guild.disableInvites(false);
                            } else {
                                // Manual fallback
                                const newFeatures = guild.features.filter(
                                    (f) => f !== "INVITES_DISABLED",
                                );
                                await guild.edit({ features: newFeatures });
                            }
                        } catch (e) {
                            console.error("Failed to unpause invites", e);
                        }

                        // Reset state
                        currentState = {
                            isLocked: false,
                            lockedBy: null,
                            channels: [],
                            demotedUsers: [],
                        };
                        fs.writeFileSync(
                            LOCKDOWN_FILE,
                            JSON.stringify(currentState, null, 2),
                        );

                        // Send alert
                        const alertChannel =
                            guild.channels.cache.get(ALERT_CHANNEL_ID);
                        if (alertChannel && alertChannel.isTextBased()) {
                            await alertChannel.send({
                                content: STRINGS.alerts.lifted(
                                    interaction.user,
                                ),
                            });
                        }

                        await i.followUp({
                            content:
                                STRINGS.status.unlockedSuccess(
                                    channelsModified,
                                ),
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                } catch (error) {
                    console.error("Lockdown processing error:", error);
                    await i.followUp({
                        content: STRINGS.errors.processingError(error.message),
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }
        });

        collector.on("end", (collected) => {
            if (collected.size === 0) {
                interaction
                    .editReply({
                        content: STRINGS.confirm.timeout,
                        components: [],
                    })
                    .catch(() => {});
            }
        });
    },
};
