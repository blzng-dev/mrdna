const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    FileBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SectionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    UserSelectMenuBuilder,
} = require("discord.js");
const { formatDiscordTimestamp, resolveButtonEmoji, formatUserMentionLine } = require("./helpers");

// User-facing strings and configuration
const STRINGS = {
    card: {
        headerTitle: "# New Ticket",
        overviewTitle: "# Ticket Overview",
        fromPrefix: "From",
        submittedOnPrefix: "Submitted on",
        claimedByNotice: (staffId) => `Ticket Claimed by <@${staffId}>`,
        subjectTitle: "### Subject",
        bodyTitle: "### Body",
        usersInvolvedTitle: "### Users Involved",
        attachmentsTitle: "### Attachments",
    },
    buttons: {
        claim: {
            label: "Claim",
            emoji: "friends",
        },
        createChannel: {
            label: "Create Private Channel",
            emoji: "textlocked",
        },
        dmUser: {
            label: "Direct Message User",
            emoji: "directmessage",
        },
        markResolved: {
            label: "Mark as Resolved",
            emoji: "messageaccept",
        },
        deleteChannel: {
            label: "Delete Channel",
            emoji: "delete",
        },
        reopen: {
            label: "Re Open Ticket",
            emoji: "eye",
        },
        lock: {
            label: "Lock Ticket",
            emoji: "locked",
        },
        unlock: {
            label: "Unlock Ticket",
            emoji: "unlock",
        },
        close: {
            label: "Close Ticket",
            emoji: "hidden",
        },
        confirm: {
            label: "Confirm",
            emoji: "checkmark",
        },
        cancel: {
            label: "Cancel",
            emoji: "x_",
        },
    },
    modals: {
        dmUser: {
            id: "ticket_dm_modal",
            title: "Direct Message Ticket Creator",
            inputLabel: "Message",
            inputDescription: "Sent directly to the user's DMs",
            placeholder: "Write your response to the user here...",
        },
    },
    confirmations: {
        btnConfirm: "Confirm",
        btnCancel: "Cancel",
        cancelled: "Action cancelled.",
    },
    panels: {
        userSelectPlaceholder: "Add additional users to this ticket",
        userSelectDisabled: "Channel closed - user select disabled",
    },
};

/**
 * Builds a confirmation prompt payload with Confirm & Cancel buttons
 */
