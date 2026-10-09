const {
    ModalBuilder,
    LabelBuilder,
    CheckboxGroupBuilder,
    CheckboxGroupOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
    TextDisplayBuilder,
    ContainerBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    FileBuilder,
    AttachmentBuilder,
    MessageFlags,
} = require("discord.js");

const STAFF_CHANNEL_ID = "1207983772398526504";

const STRINGS = {
    modal: {
        title: "Report Message to Staff",
        header: (displayName, username, preview) =>
            `You are reporting a message by ${displayName} (@${username})\n${preview}`,
        rulesLabel: "Violated Rule(s)",
        rulesDesc: "Select all rules that apply",
        detailsLabel: "Additional Details",
        detailsDesc: "",
        detailsPlaceholder:
            "Provide any additional context or details for staff",
    },
    reportCard: {
        headerEmoji: "<:report:1459169357702762548>",
        title: "New Report",
        messageContentHeading: "### Message Content",
        rulesHeading: "### Rules Violated",
        detailsHeading: "### Additional Details",
        noTextAttachment: "_[Message has no text, only attachment(s)]_",
        noTextDeleted: "_[No text content or message was deleted]_",
        noRules: "- None specified",
    },
    userReplies: {
        success: ":checkmark: Your report has been submitted.",
        staffChannelNotFound:
            ":hazard: Failed to deliver report: staff report channel not found. Contact Blazing",
    },
    snippets: {
        media: "[Attachment/Media]",
        empty: "[No text content]",
    },
};

const RULE_OPTIONS = [
    {
        label: "Harassment",
        value: "harassment",
        description: "Bullying, Personal attacks, Trolling, etc.",
    },
    {
        label: "Immaturity",
        value: "immaturity",
        description: "Inappropriate Behaviour or Jokes",
    },
    {
        label: "Hate Speech",
        value: "hate_speech",
        description:
            "Hateful conduct like Racism, Homophobia, Transphobia, etc.",
    },
    {
        label: "Spam",
        value: "spam",
        description: "Repetitive texts, images, mentions, etc.",
    },

    {
        label: "Scam",
        value: "scam",
        description: "Malicious behaviour, messages, hacked accounts, etc. ",
    },
    {
        label: "Stolen Artwork",
        value: "art",
        description: "Stealing others artwork and claiming as their own",
    },
    {
        label: "NSFW Content",
        value: "nsfw",
        description: "Explicit sexual, graphic, adult material, etc.",
    },
    {
        label: "Controversial Material",
        value: "controversy",
        description: "Politics, Religion, Drama, etc. ",
    },
    {
        label: "Discord ToS",
        value: "tos",
        description: "Breaks Discord Terms of Service or Community Guidelines",
    },
    {
        label: "Other",
        value: "other",
        description: "Anything else thats not listed above",
    },
];

function buildReportModal(targetMessage, channelName) {
    const modal = new ModalBuilder()
        .setCustomId(
            `report_msg_modal_${targetMessage.id}_${targetMessage.channelId}`,
        )
        .setTitle(STRINGS.modal.title);

    const username = targetMessage.author?.username || "Unknown";
    const memberNickname =
        targetMessage.member?.nickname ||
        targetMessage.guild?.members?.cache?.get(targetMessage.author?.id)
            ?.nickname;
    const displayName =
        memberNickname ||
        targetMessage.author?.displayName ||
        targetMessage.author?.globalName ||
        username;

    let previewSnippet = targetMessage.content
        ? targetMessage.content.trim()
        : "";
    if (!previewSnippet && targetMessage.attachments?.size > 0) {
        previewSnippet = STRINGS.snippets.media;
    } else if (!previewSnippet) {
        previewSnippet = STRINGS.snippets.empty;
    }
    if (previewSnippet.length > 250) {
        previewSnippet = previewSnippet.substring(0, 247) + "...";
    }
    const quotedPreview = `> ${previewSnippet.replace(/\n/g, "\n> ")}`;

    const headerDisplay = new TextDisplayBuilder().setContent(
        STRINGS.modal.header(displayName, username, quotedPreview),
    );

    const checkboxGroup = new CheckboxGroupBuilder()
        .setCustomId("report_rules")
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(3);

    for (const rule of RULE_OPTIONS) {
        checkboxGroup.addOptions(
            new CheckboxGroupOptionBuilder()
                .setLabel(rule.label)
                .setValue(rule.value)
                .setDescription(rule.description),
        );
    }

    const rulesLabel = new LabelBuilder()
        .setLabel(STRINGS.modal.rulesLabel)
        .setDescription(STRINGS.modal.rulesDesc)
        .setCheckboxGroupComponent(checkboxGroup);

    const detailsInput = new TextInputBuilder()
        .setCustomId("report_details")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000)
        .setPlaceholder(STRINGS.modal.detailsPlaceholder);

    const detailsLabel = new LabelBuilder()
        .setLabel(STRINGS.modal.detailsLabel)
        .setTextInputComponent(detailsInput);

    if (STRINGS.modal.detailsDesc && STRINGS.modal.detailsDesc.length > 0) {
        detailsLabel.setDescription(STRINGS.modal.detailsDesc);
    }

    modal.addComponents(headerDisplay, rulesLabel, detailsLabel);
    return modal;
}

