const {
    MessageFlags,
    TextDisplayBuilder,
} = require("discord.js");
const CONFIG = require("../ticketConfig");
const {
    isStaff,
    formatLogTimestampLine,
    getChannelCreatorId,
    getChannelStaffId,
    getChannelAddedMemberIds,
    isChannelClosed,
    isChannelLocked,
} = require("./helpers");
const { logTicketMilestone } = require("./logging");
const {
    buildConfirmationPayload,
    buildChannelControlPanel,
} = require("./cards");

// User-facing strings and configuration
const STRINGS = {
    errors: {
        onlyStaffLock: "Only staff can lock or unlock tickets.",
        onlyStaffClose: "Only staff can close or reopen tickets.",
        onlyStaffAddUsers: "Only staff can add users to this ticket.",
        onlyStaffDelete: "Only staff can delete ticket channels.",
    },
    messages: {
        channelLocked: (modId) => `Ticket channel has been **Locked** by <@${modId}>.`,
        channelUnlocked: (modId) => `Ticket channel has been **Unlocked** by <@${modId}>.`,
        channelClosed: (modId) => `Ticket closed by <@${modId}>.`,
        channelReopened: (modId) => `Ticket channel reopened by <@${modId}>.`,
        usersAdded: (mentions) => `Added users to ticket: ${mentions}`,
        usersRemoved: (mentions) => `Removed users from ticket: ${mentions}`,
        usersToggledSummary: (added, removed) => {
            const parts = [];
            if (added.length > 0) parts.push(`Added: ${added.join(", ")}`);
            if (removed.length > 0) parts.push(`Removed: ${removed.join(", ")}`);
            return parts.join("\n");
        },
        creatorCannotBeRemoved: "The ticket creator cannot be removed from this channel.",
        noChangesToMake: "No changes to make.",
    },
    confirmations: {
        lock: "Are you sure you want to **lock** this ticket channel?",
        unlock: "Are you sure you want to **unlock** this ticket channel?",
        close: "Are you sure you want to **close** this ticket channel?",
        reopen: "Are you sure you want to **reopen** this ticket channel?",
        delete: "Are you sure you want to **delete** this ticket channel permanently?",
    },
};

/**
 * Helper to update the pinned control panel in a ticket channel
 */
async function updatePinnedControlPanel(channel, { isLocked = false, isClosed = false, isResolved = false } = {}) {
    try {
        const creatorId = getChannelCreatorId(channel);
        if (!creatorId) return;

        let messageList = [];
        if (channel.messages.fetchPins) {
            const res = await channel.messages.fetchPins().catch(() => null);
            if (res?.items) {
                messageList = res.items.map((i) => i.message);
            }
        }
        if (messageList.length === 0) {
            const col = await channel.messages.fetchPinned().catch(() => null);
            if (col) {
                messageList = Array.from(col.values());
            }
        }

        if (messageList.length === 0) return;

        // Find the panel message (first bot message among pinned)
        const panelMsg = messageList.find((m) => m && m.author?.id === channel.client.user.id && m.flags?.has(MessageFlags.IsComponentsV2));
        if (panelMsg) {
            let staffId = getChannelStaffId(channel);
            if (!staffId) {
                const firstComp = panelMsg.components?.[0];
                const textComp = firstComp?.components?.find((c) => c.type === 10);
                const match = textComp?.content?.match(/<@(\d+)>/);
                if (match) staffId = match[1];
            }

            const newPanel = buildChannelControlPanel(staffId, { isLocked, isClosed, isResolved });
            await panelMsg.edit({
                ...newPanel,
                allowedMentions: { parse: [] },
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error updating pinned control panel:", err);
    }
}

/**
 * Inside Private Channel: Lock / Unlock Prompt & Execution
 */
async function handleChannelLockToggle(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffLock,
            flags: MessageFlags.Ephemeral,
        });
    }

    const channel = interaction.channel;
    const isLocked = isChannelLocked(channel);
    const promptText = isLocked ? STRINGS.confirmations.unlock : STRINGS.confirmations.lock;
    const payload = buildConfirmationPayload(promptText, "ticket_confirm_lock_toggle");
    return interaction.reply(payload);
}

async function executeChannelLockToggle(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffLock,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferUpdate().catch(() => null);

    const channel = interaction.channel;
    const memberIds = getChannelAddedMemberIds(channel);
    const willLock = !isChannelLocked(channel);

    for (const memberId of memberIds) {
        await channel.permissionOverwrites.edit(
            memberId,
            { SendMessages: willLock ? false : null },
            { type: 1 },
        ).catch(console.error);
    }

    const closed = isChannelClosed(channel);
    await updatePinnedControlPanel(channel, { isLocked: willLock, isClosed: closed });

    const logTitle = willLock ? "### Ticket Channel Locked" : "### Ticket Channel Unlocked";
    const logContent = `${logTitle}\n- channel: <#${channel.id}>\n- staff: <@${interaction.user.id}>\n${formatLogTimestampLine()}`;
    await logTicketMilestone(interaction.guild, logContent);

    await interaction.deleteReply().catch(() => null);

    if (willLock) {
        return channel.send({
            content: STRINGS.messages.channelLocked(interaction.user.id),
            allowedMentions: { parse: [] },
        });
    } else {
        return channel.send({
            content: STRINGS.messages.channelUnlocked(interaction.user.id),
            allowedMentions: { parse: [] },
        });
    }
}

