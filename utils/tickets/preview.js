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
    AttachmentBuilder,
    SectionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    FileUploadBuilder,
} = require("discord.js");
const CONFIG = require("../ticketConfig");
const { findEmojiByNameOrId } = require("../emojiResolver");
const { resolveTagId, formatLogTimestampLine, buildPostUrl, resolveButtonEmoji, formatUserMentionLine } = require("./helpers");
const { logTicketMilestone } = require("./logging");
const { buildTicketCard, buildTicketDetailsContainer } = require("./cards");

// User-facing strings and configuration
const STRINGS = {
    card: {
        subjectTitle: "### Subject",
        bodyTitle: "### Body",
        usersInvolvedTitle: "### Users Involved",
        attachmentsTitle: "### Attachments",
    },
    buttons: {
        edit: {
            label: "Edit",
            emoji: "edit",
        },
        cancel: {
            label: "Cancel",
            emoji: "x_",
        },
        send: {
            label: "Send",
            emoji: "send",
        },
        addAttachments: {
            label: "Add Files",
            emoji: "attach",
        },
    },
    modals: {
        editSubject: {
            id: "ticket_preview_edit_subject_modal",
            title: "Edit Ticket Subject",
            label: "Subject",
            description: "What is this ticket for?",
            placeholder: "E.g., Report issue, Host event / giveaway, Support",
        },
        editBody: {
            id: "ticket_preview_edit_body_modal",
            title: "Edit Ticket Body",
            label: "Body",
            description: "Provide all information the staff will need to assist you",
            placeholder: "Include any relevant information, links, or context",
        },
        editUsers: {
            id: "ticket_preview_edit_users_modal",
            title: "Edit Involved Users",
            label: "Involved Users",
            description: "Select users involved",
            placeholder: "Select users",
        },
        addFiles: {
            id: "ticket_preview_add_files_modal",
            title: "Add Attachments",
            label: "Upload Attachments",
            description: "Upload more screenshots, images or files",
        },
    },
    selectMenus: {
        removeAttachments: {
            id: "ticket_preview_remove_attachment",
            placeholder: "Select attachment(s) to remove",
        },
    },
    errors: {
        forumMisconfigured: "Ticket forum channel is misconfigured. Please notify staff.",
        createFailed: "Failed to create ticket. Please contact a moderator.",
        draftExpired: "Draft expired. Please open a new ticket.",
        maxFilesReached: "Maximum attachment limit reached (10 files).",
    },
    messages: {
        ticketCreated: "Your ticket has been submitted. A staff member will review it shortly.",
        ticketCancelled: "Ticket submission cancelled.",
        reviewTitle: "# Review Your Ticket\nReview and edit your ticket before sending.",
    },
};

// In-memory store for pending ticket creation drafts by user: userId -> { subject, body, involvedUsers, uploadedFiles, expiresAt }
const pendingTicketDrafts = new Map();

/**
 * Builds the preview/review message payload with edit accessories, remove attachments menu, and send/cancel buttons
 */