async function handleReportModalSubmit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const parts = interaction.customId
        .replace("report_msg_modal_", "")
        .split("_");
    const targetMessageId = parts[0];
    const targetChannelId = parts[1];

    let selectedRules = [];
    try {
        selectedRules =
            interaction.fields.getCheckboxGroup("report_rules") || [];
    } catch {
        const field = interaction.fields?.fields?.get("report_rules");
        selectedRules = field?.values || [];
    }

    let details = "";
    try {
        details = interaction.fields.getTextInputValue("report_details") || "";
    } catch {
        const field = interaction.fields?.fields?.get("report_details");
        details = field?.value || "";
    }

    let originChannel = null;
    let targetMessage = null;
    try {
        originChannel = await interaction.guild.channels.fetch(targetChannelId);
        if (originChannel) {
            targetMessage = await originChannel.messages
                .fetch(targetMessageId)
                .catch(() => null);
        }
    } catch (err) {
        console.error("[Report Message] Failed to fetch target message:", err);
    }

    const staffChannel = await interaction.guild.channels
        .fetch(STAFF_CHANNEL_ID)
        .catch(() => null);
    if (!staffChannel) {
        return interaction.editReply({
            content: STRINGS.userReplies.staffChannelNotFound,
        });
    }

    const now = Math.floor(Date.now() / 1000);
    const reportedAuthor = targetMessage?.author;
    const msgContent = targetMessage?.content
        ? targetMessage.content.trim()
        : "";
    const msgUrl =
        targetMessage?.url ||
        `https://discord.com/channels/${interaction.guildId}/${targetChannelId}/${targetMessageId}`;

    // ==================== CONTAINER 1 ====================
    const container1 = new ContainerBuilder();

    let section1Text =
        `# ${STRINGS.reportCard.headerEmoji} ${STRINGS.reportCard.title}\n` +
        `- Created at <t:${now}:t> <t:${now}:d>\n` +
        `- Created by <@${interaction.user.id}>\n` +
        `- Reporting ${reportedAuthor ? `<@${reportedAuthor.id}>` : "_Unknown_"} ${msgUrl}\n` +
        `${STRINGS.reportCard.messageContentHeading}`;

    if (msgContent) {
        let messageSnippet = msgContent;
        if (messageSnippet.length > 2000) {
            messageSnippet = messageSnippet.substring(0, 1997) + "...";
        }
        const formattedQuote = `> ${messageSnippet.replace(/\n/g, "\n> ")}`;
        section1Text += `\n${formattedQuote}`;
    }

    const section1 = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(section1Text),
    );

    if (reportedAuthor) {
        const avatarUrl = reportedAuthor.displayAvatarURL({
            size: 256,
            extension: "png",
        });
        section1.setThumbnailAccessory(
            new ThumbnailBuilder().setURL(avatarUrl),
        );
    }

    container1.addSectionComponents(section1);

    const filesToSend = [];
    const mediaUrls = [];
    const isNsfwReport = selectedRules.includes("nsfw");

    // 1. Collect direct attachments
    if (targetMessage?.attachments && targetMessage.attachments.size > 0) {
        const otherAttachments = [];

        for (const att of targetMessage.attachments.values()) {
            const isImage =
                att.contentType?.startsWith("image/") ||
                /\.(png|jpe?g|gif|webp)$/i.test(att.name);

            if (isImage) {
                mediaUrls.push({
                    url: att.url,
                    spoiler: att.spoiler || isNsfwReport,
                });
            } else {
                otherAttachments.push(att);
            }
        }

        if (otherAttachments.length > 0) {
            let fileCount = 0;
            for (const att of otherAttachments) {
                if (fileCount >= 5) break;
                const safeName = att.name || `file_${fileCount + 1}`;
                filesToSend.push(
                    new AttachmentBuilder(att.url, { name: safeName }),
                );
                container1.addFileComponents(
                    new FileBuilder().setURL(`attachment://${safeName}`),
                );
                fileCount++;
            }
        }
    }

    // 2. Collect image/gif URLs from message embeds (e.g. Tenor, Giphy, direct media links)
    if (targetMessage?.embeds && targetMessage.embeds.length > 0) {
        for (const embed of targetMessage.embeds) {
            // Pick only the primary media representation for the embed
            const embedMediaUrl =
                embed.image?.url ||
                (embed.video?.url &&
                /\.(gif|png|jpe?g|webp)$/i.test(embed.video.url)
                    ? embed.video.url
                    : embed.thumbnail?.url);

            if (
                embedMediaUrl &&
                !mediaUrls.some((m) => m.url === embedMediaUrl)
            ) {
                mediaUrls.push({ url: embedMediaUrl, spoiler: isNsfwReport });
            }
        }
    } else if (msgContent) {
        // 3. Fallback: Parse raw image/gif links from text ONLY if no embeds exist
        const urlRegex =
            /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?)/gi;
        let match;
        while ((match = urlRegex.exec(msgContent)) !== null) {
            const matchedUrl = match[1];
            if (!mediaUrls.some((m) => m.url === matchedUrl)) {
                mediaUrls.push({ url: matchedUrl, spoiler: isNsfwReport });
            }
        }
    }

    // 4. Build MediaGallery if any media items were collected
    if (mediaUrls.length > 0) {
        const gallery = new MediaGalleryBuilder();
        let count = 0;
        for (const item of mediaUrls) {
            if (count >= 10) break;
            const galleryItem = new MediaGalleryItemBuilder().setURL(item.url);
            if (item.spoiler) {
                galleryItem.setSpoiler(true);
            }
            gallery.addItems(galleryItem);
            count++;
        }
        container1.addMediaGalleryComponents(gallery);
    }

    const componentsToSend = [container1];

    const hasRules = selectedRules.length > 0;
    const hasDetails = details.trim().length > 0;

    if (hasRules || hasDetails) {
        const container2 = new ContainerBuilder();
        const sections = [];

        if (hasRules) {
            const ruleLines = selectedRules
                .map((val) => {
                    const found = RULE_OPTIONS.find((r) => r.value === val);
                    return `- ${found ? found.label : val}`;
                })
                .join("\n");
            sections.push(`${STRINGS.reportCard.rulesHeading}\n${ruleLines}`);
        }

        if (hasDetails) {
            sections.push(
                `${STRINGS.reportCard.detailsHeading}\n${details.trim()}`,
            );
        }

        container2.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(sections.join("\n")),
        );
        componentsToSend.push(container2);
    }

    const sendPayload = {
        components: componentsToSend,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    };

    if (filesToSend.length > 0) {
        sendPayload.files = filesToSend;
    }

    await staffChannel.send(sendPayload);

    await interaction.editReply({
        content: STRINGS.userReplies.success,
    });
}

module.exports = {
    STAFF_CHANNEL_ID,
    RULE_OPTIONS,
    STRINGS,
    buildReportModal,
    handleReportModalSubmit,
};
