const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    FileBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    ChannelType,
} = require("discord.js");
const CONFIG = require("../ticketConfig");
const { generateChannelTranscript } = require("../transcriptHelper");
const {
    resolveTagId,
    isStaff,
    sanitizeChannelName,
    formatLogTimestampLine,
    buildPostUrl,
    getChannelThreadId,
    getChannelCreatorId,
    resolveButtonEmoji,
    formatUserMentionLine,
} = require("./helpers");
const { logTicketMilestone } = require("./logging");
const {
    buildTicketCard,
    buildChannelControlPanel,
    buildDmUserModal,
    buildConfirmationPayload,
} = require("./cards");

// User-facing strings and configuration
const STRINGS = {
    buttons: {
        confirm: {
            label: "Confirm",
            emoji: "checkmark",
        },
        edit: {
            label: "Edit",
            emoji: "edit",
        },
        markResolved: {
            label: "Mark as Resolved",
            emoji: "messageaccept",
        },
    },
    errors: {
        onlyStaffClaim: "Only staff members can claim tickets.",
        onlyStaffCreateChannel: "Only staff members can create ticket channels.",
        onlyStaffDm: "Only staff members can DM ticket creators.",
        onlyStaffResolve: "Only staff members can mark tickets as resolved.",
        starterMessageNotFound: "Unable to locate ticket starter message.",
        creatorNotFound: "Unable to identify ticket creator.",
        threadNotFound: "Ticket thread not found.",
        channelAlreadyExists: (id) => `Private channel already exists: <#${id}>`,
        dmFailed: (id) => `**DM Failed**: <@${id}> has DMs disabled or has blocked the bot.\nPlease use **Create Private Channel** instead.`,
        channelCreateFailed: (err) => `Failed to create channel: ${err}`,
        draftExpired: "Draft expired. Please use **Direct Message User** again.",
    },
    messages: {
        privateChannelCreated: (id) => `Private channel created: <#${id}>`,
        privateChannelGreeting: (id) => `Hello <@${id}>, this is your private ticket channel. Staff will assist you here.`,
        dmSentSuccess: (id) => `DM sent successfully to <@${id}>!`,
        reviewDm: (text) => `**Review Direct Message:**\n> ${text}`,
        resolving: "Resolving ticket...",
        resolvedSuccess: "Ticket marked as resolved and thread archived.",
        forumDmNotice: (content, staffId) => `## DM Sent\n> ${content.replace(/\n/g, "\n> ")}\n-# \\- by <@${staffId}>`,
        forumPrivateChannelNotice: (channelId, staffId) => `## Private Channel Created\n> <#${channelId}>\n-# \\- by <@${staffId}>`,
        dmUserSubject: (subject) => subject ? `Staff has responded to your ticket with subject: ${subject}` : "Staff has responded to your ticket",
        dmDisclaimer: "-# Please do not reply to this message. Staff cannot see replies sent here.",
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
        resolve: "Are you sure you want to mark this ticket as **resolved**? This will archive the forum thread and save transcripts.",
    },
    card: {
        subjectTitle: "### Subject",
        bodyTitle: "### Body",
        usersInvolvedTitle: "### Users Involved",
    },
};

// In-memory store for pending DM message drafts by staff member: staffId -> { threadId, text }
const pendingDmDrafts = new Map();

/**
 * Helper to update forum thread tags safely
 */
async function setForumThreadTag(thread, targetTagName) {
    if (!thread.parent || !thread.parent.availableTags) return;
    const targetTagId = resolveTagId(thread.parent, targetTagName);
    if (!targetTagId) return;

    const statusTagNames = [
        CONFIG.FORUM_TAGS.UNRESOLVED,
        CONFIG.FORUM_TAGS.IN_PROGRESS,
        CONFIG.FORUM_TAGS.RESOLVED,
    ].map((s) => s.toLowerCase());

    const existingTags = (thread.appliedTags || []).filter((tagId) => {
        const t = thread.parent.availableTags.find((at) => at.id === tagId);
        return t && !statusTagNames.includes(t.name.toLowerCase()) && !statusTagNames.includes(t.id.toLowerCase());
    });

    existingTags.push(targetTagId);
    await thread.setAppliedTags(existingTags).catch(console.error);
}