function buildConfirmationPayload(promptText, confirmCustomId, { isComponentsV2 = false } = {}) {
    const confirmBtn = new ButtonBuilder()
        .setCustomId(confirmCustomId)
        .setLabel(STRINGS.confirmations.btnConfirm)
        .setStyle(ButtonStyle.Danger);
    if (STRINGS.buttons.confirm.emoji) confirmBtn.setEmoji(STRINGS.buttons.confirm.emoji);

    const cancelBtn = new ButtonBuilder()
        .setCustomId("ticket_confirm_cancel")
        .setLabel(STRINGS.confirmations.btnCancel)
        .setStyle(ButtonStyle.Secondary);
    if (STRINGS.buttons.cancel.emoji) cancelBtn.setEmoji(STRINGS.buttons.cancel.emoji);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    if (isComponentsV2) {
        const textDisplay = new TextDisplayBuilder().setContent(promptText);
        return {
            components: [textDisplay, row],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    return {
        content: promptText,
        components: [row],
        flags: MessageFlags.Ephemeral,
    };
}

/**
 * Builds Container 2 (Subject, Body, Users Involved)
 */
function buildTicketDetailsContainer({ subject, body, involvedUsers = [] }) {
    const container = new ContainerBuilder();
    const trimmedSubject = (subject || "").trim();
    const trimmedBody = (body || "").trim();

    if (trimmedSubject) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${STRINGS.card.subjectTitle}\n${trimmedSubject}`),
        );
    }

    if (trimmedBody) {
        if (container.components && container.components.length > 0) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
            );
        }
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${STRINGS.card.bodyTitle}\n${trimmedBody}`),
        );
    }

    if (involvedUsers.length > 0) {
        if (container.components && container.components.length > 0) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
            );
        }
        const userLines = involvedUsers.map((u) => `- ${formatUserMentionLine(u)}`).join("\n");

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${STRINGS.card.usersInvolvedTitle}\n${userLines}`),
        );
    }

    return container.components && container.components.length > 0 ? container : null;
}

/**
 * Builds the dynamic Components V2 ticket dashboard card matching the exact UI design
 */
function buildTicketCard({
    creator,
    subject,
    body,
    involvedUsers = [],
    mediaItems = [],
    claimedBy = null,
    status = "Unresolved",
    channelId = null,
    createdTimestampMs = Date.now(),
    isOverview = false,
}) {
    const components = [];

    // Container 1: Header, Submitter info, Submitted on
    const container1 = new ContainerBuilder();

    const displayName = creator.globalName || creator.username;
    let fromLine = `${STRINGS.card.fromPrefix} <@${creator.id}> \`${creator.id}\` (${displayName})\n` +
        `${STRINGS.card.submittedOnPrefix} ${formatDiscordTimestamp(createdTimestampMs)}`;

    if (channelId) {
        fromLine += `\n**Private Channel:** <#${channelId}>`;
    }

    // Header Claim Button Accessory (omitted in overview mode)
    const isClaimed = Boolean(claimedBy);
    const isResolved = status === "Resolved";

    if (isOverview) {
        container1.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.overviewTitle),
        );
    } else {
        const claimBtn = new ButtonBuilder()
            .setCustomId("ticket_claim")
            .setLabel(STRINGS.buttons.claim.label)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isClaimed || isResolved);
        if (STRINGS.buttons.claim.emoji) claimBtn.setEmoji(STRINGS.buttons.claim.emoji);

        const headerSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(STRINGS.card.headerTitle),
            )
            .setButtonAccessory(claimBtn);
        container1.addSectionComponents(headerSection);
    }

    container1.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );

    container1.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(fromLine),
    );

    components.push(container1);

    // Container 2: Subject, Body, Users Involved
    const detailsContainer = buildTicketDetailsContainer({ subject, body, involvedUsers });
    if (detailsContainer) {
        components.push(detailsContainer);
    }

    // Container 3: Attachments (Media Gallery + Files)
    if (mediaItems.length > 0) {
        const container3 = new ContainerBuilder();
        container3.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.attachmentsTitle),
        );

        const gallery = new MediaGalleryBuilder();
        let galleryCount = 0;

        for (const item of mediaItems) {
            const isImage = /\.(png|jpe?g|gif|webp)$/i.test(item.name || item.url);
            if (isImage && galleryCount < 10) {
                gallery.addItems(
                    new MediaGalleryItemBuilder().setURL(item.url),
                );
                galleryCount++;
            } else {
                container3.addFileComponents(
                    new FileBuilder().setURL(item.url),
                );
            }
        }

        if (galleryCount > 0) {
            container3.addMediaGalleryComponents(gallery);
        }
        components.push(container3);
    }

    // Bottom Action Row: omitted in overview mode
    if (!isOverview) {
        const actionRow = new ActionRowBuilder();

        const createChBtn = new ButtonBuilder()
            .setCustomId("ticket_create_channel")
            .setLabel(STRINGS.buttons.createChannel.label)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!isClaimed || isResolved);
        if (STRINGS.buttons.createChannel.emoji) createChBtn.setEmoji(STRINGS.buttons.createChannel.emoji);

        const dmUserBtn = new ButtonBuilder()
            .setCustomId("ticket_dm_user")
            .setLabel(STRINGS.buttons.dmUser.label)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!isClaimed || isResolved);
        if (STRINGS.buttons.dmUser.emoji) dmUserBtn.setEmoji(STRINGS.buttons.dmUser.emoji);

        actionRow.addComponents(createChBtn, dmUserBtn);
        components.push(actionRow);
    }

    return components;
}