/**
 * Inside Private Channel: Close / Reopen Prompt & Execution
 */
async function handleChannelCloseToggle(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffClose,
            flags: MessageFlags.Ephemeral,
        });
    }

    const channel = interaction.channel;
    const isClosed = isChannelClosed(channel);
    const promptText = isClosed ? STRINGS.confirmations.reopen : STRINGS.confirmations.close;
    const payload = buildConfirmationPayload(promptText, "ticket_confirm_close_toggle");
    return interaction.reply(payload);
}

async function executeChannelCloseToggle(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffClose,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferUpdate().catch(() => null);

    const channel = interaction.channel;
    const memberIds = getChannelAddedMemberIds(channel);
    const willClose = !isChannelClosed(channel);

    for (const memberId of memberIds) {
        await channel.permissionOverwrites.edit(
            memberId,
            { ViewChannel: willClose ? null : true },
            { type: 1 },
        ).catch(console.error);
    }

    const locked = isChannelLocked(channel);
    await updatePinnedControlPanel(channel, { isLocked: locked, isClosed: willClose, isResolved: false });

    const logTitle = willClose ? "### Ticket Channel Closed" : "### Ticket Channel Reopened";
    const logContent = `${logTitle}\n- channel: <#${channel.id}>\n- staff: <@${interaction.user.id}>\n${formatLogTimestampLine()}`;
    await logTicketMilestone(interaction.guild, logContent);

    await interaction.deleteReply().catch(() => null);

    if (willClose) {
        return channel.send({
            content: STRINGS.messages.channelClosed(interaction.user.id),
            allowedMentions: { parse: [] },
        });
    } else {
        return channel.send({
            content: STRINGS.messages.channelReopened(interaction.user.id),
            allowedMentions: { parse: [] },
        });
    }
}

/**
 * Inside Private Channel: Add / Toggle Users Select Menu with Ephemeral Confirmation
 */
async function handleChannelAddUsers(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffAddUsers,
            flags: MessageFlags.Ephemeral,
        });
    }

    const userIds = interaction.values;
    const channel = interaction.channel;

    const nameMatch = channel.name.match(/ticket-.*-(\d+)$/);
    const creatorId = nameMatch ? nameMatch[1] : null;

    const toAdd = [];
    const toRemove = [];
    let creatorBlocked = false;

    for (const id of userIds) {
        if (creatorId && id === creatorId) {
            creatorBlocked = true;
            continue;
        }

        const overwrite = channel.permissionOverwrites.cache.get(id);
        const hasView = overwrite?.allow?.has("ViewChannel");

        if (hasView) {
            toRemove.push(id);
        } else {
            toAdd.push(id);
        }
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
        if (creatorBlocked) {
            return interaction.reply({
                content: STRINGS.messages.creatorCannotBeRemoved,
                flags: MessageFlags.Ephemeral,
            });
        }
        return interaction.reply({
            content: STRINGS.messages.noChangesToMake,
            flags: MessageFlags.Ephemeral,
        });
    }

    const parts = [];
    if (toAdd.length > 0) parts.push(`**Add**: ${toAdd.map((u) => `<@${u}>`).join(", ")}`);
    if (toRemove.length > 0) parts.push(`**Remove**: ${toRemove.map((u) => `<@${u}>`).join(", ")}`);
    if (creatorBlocked) parts.push(`*(Note: <@${creatorId}> was excluded as ticket creator)*`);

    const promptText = `Confirm user changes for this channel:\n${parts.join("\n")}`;
    const token = `${interaction.user.id}_${Date.now()}`;
    pendingUserToggles.set(token, { toAdd, toRemove, expiresAt: Date.now() + 5 * 60 * 1000 });
    const confirmCustomId = `ticket_conf_usr_tok_${token}`;

    const payload = buildConfirmationPayload(promptText, confirmCustomId);
    return interaction.reply(payload);
}

// In-memory store for pending user toggles: token -> { toAdd, toRemove, expiresAt }
const pendingUserToggles = new Map();