/**
 * Parses existing ticket data from the starter message components
 */
async function parseStarterMessageData(starterMessage, client) {
    let creatorId = null;
    let createdTimestampMs = Date.now();
    let claimedBy = null;
    let channelId = null;
    let subject = "";
    let body = "";
    let involvedUsers = [];
    let mediaItems = [];

    if (!starterMessage || !starterMessage.components) {
        return { creatorId, createdTimestampMs, claimedBy, channelId, subject, body, involvedUsers, mediaItems };
    }

    // Container 1: Metadata
    const comp1 = starterMessage.components[0];
    if (comp1 && comp1.components) {
        for (const c of comp1.components) {
            const content = c.content || "";
            const creatorMatch = content.match(/From\s+<@(\d+)>/i) || content.match(/<@(\d+)>/);
            if (creatorMatch && !creatorId) creatorId = creatorMatch[1];

            const timeMatch = content.match(/<t:(\d+):[fF]>/);
            if (timeMatch) createdTimestampMs = parseInt(timeMatch[1], 10) * 1000;

            const chMatch = content.match(/Private Channel:\*\* <#(\d+)>/i);
            if (chMatch) channelId = chMatch[1];
        }
    }

    // Container 2: Subject, Body, Involved Users
    const comp2 = starterMessage.components[1];
    if (comp2 && comp2.components) {
        const textDisplays = comp2.components.filter((c) => c.type === 10);
        for (const td of textDisplays) {
            const content = td.content || "";
            if (content.startsWith(STRINGS.card.subjectTitle)) {
                subject = content.replace(STRINGS.card.subjectTitle, "").trim();
            } else if (content.startsWith(STRINGS.card.bodyTitle)) {
                body = content.replace(STRINGS.card.bodyTitle, "").trim();
            } else if (content.startsWith(STRINGS.card.usersInvolvedTitle)) {
                const lines = content.replace(STRINGS.card.usersInvolvedTitle, "").trim().split("\n").filter((l) => l.trim().startsWith("-"));
                involvedUsers = lines.map((l) => {
                    const match = l.match(/-\s+<@(\d+)>(?:\s+`@?([^`]+)`)?(?:\s+\(([^)]+)\))?/);
                    if (match) {
                        return { id: match[1], username: match[2] || null, displayName: match[3] || match[2] || null };
                    }
                    const fallback = l.match(/<@(\d+)>/);
                    return fallback ? { id: fallback[1] } : null;
                }).filter(Boolean);
            }
        }
    }

    // Container 3: Media & Files
    const comp3 = starterMessage.components[2];
    if (comp3 && comp3.components) {
        for (const sub of comp3.components) {
            if (sub.type === 12 && sub.items) {
                for (const item of sub.items) {
                    if (item.media?.url) mediaItems.push({ name: "image.png", url: item.media.url });
                }
            } else if (sub.type === 13 && sub.file?.url) {
                mediaItems.push({ name: "file", url: sub.file.url });
            }
        }
    }

    return { creatorId, createdTimestampMs, claimedBy, channelId, subject, body, involvedUsers, mediaItems };
}

/**
 * Handles Claim Button Click
 */
async function handleTicketClaim(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffClaim,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferUpdate();

    const thread = interaction.channel;
    const starterMessage = await thread.fetchStarterMessage().catch(() => null);
    if (!starterMessage) return;

    await setForumThreadTag(thread, CONFIG.FORUM_TAGS.IN_PROGRESS);

    const data = await parseStarterMessageData(starterMessage, interaction.client);
    const creatorUser = await interaction.client.users.fetch(data.creatorId || interaction.user.id).catch(() => interaction.user);

    const updatedComponents = buildTicketCard({
        creator: creatorUser,
        subject: data.subject,
        body: data.body,
        involvedUsers: data.involvedUsers,
        mediaItems: data.mediaItems,
        claimedBy: interaction.user.id,
        status: "In Progress",
        channelId: data.channelId,
        createdTimestampMs: data.createdTimestampMs,
    });

    await starterMessage.edit({
        components: updatedComponents,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });

    const postUrl = buildPostUrl(interaction.guild.id, CONFIG.FORUM_CHANNEL_ID, thread.id);
    const logContent = `### Ticket Claimed\n- staff: <@${interaction.user.id}>\n- post: ${postUrl}\n${formatLogTimestampLine()}`;
    await logTicketMilestone(interaction.guild, logContent);
}

/**
 * Handles Create Private Channel Button Click
 */
async function handleTicketCreatePrivateChannel(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffCreateChannel,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const thread = interaction.channel;
    const starterMessage = await thread.fetchStarterMessage().catch(() => null);
    if (!starterMessage) {
        return interaction.editReply({ content: STRINGS.errors.starterMessageNotFound });
    }

    const data = await parseStarterMessageData(starterMessage, interaction.client);
    const creatorId = getChannelCreatorId(thread) || data.creatorId;
    if (!creatorId) {
        return interaction.editReply({ content: STRINGS.errors.creatorNotFound });
    }

    let existingChannel = null;
    if (data.channelId) {
        existingChannel = await interaction.guild.channels.fetch(data.channelId).catch(() => null);
    }
    if (!existingChannel && CONFIG.PRIVATE_CHANNEL_CATEGORY_ID) {
        const guildChannels = await interaction.guild.channels.fetch().catch(() => null);
        if (guildChannels) {
            existingChannel = guildChannels.find((c) =>
                c && c.parentId === CONFIG.PRIVATE_CHANNEL_CATEGORY_ID && c.topic && c.topic.includes(thread.id)
            );
        }
    }
    if (existingChannel) {
        return interaction.editReply({ content: STRINGS.errors.channelAlreadyExists(existingChannel.id) });
    }

    const creatorUser = await interaction.client.users.fetch(creatorId).catch(() => null);
    const cleanUsername = (creatorUser?.username || "user").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const channelName = sanitizeChannelName(`ticket-${cleanUsername}-${creatorId}`);

    try {
        const category = await interaction.guild.channels.fetch(CONFIG.PRIVATE_CHANNEL_CATEGORY_ID).catch(() => null);
        const categoryOverwrites = category?.permissionOverwrites?.cache?.map((o) => ({
            id: o.id,
            type: o.type,
            allow: o.allow,
            deny: o.deny,
        })) || [];

        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: `thread: ${thread.id}\nauthor: ${data.creatorId}\nstaff: ${interaction.user.id}`,
            parent: CONFIG.PRIVATE_CHANNEL_CATEGORY_ID,
            permissionOverwrites: [
                ...categoryOverwrites,
                {
                    id: data.creatorId,
                    allow: ["ViewChannel"],
                },
            ],
        });

        // 1. Send Message 1: Ticket Overview (omits claim accessory, timeline, and bottom buttons)
        const overviewComponents = buildTicketCard({
            creator: creatorUser || interaction.user,
            subject: data.subject,
            body: data.body,
            involvedUsers: data.involvedUsers,
            mediaItems: data.mediaItems,
            createdTimestampMs: data.createdTimestampMs,
            isOverview: true,
        });

        await channel.send({
            components: overviewComponents,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });

        // 2. Send & Pin Message 2: Sticky Control Panel
        const controlPanel = buildChannelControlPanel(interaction.user.id);
        const pinnedMsg = await channel.send({
            ...controlPanel,
            allowedMentions: { parse: [] },
        });
        await pinnedMsg.pin().catch(() => null);

        // 3. Send Message 3: Ping creator inside channel
        await channel.send({
            content: STRINGS.messages.privateChannelGreeting(data.creatorId),
            allowedMentions: { users: [data.creatorId] },
        });

        // Post non-ephemeral notice in forum thread
        const channelNoticeContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.messages.forumPrivateChannelNotice(channel.id, interaction.user.id)),
        );

        await thread.send({
            components: [channelNoticeContainer],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(console.error);

        const postUrl = buildPostUrl(interaction.guild.id, CONFIG.FORUM_CHANNEL_ID, thread.id);
        const logContent = `### Private Channel Created\n- channel: <#${channel.id}>\n- post: ${postUrl}\n- staff: <@${interaction.user.id}>\n${formatLogTimestampLine()}`;
        await logTicketMilestone(interaction.guild, logContent);

        return interaction.editReply({
            content: STRINGS.messages.privateChannelCreated(channel.id),
        });
    } catch (err) {
        console.error("Error creating private ticket channel:", err);
        return interaction.editReply({
            content: STRINGS.errors.channelCreateFailed(err.message),
        });
    }
}

async function handleTicketDmUser(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffDm,
            flags: MessageFlags.Ephemeral,
        });
    }
    const modal = buildDmUserModal(interaction.channel.id);
    return interaction.showModal(modal);
}

async function handleTicketDmModalSubmit(interaction) {
    const threadId = interaction.customId.replace(`${STRINGS.modals.dmUser.id}_`, "");
    const dmText = interaction.fields.getTextInputValue("ticket_dm_text");

    pendingDmDrafts.set(interaction.user.id, { threadId, text: dmText });

    const confirmBtn = new ButtonBuilder()
        .setCustomId(`ticket_dm_confirm_${threadId}`)
        .setLabel(STRINGS.buttons.confirm.label)
        .setStyle(ButtonStyle.Success);
    const confirmEmoji = await resolveButtonEmoji(interaction.client, STRINGS.buttons.confirm.emoji);
    if (confirmEmoji) confirmBtn.setEmoji(confirmEmoji);

    const editBtn = new ButtonBuilder()
        .setCustomId(`ticket_dm_edit_${threadId}`)
        .setLabel(STRINGS.buttons.edit.label)
        .setStyle(ButtonStyle.Secondary);
    const editEmoji = await resolveButtonEmoji(interaction.client, STRINGS.buttons.edit.emoji);
    if (editEmoji) editBtn.setEmoji(editEmoji);

    const row = new ActionRowBuilder().addComponents(confirmBtn, editBtn);

    return interaction.reply({
        content: STRINGS.messages.reviewDm(dmText),
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleTicketDmEdit(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffDm,
            flags: MessageFlags.Ephemeral,
        });
    }
    const threadId = interaction.customId.replace("ticket_dm_edit_", "");
    const draft = pendingDmDrafts.get(interaction.user.id);
    const initialText = draft?.threadId === threadId ? draft.text : "";
    const modal = buildDmUserModal(threadId, initialText);
    return interaction.showModal(modal);
}

async function handleTicketDmConfirm(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffDm,
            flags: MessageFlags.Ephemeral,
        });
    }
    await interaction.deferUpdate();

    const threadId = interaction.customId.replace("ticket_dm_confirm_", "");
    const draft = pendingDmDrafts.get(interaction.user.id);
    const dmText = draft?.text;
    pendingDmDrafts.delete(interaction.user.id);

    if (!dmText) {
        return interaction.editReply({
            content: STRINGS.errors.draftExpired,
            components: [],
        });
    }

    const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
    if (!thread) {
        return interaction.editReply({ content: STRINGS.errors.threadNotFound, components: [] });
    }

    const starterMessage = await thread.fetchStarterMessage().catch(() => null);
    if (!starterMessage) {
        return interaction.editReply({ content: STRINGS.errors.starterMessageNotFound, components: [] });
    }

    const data = await parseStarterMessageData(starterMessage, interaction.client);
    const creatorId = getChannelCreatorId(thread) || data.creatorId;
    if (!creatorId) {
        return interaction.editReply({ content: STRINGS.errors.creatorNotFound, components: [] });
    }

    const creator = await interaction.client.users.fetch(creatorId).catch(() => null);
    if (!creator) {
        return interaction.editReply({ content: STRINGS.errors.creatorNotFound, components: [] });
    }

    try {
        const headerText = new TextDisplayBuilder().setContent(
            STRINGS.messages.dmUserSubject(data.subject),
        );
        const userDmContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(dmText),
        );
        const disclaimerText = new TextDisplayBuilder().setContent(
            STRINGS.messages.dmDisclaimer,
        );

        await creator.send({
            components: [headerText, userDmContainer, disclaimerText],
            flags: MessageFlags.IsComponentsV2,
        });

        // Post DM Sent notice inside a Container in the forum thread
        const dmContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(STRINGS.messages.forumDmNotice(dmText, interaction.user.id)),
        );
        await thread.send({
            components: [dmContainer],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        }).catch(console.error);

        const postUrl = buildPostUrl(interaction.guild.id, CONFIG.FORUM_CHANNEL_ID, thread.id);
        const logContent = `### Direct Message Sent\n- to: <@${data.creatorId}>\n- staff: <@${interaction.user.id}>\n- message content:\n> ${dmText}\n- post: ${postUrl}\n${formatLogTimestampLine()}`;
        await logTicketMilestone(interaction.guild, logContent);

        const resolveBtn = new ButtonBuilder()
            .setCustomId(`ticket_mark_resolved_${thread.id}`)
            .setLabel(STRINGS.buttons.markResolved.label)
            .setStyle(ButtonStyle.Success);
        const resolveEmoji = await resolveButtonEmoji(interaction.client, STRINGS.buttons.markResolved.emoji);
        if (resolveEmoji) resolveBtn.setEmoji(resolveEmoji);

        const resolveRow = new ActionRowBuilder().addComponents(resolveBtn);

        return interaction.editReply({
            content: STRINGS.messages.dmSentSuccess(data.creatorId),
            components: [resolveRow],
        });
    } catch (dmErr) {
        return interaction.editReply({
            content: STRINGS.errors.dmFailed(data.creatorId),
            components: [],
        });
    }
}