/**
 * Builds the sticky control panel inside a Private Channel
 */
function buildChannelControlPanel(staffId, { isLocked = false, isClosed = false, isResolved = false } = {}) {
    const components = [];

    if (staffId) {
        const claimNoticeContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.claimedByNotice(staffId)),
        );
        components.push(claimNoticeContainer);
    }

    // Row 1: User Select menu to add more users (disabled when channel is closed or resolved)
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId("ticket_channel_add_users")
        .setPlaceholder(isClosed || isResolved ? STRINGS.panels.userSelectDisabled : STRINGS.panels.userSelectPlaceholder)
        .setMinValues(1)
        .setMaxValues(10)
        .setDisabled(isClosed || isResolved);

    const userSelectRow = new ActionRowBuilder().addComponents(userSelect);

    // Row 2: Channel Management Buttons
    const lockBtn = new ButtonBuilder()
        .setCustomId("ticket_channel_lock_toggle")
        .setLabel(isLocked ? STRINGS.buttons.unlock.label : STRINGS.buttons.lock.label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isClosed || isResolved);
    const lockEmoji = isLocked ? STRINGS.buttons.unlock.emoji : STRINGS.buttons.lock.emoji;
    if (lockEmoji) lockBtn.setEmoji(lockEmoji);

    const closeBtn = new ButtonBuilder()
        .setCustomId("ticket_channel_close_toggle")
        .setLabel(isClosed ? STRINGS.buttons.reopen.label : STRINGS.buttons.close.label)
        .setStyle(isClosed ? ButtonStyle.Secondary : ButtonStyle.Danger)
        .setDisabled(isResolved);
    const closeEmoji = isClosed ? STRINGS.buttons.reopen.emoji : STRINGS.buttons.close.emoji;
    if (closeEmoji) closeBtn.setEmoji(closeEmoji);

    const buttonRow = new ActionRowBuilder().addComponents(lockBtn, closeBtn);

    components.push(userSelectRow, buttonRow);

    // Stage 4: When Ticket Channel is "Closed" -> Row 3 appears
    if (isClosed || isResolved) {
        const resolveBtn = new ButtonBuilder()
            .setCustomId("ticket_mark_resolved_channel")
            .setLabel(STRINGS.buttons.markResolved.label)
            .setStyle(ButtonStyle.Success)
            .setDisabled(isResolved);
        if (STRINGS.buttons.markResolved.emoji) resolveBtn.setEmoji(STRINGS.buttons.markResolved.emoji);

        const deleteBtn = new ButtonBuilder()
            .setCustomId("ticket_channel_delete")
            .setLabel(STRINGS.buttons.deleteChannel.label)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isResolved);
        if (STRINGS.buttons.deleteChannel.emoji) deleteBtn.setEmoji(STRINGS.buttons.deleteChannel.emoji);

        const row3 = new ActionRowBuilder().addComponents(resolveBtn, deleteBtn);
        components.push(row3);
    }

    return {
        components,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    };
}

/**
 * Builds the DM User modal
 */
function buildDmUserModal(threadId, initialText = "") {
    const modal = new ModalBuilder()
        .setCustomId(`${STRINGS.modals.dmUser.id}_${threadId}`)
        .setTitle(STRINGS.modals.dmUser.title);

    const responseInput = new TextInputBuilder()
        .setCustomId("ticket_dm_text")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(STRINGS.modals.dmUser.placeholder)
        .setRequired(true)
        .setMaxLength(2000);

    if (initialText) responseInput.setValue(initialText);

    const label = new LabelBuilder()
        .setLabel(STRINGS.modals.dmUser.inputLabel)
        .setDescription(STRINGS.modals.dmUser.inputDescription)
        .setTextInputComponent(responseInput);

    modal.addComponents(label);
    return modal;
}

module.exports = {
    STRINGS,
    buildConfirmationPayload,
    buildTicketDetailsContainer,
    buildTicketCard,
    buildChannelControlPanel,
    buildDmUserModal,
};