async function buildTicketPreviewPayload(client, { subject, body, involvedUsers = [], uploadedFiles = [] }) {
    const components = [];

    // Header Container: Title
    const headerContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(STRINGS.messages.reviewTitle),
    );
    components.push(headerContainer);

    // Container 1: Subject with Edit Button Accessory
    const trimmedSubject = (subject || "").trim();
    const editSubjectBtn = new ButtonBuilder()
        .setCustomId("ticket_preview_edit_subject")
        .setLabel(STRINGS.buttons.edit.label)
        .setStyle(ButtonStyle.Secondary);
    const editEmoji = await resolveButtonEmoji(client, STRINGS.buttons.edit.emoji);
    if (editEmoji) editSubjectBtn.setEmoji(editEmoji);

    const subjectSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.subjectTitle),
        )
        .setButtonAccessory(editSubjectBtn);

    const subjectContainer = new ContainerBuilder()
        .addSectionComponents(subjectSection)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(trimmedSubject || "*No subject provided*"),
        );
    components.push(subjectContainer);

    // Container 2: Body with Edit Button Accessory
    const trimmedBody = (body || "").trim();
    const editBodyBtn = new ButtonBuilder()
        .setCustomId("ticket_preview_edit_body")
        .setLabel(STRINGS.buttons.edit.label)
        .setStyle(ButtonStyle.Secondary);
    if (editEmoji) editBodyBtn.setEmoji(editEmoji);

    const bodySection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.bodyTitle),
        )
        .setButtonAccessory(editBodyBtn);

    const bodyContainer = new ContainerBuilder()
        .addSectionComponents(bodySection)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(trimmedBody || "*No body provided*"),
        );
    components.push(bodyContainer);

    // Container 3: Users Involved with Edit Button Accessory
    const editUsersBtn = new ButtonBuilder()
        .setCustomId("ticket_preview_edit_users")
        .setLabel(STRINGS.buttons.edit.label)
        .setStyle(ButtonStyle.Secondary);
    if (editEmoji) editUsersBtn.setEmoji(editEmoji);

    const usersSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.usersInvolvedTitle),
        )
        .setButtonAccessory(editUsersBtn);

    let usersText = "*None*";
    if (involvedUsers.length > 0) {
        usersText = involvedUsers.map((u) => `- ${formatUserMentionLine(u)}`).join("\n");
    }

    const usersContainer = new ContainerBuilder()
        .addSectionComponents(usersSection)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(usersText),
        );
    components.push(usersContainer);

    // Container 4: Attachments (Media Gallery / Files + Remove select menu + Add files accessory)
    const addFilesBtn = new ButtonBuilder()
        .setCustomId("ticket_preview_add_files")
        .setLabel(STRINGS.buttons.addAttachments.label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(uploadedFiles.length >= 10);
    const attachEmoji = await resolveButtonEmoji(client, STRINGS.buttons.addAttachments.emoji);
    if (attachEmoji) addFilesBtn.setEmoji(attachEmoji);

    const attachSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.card.attachmentsTitle),
        )
        .setButtonAccessory(addFilesBtn);

    const attachContainer = new ContainerBuilder().addSectionComponents(attachSection);

    if (uploadedFiles.length > 0) {
        attachContainer.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        );

        const gallery = new MediaGalleryBuilder();
        let galleryCount = 0;

        for (const item of uploadedFiles) {
            const isImage = /\.(png|jpe?g|gif|webp)$/i.test(item.name || item.url);
            if (isImage && galleryCount < 10) {
                gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url));
                galleryCount++;
            } else {
                attachContainer.addFileComponents(new FileBuilder().setURL(item.url));
            }
        }

        if (galleryCount > 0) {
            attachContainer.addMediaGalleryComponents(gallery);
        }

        // Add string select menu to select and remove attachments
        const removeMenu = new StringSelectMenuBuilder()
            .setCustomId(STRINGS.selectMenus.removeAttachments.id)
            .setPlaceholder(STRINGS.selectMenus.removeAttachments.placeholder)
            .setMinValues(1)
            .setMaxValues(uploadedFiles.length);

        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            const label = (file.name || `Attachment ${i + 1}`).substring(0, 100);
            removeMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${i + 1}. ${label}`)
                    .setValue(String(i)),
            );
        }

        attachContainer.addActionRowComponents(
            new ActionRowBuilder().addComponents(removeMenu),
        );
    } else {
        attachContainer.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        );
        attachContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent("*No attachments uploaded*"),
        );
    }
    components.push(attachContainer);

    // Bottom Action Row: Send & Cancel
    const sendBtn = new ButtonBuilder()
        .setCustomId("ticket_preview_send")
        .setLabel(STRINGS.buttons.send.label)
        .setStyle(ButtonStyle.Success);
    const sendEmoji = await resolveButtonEmoji(client, STRINGS.buttons.send.emoji);
    if (sendEmoji) sendBtn.setEmoji(sendEmoji);

    const cancelBtn = new ButtonBuilder()
        .setCustomId("ticket_preview_cancel")
        .setLabel(STRINGS.buttons.cancel.label)
        .setStyle(ButtonStyle.Secondary);
    const cancelEmoji = await resolveButtonEmoji(client, STRINGS.buttons.cancel.emoji);
    if (cancelEmoji) cancelBtn.setEmoji(cancelEmoji);

    const actionRow = new ActionRowBuilder().addComponents(sendBtn, cancelBtn);

    return {
        components: [...components, actionRow],
        flags: MessageFlags.IsComponentsV2,
    };
}

/**
 * Handles ticket modal submission: saves draft and sends preview
 */
async function handleTicketModalSubmit(interaction) {
    const userId = interaction.user.id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Extract inputs
    let subject = "";
    try {
        subject = interaction.fields.getTextInputValue("ticket_subject") || "";
    } catch {
        subject = interaction.fields?.fields?.get("ticket_subject")?.value || "";
    }
    subject = subject.trim();

    let body = "";
    try {
        body = interaction.fields.getTextInputValue("ticket_body");
    } catch {
        body = interaction.fields?.fields?.get("ticket_body")?.value || "";
    }

    // Extract involved users
    let involvedUsers = [];
    const usersField = interaction.fields?.fields?.get("ticket_users");
    if (usersField?.values?.length > 0) {
        for (const id of usersField.values) {
            let member = interaction.guild ? await interaction.guild.members.fetch(id).catch(() => null) : null;
            if (member) {
                const name = member.nickname || member.user.globalName || member.displayName || member.user.username;
                involvedUsers.push({ id, username: member.user.username, displayName: name });
            } else {
                const u = await interaction.client.users.fetch(id).catch(() => null);
                const name = u ? (u.globalName || u.username) : null;
                involvedUsers.push({ id, username: u?.username, displayName: name });
            }
        }
    }

    // Extract uploaded files
    let uploadedFiles = [];
    try {
        const files = interaction.fields.getUploadedFiles("ticket_files");
        if (files && files.size > 0) {
            uploadedFiles = Array.from(files.values());
        }
    } catch (_) {}

    // Store pending draft (15-minute TTL)
    pendingTicketDrafts.set(userId, {
        subject,
        body,
        involvedUsers,
        uploadedFiles,
        expiresAt: Date.now() + 15 * 60 * 1000,
    });

    const payload = await buildTicketPreviewPayload(interaction.client, {
        subject,
        body,
        involvedUsers,
        uploadedFiles,
    });

    return interaction.editReply(payload);
}

/**
 * Handles clicking "Edit Subject" on the preview
 */
async function handleTicketPreviewEditSubject(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(STRINGS.modals.editSubject.id)
        .setTitle(STRINGS.modals.editSubject.title);

    const input = new TextInputBuilder()
        .setCustomId("ticket_subject")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100);
    if (draft.subject) input.setValue(draft.subject);

    const label = new LabelBuilder()
        .setLabel(STRINGS.modals.editSubject.label)
        .setDescription(STRINGS.modals.editSubject.description)
        .setTextInputComponent(input);

    modal.addComponents(label);
    return interaction.showModal(modal);
}

/**
 * Handles submitting the "Edit Subject" modal
 */
async function handleTicketPreviewEditSubjectSubmit(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();

    let newSubject = "";
    try {
        newSubject = interaction.fields.getTextInputValue("ticket_subject") || "";
    } catch {
        newSubject = interaction.fields?.fields?.get("ticket_subject")?.value || "";
    }
    draft.subject = newSubject.trim();

    const payload = await buildTicketPreviewPayload(interaction.client, draft);
    return interaction.editReply(payload);
}

/**
 * Handles clicking "Edit Body" on the preview
 */
async function handleTicketPreviewEditBody(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(STRINGS.modals.editBody.id)
        .setTitle(STRINGS.modals.editBody.title);

    const input = new TextInputBuilder()
        .setCustomId("ticket_body")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(2000);
    if (draft.body) input.setValue(draft.body);

    const label = new LabelBuilder()
        .setLabel(STRINGS.modals.editBody.label)
        .setDescription(STRINGS.modals.editBody.description)
        .setTextInputComponent(input);

    modal.addComponents(label);
    return interaction.showModal(modal);
}

/**
 * Handles submitting the "Edit Body" modal
 */
async function handleTicketPreviewEditBodySubmit(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();

    let newBody = "";
    try {
        newBody = interaction.fields.getTextInputValue("ticket_body") || "";
    } catch {
        newBody = interaction.fields?.fields?.get("ticket_body")?.value || "";
    }
    draft.body = newBody.trim();

    const payload = await buildTicketPreviewPayload(interaction.client, draft);
    return interaction.editReply(payload);
}

/**
 * Handles clicking "Edit Users" on the preview
 */
async function handleTicketPreviewEditUsers(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(STRINGS.modals.editUsers.id)
        .setTitle(STRINGS.modals.editUsers.title);

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId("ticket_users")
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(10);

    const label = new LabelBuilder()
        .setLabel(STRINGS.modals.editUsers.label)
        .setDescription(STRINGS.modals.editUsers.description)
        .setUserSelectMenuComponent(userSelect);

    modal.addComponents(label);
    return interaction.showModal(modal);
}

/**
 * Handles submitting the "Edit Users" modal
 */
async function handleTicketPreviewEditUsersSubmit(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();

    let involvedUsers = [];
    const usersField = interaction.fields?.fields?.get("ticket_users");
    if (usersField?.values?.length > 0) {
        for (const id of usersField.values) {
            let member = interaction.guild ? await interaction.guild.members.fetch(id).catch(() => null) : null;
            if (member) {
                const name = member.nickname || member.user.globalName || member.displayName || member.user.username;
                involvedUsers.push({ id, username: member.user.username, displayName: name });
            } else {
                const u = await interaction.client.users.fetch(id).catch(() => null);
                const name = u ? (u.globalName || u.username) : null;
                involvedUsers.push({ id, username: u?.username, displayName: name });
            }
        }
    }
    draft.involvedUsers = involvedUsers;

    const payload = await buildTicketPreviewPayload(interaction.client, draft);
    return interaction.editReply(payload);
}

/**
 * Handles clicking "Add Files" on the preview
 */
async function handleTicketPreviewAddFiles(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    const currentCount = draft.uploadedFiles ? draft.uploadedFiles.length : 0;
    const remainingLimit = Math.max(0, 10 - currentCount);

    if (remainingLimit <= 0) {
        return interaction.reply({ content: STRINGS.errors.maxFilesReached, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(STRINGS.modals.addFiles.id)
        .setTitle(STRINGS.modals.addFiles.title);

    const fileUpload = new FileUploadBuilder()
        .setCustomId("ticket_files")
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(remainingLimit);

    const label = new LabelBuilder()
        .setLabel(STRINGS.modals.addFiles.label)
        .setDescription(STRINGS.modals.addFiles.description)
        .setFileUploadComponent(fileUpload);

    modal.addComponents(label);
    return interaction.showModal(modal);
}

/**
 * Handles submitting the "Add Files" modal
 */
async function handleTicketPreviewAddFilesSubmit(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();

    let newFiles = [];
    try {
        const files = interaction.fields.getUploadedFiles("ticket_files");
        if (files && files.size > 0) {
            newFiles = Array.from(files.values());
        }
    } catch (_) {}

    if (newFiles.length > 0) {
        draft.uploadedFiles = [...(draft.uploadedFiles || []), ...newFiles];
    }

    const payload = await buildTicketPreviewPayload(interaction.client, draft);
    return interaction.editReply(payload);
}

/**
 * Handles removing selected attachments from preview
 */
async function handleTicketPreviewRemoveAttachment(interaction) {
    const draft = pendingTicketDrafts.get(interaction.user.id);
    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();

    const indicesToRemove = new Set(interaction.values.map((v) => parseInt(v, 10)));
    draft.uploadedFiles = (draft.uploadedFiles || []).filter((_, idx) => !indicesToRemove.has(idx));

    const payload = await buildTicketPreviewPayload(interaction.client, draft);
    return interaction.editReply(payload);
}

/**
 * Handles "Cancel" button on preview
 */
async function handleTicketPreviewCancel(interaction) {
    pendingTicketDrafts.delete(interaction.user.id);
    return interaction.update({
        components: [new TextDisplayBuilder().setContent(STRINGS.messages.ticketCancelled)],
        flags: MessageFlags.IsComponentsV2,
    });
}

/**
 * Handles "Send" button on preview: creates forum post and logs
 */
async function handleTicketPreviewSend(interaction) {
    const userId = interaction.user.id;
    const draft = pendingTicketDrafts.get(userId);

    if (!draft || Date.now() > draft.expiresAt) {
        return interaction.reply({ content: STRINGS.errors.draftExpired, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    pendingTicketDrafts.delete(userId);

    const { subject, body, involvedUsers, uploadedFiles } = draft;

    // Fetch Forum Channel
    const forumChannel = await interaction.client.channels
        .fetch(CONFIG.FORUM_CHANNEL_ID)
        .catch(() => null);

    if (!forumChannel) {
        return interaction.editReply({
            components: [new TextDisplayBuilder().setContent(STRINGS.errors.forumMisconfigured)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    // Tag resolution
    const appliedTags = [];
    if (CONFIG.FORUM_TAGS.TICKET_TAG) {
        const ticketTagId = resolveTagId(forumChannel, CONFIG.FORUM_TAGS.TICKET_TAG);
        if (ticketTagId) appliedTags.push(ticketTagId);
    }
    const unresolvedTagId = resolveTagId(forumChannel, CONFIG.FORUM_TAGS.UNRESOLVED);
    if (unresolvedTagId) {
        appliedTags.push(unresolvedTagId);
    }

    // Prepare attachments to upload
    const filesToSend = [];
    const mediaItems = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const filename = file.name || `file_${i + 1}`;
        filesToSend.push(new AttachmentBuilder(file.url, { name: filename }));
        mediaItems.push({ name: filename, url: `attachment://${filename}` });
    }

    // Build Initial Card
    const nowMs = Date.now();
    const components = buildTicketCard({
        creator: interaction.user,
        subject,
        body,
        involvedUsers,
        mediaItems,
        status: "Unresolved",
        createdTimestampMs: nowMs,
    });

    try {
        // EXACT FORMAT: ticket-{username}-{userid}
        const cleanUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        const threadTitle = `ticket-${cleanUsername}-${userId}`.substring(0, 100);

        const thread = await forumChannel.threads.create({
            name: threadTitle,
            appliedTags: appliedTags,
            message: {
                components: components,
                files: filesToSend,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            },
        });

        const postUrl = buildPostUrl(interaction.guild.id, CONFIG.FORUM_CHANNEL_ID, thread.id);
        const logContent = `### New Ticket Created\n- author: <@${userId}>\n- post: ${postUrl}\n${formatLogTimestampLine(nowMs)}`;
        const logDetailsContainer = buildTicketDetailsContainer({ subject, body, involvedUsers });
        await logTicketMilestone(interaction.guild, logContent, logDetailsContainer ? [logDetailsContainer] : []);

        return interaction.editReply({
            components: [new TextDisplayBuilder().setContent(STRINGS.messages.ticketCreated)],
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (err) {
        console.error("Error creating ticket thread:", err);
        return interaction.editReply({
            components: [new TextDisplayBuilder().setContent(STRINGS.errors.createFailed)],
            flags: MessageFlags.IsComponentsV2,
        });
    }
}

module.exports = {
    STRINGS,
    buildTicketPreviewPayload,
    handleTicketModalSubmit,
    handleTicketPreviewEditSubject,
    handleTicketPreviewEditSubjectSubmit,
    handleTicketPreviewEditBody,
    handleTicketPreviewEditBodySubmit,
    handleTicketPreviewEditUsers,
    handleTicketPreviewEditUsersSubmit,
    handleTicketPreviewAddFiles,
    handleTicketPreviewAddFilesSubmit,
    handleTicketPreviewRemoveAttachment,
    handleTicketPreviewCancel,
    handleTicketPreviewSend,
};