/**
 * Ephemeral prompt for resolving ticket from channel or DM button
 */
async function promptTicketResolve(interaction, customThreadId = null) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffResolve,
            flags: MessageFlags.Ephemeral,
        });
    }

    let targetThreadId = customThreadId && /^\d+$/.test(customThreadId) ? customThreadId : null;
    if (!targetThreadId) {
        targetThreadId = getChannelThreadId(interaction.channel);
    }
    if (!targetThreadId) {
        targetThreadId = interaction.channelId;
    }

    const confirmCustomId = `ticket_confirm_resolve_${targetThreadId}`;
    const payload = buildConfirmationPayload(STRINGS.confirmations.resolve, confirmCustomId);
    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral,
    });
}

/**
 * Resolves a ticket: Transcripts channel (if any), updates forum card & tags, archives thread
 */
async function handleTicketMarkResolved(interaction, customThreadId = null) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: STRINGS.errors.onlyStaffResolve,
            flags: MessageFlags.Ephemeral,
        });
    }

    const isComponentsV2 = Boolean(interaction.message?.flags?.has(MessageFlags.IsComponentsV2));

    if (!interaction.deferred && !interaction.replied) {
        if (interaction.isButton() && interaction.customId.startsWith("ticket_confirm_resolve_")) {
            if (isComponentsV2) {
                await interaction.update({
                    components: [new TextDisplayBuilder().setContent(STRINGS.messages.resolving)],
                    flags: MessageFlags.IsComponentsV2,
                });
            } else {
                await interaction.update({
                    content: STRINGS.messages.resolving,
                    components: [],
                });
            }
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    }

    let targetThreadId = customThreadId && /^\d+$/.test(customThreadId) ? customThreadId : null;
    if (!targetThreadId) {
        targetThreadId = getChannelThreadId(interaction.channel);
    }
    if (!targetThreadId) {
        targetThreadId = interaction.channelId;
    }

    const thread = await interaction.client.channels.fetch(targetThreadId).catch(() => null);
    if (!thread) {
        return interaction.editReply({ content: STRINGS.errors.threadNotFound });
    }

    const starterMessage = await thread.fetchStarterMessage().catch(() => null);
    if (!starterMessage) {
        return interaction.editReply({ content: STRINGS.errors.starterMessageNotFound });
    }

    const data = await parseStarterMessageData(starterMessage, interaction.client);
    // Locate the private channel associated with this ticket
    let privateChannel = null;

    if (interaction.channel && interaction.channel.id !== thread.id && interaction.channel.isTextBased()) {
        if (interaction.channel.parentId === CONFIG.PRIVATE_CHANNEL_CATEGORY_ID || interaction.channel.topic?.includes(thread.id)) {
            privateChannel = interaction.channel;
        }
    }

    if (!privateChannel && data.channelId) {
        privateChannel = await interaction.guild.channels.fetch(data.channelId).catch(() => null);
    }

    if (!privateChannel && CONFIG.PRIVATE_CHANNEL_CATEGORY_ID) {
        const guildChannels = await interaction.guild.channels.fetch().catch(() => null);
        if (guildChannels) {
            privateChannel = guildChannels.find((c) =>
                c && c.parentId === CONFIG.PRIVATE_CHANNEL_CATEGORY_ID && c.topic && c.topic.includes(thread.id)
            );
        }
    }

    if (!privateChannel) {
        const messages = await thread.messages.fetch({ limit: 50 }).catch(() => null);
        if (messages) {
            for (const msg of messages.values()) {
                const match = (msg.content || "").match(/<#(\d+)>/) ||
                    (msg.components ? JSON.stringify(msg.components).match(/<#(\d+)>/) : null);
                if (match) {
                    const candidate = await interaction.guild.channels.fetch(match[1]).catch(() => null);
                    if (candidate && candidate.parentId === CONFIG.PRIVATE_CHANNEL_CATEGORY_ID) {
                        privateChannel = candidate;
                        break;
                    }
                }
            }
        }
    }

    let transcriptBuffer = null;
    let transcriptFilename = null;
    let participants = [];
    let channelName = null;
    let channelId = null;

    if (privateChannel) {
        channelName = privateChannel.name;
        channelId = privateChannel.id;

        const res = await generateChannelTranscript(privateChannel);
        transcriptBuffer = res.buffer;
        transcriptFilename = res.filename;
        participants = res.participants;
        const zipBuffer = res.zipBuffer;
        const zipFilename = res.zipFilename;

        const resolvedTopic = `${privateChannel.topic || ""}\nresolved_at: ${Date.now()}`.trim();
        await privateChannel.setTopic(resolvedTopic).catch(console.error);
        const { updatePinnedControlPanel } = require("./channelActions");
        await updatePinnedControlPanel(privateChannel, { isClosed: true, isResolved: true });

        if (transcriptBuffer && transcriptFilename) {
            const authorId = getChannelCreatorId(thread) || (privateChannel ? getChannelCreatorId(privateChannel) : null) || data.creatorId || interaction.user.id;
            const postUrl = buildPostUrl(interaction.guild.id, CONFIG.FORUM_CHANNEL_ID, thread.id);
            let transcriptLogMd = `### Ticket Transcript\n` +
                `- author: <@${authorId}>\n` +
                `- post: ${postUrl}\n` +
                `- channel: #${channelName} (\`${channelId}\`)\n` +
                `- participants\n`;

            if (participants.length > 0) {
                for (const p of participants) {
                    transcriptLogMd += `  - ${formatUserMentionLine({ id: p.id, username: p.username, displayName: p.displayName || p.name })}\n`;
                }
            } else {
                transcriptLogMd += `  - None\n`;
            }
            transcriptLogMd += formatLogTimestampLine();

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(transcriptLogMd))
                .addFileComponents(new FileBuilder().setURL(`attachment://${transcriptFilename}`));

            if (zipBuffer && zipFilename) {
                container.addFileComponents(new FileBuilder().setURL(`attachment://${zipFilename}`));
            }

            const messageFiles1 = [
                new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename }),
            ];
            if (zipBuffer && zipFilename) {
                messageFiles1.push(new AttachmentBuilder(zipBuffer, { name: zipFilename }));
            }

            // 1. Forum thread: Message 1 (Container with internal file tiles)
            const threadMsg1 = await thread.send({
                components: [container],
                files: messageFiles1,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            }).catch((err) => {
                console.error("[Ticket Resolve] Failed to send transcript container to thread:", err);
                return null;
            });

            // Forum thread: Message 2 (Reply with raw txt file for native unfurl)
            if (threadMsg1) {
                const threadAttachment2 = new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename });
                await threadMsg1.reply({
                    files: [threadAttachment2],
                    allowedMentions: { parse: [] },
                }).catch((err) => console.error("[Ticket Resolve] Failed to reply with transcript to thread:", err));
            }

            // 2. Logs channel: Message 1 (Container with internal file tiles)
            const logChannel = await interaction.guild.channels.fetch(CONFIG.TRANSCRIPT_LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                const logFiles1 = [
                    new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename }),
                ];
                if (zipBuffer && zipFilename) {
                    logFiles1.push(new AttachmentBuilder(zipBuffer, { name: zipFilename }));
                }

                const logMsg1 = await logChannel.send({
                    components: [container],
                    files: logFiles1,
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                }).catch((err) => {
                    console.error("[Ticket Resolve] Failed to send transcript container to log channel:", err);
                    return null;
                });

                // Logs channel: Message 2 (Reply with raw txt file for native unfurl)
                if (logMsg1) {
                    const logAttachment2 = new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename });
                    await logMsg1.reply({
                        files: [logAttachment2],
                        allowedMentions: { parse: [] },
                    }).catch((err) => console.error("[Ticket Resolve] Failed to reply with transcript to log channel:", err));
                }
            }
        }
    }

    await setForumThreadTag(thread, CONFIG.FORUM_TAGS.RESOLVED);
    await thread.setLocked(true).catch(() => null);
    await thread.setArchived(true).catch(() => null);

    const postUrl = buildPostUrl(interaction.guild.id, CONFIG.FORUM_CHANNEL_ID, thread.id);
    const logContent = `### Ticket Resolved\n- post: ${postUrl}\n- staff: <@${interaction.user.id}>\n${formatLogTimestampLine()}`;
    await logTicketMilestone(interaction.guild, logContent);

    if (isComponentsV2) {
        return interaction.editReply({
            components: [new TextDisplayBuilder().setContent(STRINGS.messages.resolvedSuccess)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    return interaction.editReply({
        content: STRINGS.messages.resolvedSuccess,
    });
}

/**
 * Forwards user or staff attachments uploaded in a ticket channel to the corresponding forum thread
 */
async function forwardTicketAttachments(message) {
    if (!CONFIG.PRIVATE_CHANNEL_CATEGORY_ID) return;
    if (message.channel.parentId !== CONFIG.PRIVATE_CHANNEL_CATEGORY_ID) return;
    if (!message.attachments || message.attachments.size === 0) return;

    const threadId = getChannelThreadId(message.channel);
    if (!threadId) return;

    const thread = await message.client.channels.fetch(threadId).catch(() => null);
    if (!thread) return;

    try {
        await message.forward(thread);
    } catch (err) {
        console.error("Error forwarding ticket message to thread:", err);
    }
}

module.exports = {
    STRINGS,
    setForumThreadTag,
    parseStarterMessageData,
    handleTicketClaim,
    handleTicketCreatePrivateChannel,
    handleTicketDmUser,
    handleTicketDmModalSubmit,
    handleTicketDmEdit,
    handleTicketDmConfirm,
    promptTicketResolve,
    handleTicketMarkResolved,
    forwardTicketAttachments,
};