async function executeChannelUserToggle(interaction, addStrOrToken, remStr) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffAddUsers,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferUpdate().catch(() => null);

    const channel = interaction.channel;
    let toAdd = [];
    let toRemove = [];

    if (remStr !== undefined) {
        toAdd = addStrOrToken !== "none" ? addStrOrToken.split(",").filter(Boolean) : [];
        toRemove = remStr !== "none" ? remStr.split(",").filter(Boolean) : [];
    } else {
        const draft = pendingUserToggles.get(addStrOrToken);
        if (draft) {
            toAdd = draft.toAdd || [];
            toRemove = draft.toRemove || [];
            pendingUserToggles.delete(addStrOrToken);
        }
    }

    for (const id of toAdd) {
        await channel.permissionOverwrites.create(id, {
            ViewChannel: true,
        }).catch(console.error);
    }

    for (const id of toRemove) {
        await channel.permissionOverwrites.delete(id).catch(console.error);
    }

    if (toAdd.length > 0) {
        const addedMentions = toAdd.map((u) => `<@${u}>`).join(" ");
        await channel.send({
            content: STRINGS.messages.usersAdded(addedMentions),
            allowedMentions: { users: toAdd },
        });
    }

    if (toRemove.length > 0) {
        const removedMentions = toRemove.map((u) => `<@${u}>`).join(", ");
        await channel.send({
            content: STRINGS.messages.usersRemoved(removedMentions),
            allowedMentions: { parse: [] },
        });
    }

    let usersLog = `### Ticket Users Updated\n- channel: <#${channel.id}>\n`;
    if (toAdd.length > 0) usersLog += `- added: ${toAdd.map((u) => `<@${u}>`).join(", ")}\n`;
    if (toRemove.length > 0) usersLog += `- removed: ${toRemove.map((u) => `<@${u}>`).join(", ")}\n`;
    usersLog += `- staff: <@${interaction.user.id}>\n${formatLogTimestampLine()}`;
    await logTicketMilestone(interaction.guild, usersLog);

    const isComponentsV2 = Boolean(interaction.message?.flags?.has(MessageFlags.IsComponentsV2));
    const summary = STRINGS.messages.usersToggledSummary(
        toAdd.map((u) => `<@${u}>`),
        toRemove.map((u) => `<@${u}>`),
    );
    const resultText = `User changes applied successfully.\n${summary}`;

    if (isComponentsV2) {
        return interaction.editReply({
            components: [new TextDisplayBuilder().setContent(resultText)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    return interaction.editReply({
        content: resultText,
        components: [],
    });
}

/**
 * Inside Private Channel: Delete Channel Prompt & Execution
 */
async function handleChannelDelete(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffDelete,
            flags: MessageFlags.Ephemeral,
        });
    }

    const payload = buildConfirmationPayload(
        STRINGS.confirmations.delete,
        "ticket_confirm_channel_delete",
    );
    return interaction.reply(payload);
}

async function executeChannelDelete(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffDelete,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferUpdate().catch(() => null);

    const delLog = `### Ticket Channel Deleted\n- channel: #${interaction.channel.name} (${interaction.channel.id})\n- staff: <@${interaction.user.id}>\n${formatLogTimestampLine()}`;
    await logTicketMilestone(interaction.guild, delLog);

    await interaction.channel.delete("Ticket resolved and deleted").catch(console.error);
}

/**
 * Sweeps private ticket channels and deletes any resolved channels older than 48 hours
 */
async function checkAndSweepResolvedChannels(client) {
    if (!CONFIG.PRIVATE_CHANNEL_CATEGORY_ID) return;
    try {
        const category = await client.channels.fetch(CONFIG.PRIVATE_CHANNEL_CATEGORY_ID).catch(() => null);
        if (!category || !category.children) return;

        const children = category.children.cache || category.children;
        const now = Date.now();

        for (const channel of children.values()) {
            if (!channel.topic || !channel.topic.includes("resolved_at:")) continue;

            const timeMatch = channel.topic.match(/resolved_at:\s*(\d+)/);
            if (!timeMatch) continue;
            const resolvedAt = parseInt(timeMatch[1], 10);
            if (isNaN(resolvedAt)) continue;

            if (now - resolvedAt >= CONFIG.AUTO_DELETE_DELAY_MS) {
                const autoDelLog = `### Ticket Channel Deleted\n- channel: #${channel.name} (${channel.id})\n- staff: Auto (48h timeout)\n${formatLogTimestampLine()}`;
                await logTicketMilestone(channel.guild, autoDelLog);
                await channel.delete("48 hour resolution timeout reached").catch(console.error);
            }
        }
    } catch (err) {
        console.error("Error running resolved channel sweep:", err);
    }
}

/**
 * Starts periodic sweep interval (runs every 30 minutes)
 */
function startTicketSweeper(client) {
    checkAndSweepResolvedChannels(client);
    setInterval(() => {
        checkAndSweepResolvedChannels(client);
    }, 30 * 60 * 1000);
}

module.exports = {
    STRINGS,
    updatePinnedControlPanel,
    handleChannelLockToggle,
    executeChannelLockToggle,
    handleChannelCloseToggle,
    executeChannelCloseToggle,
    handleChannelAddUsers,
    executeChannelUserToggle,
    handleChannelDelete,
    executeChannelDelete,
    checkAndSweepResolvedChannels,
    startTicketSweeper,
};
