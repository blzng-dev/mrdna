const {
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require("discord.js");
const { buildReportModal } = require("../../utils/reportHelper");

const STRINGS = {
    command: {
        name: "report",
        description: "Report a recent message in this channel to staff",
    },
    selectMenu: {
        placeholder: "Select a message to report...",
        prompt:
            "Select the message you wish to report from the list below:\n" +
            "-# if you don't see the message you wanted to report, go to the message and right click or hold the message >  click **App** > select **Report to Staff**",
        optionLabel: (displayName, username) => `${displayName} (@${username})`,
    },
    preview: {
        header: (authorId) => `**Selected Message by <@${authorId}>:**`,
        buttonLabel: "Continue to Report",
    },
    snippets: {
        media: "[Media / Attachment]",
        sticker: "[Sticker]",
        empty: "[No text content]",
    },
    errors: {
        fetchFailed: ":x_: Failed to fetch recent messages in this channel.",
        noMessages:
            ":warning: No eligible messages found in the recent chat history to report.\n\n" +
            "-# **Tip:** If the message is older or not listed here, right click or hold the message > click **App** > select **Report to Staff**",
        fetchSingleFailed:
            ":x_: Could not fetch the selected message. It might have been deleted.",
        notFound: ":x_: Could not find the message to report.",
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let fetchedMessages;
        try {
            fetchedMessages = await interaction.channel.messages.fetch({
                limit: 50,
            });
        } catch (err) {
            console.error("[/report fetch error]", err);
            return interaction.editReply({
                content: STRINGS.errors.fetchFailed,
            });
        }

        const validMessages = Array.from(fetchedMessages.values())
            .filter(
                (msg) =>
                    !msg.author.bot && msg.author.id !== interaction.user.id,
            )
            .slice(0, 20);

        if (validMessages.length === 0) {
            return interaction.editReply({
                content: STRINGS.errors.noMessages,
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`report_select_msg_${interaction.channelId}`)
            .setPlaceholder(STRINGS.selectMenu.placeholder);

        for (const msg of validMessages) {
            const username = msg.author.username || "Unknown";
            const memberNickname =
                msg.member?.nickname ||
                interaction.guild?.members?.cache?.get(msg.author.id)?.nickname;
            const displayName =
                memberNickname ||
                msg.author.displayName ||
                msg.author.globalName ||
                username;

            let snippet = msg.content ? msg.content.trim() : "";
            if (!snippet && msg.attachments.size > 0) {
                snippet = STRINGS.snippets.media;
            } else if (!snippet && msg.stickers.size > 0) {
                snippet = STRINGS.snippets.sticker;
            } else if (!snippet) {
                snippet = STRINGS.snippets.empty;
            }

            if (snippet.length > 95) {
                snippet = snippet.substring(0, 92) + "...";
            }

            const label = STRINGS.selectMenu
                .optionLabel(displayName, username)
                .substring(0, 100);

            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(label)
                    .setDescription(snippet)
                    .setValue(msg.id),
            );
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
            content: STRINGS.selectMenu.prompt,
            components: [row],
        });
    },

    async handleSelect(interaction) {
        const selectedMessageId = interaction.values[0];
        const channel = interaction.channel;

        let targetMessage = null;
        try {
            targetMessage = await channel.messages.fetch(selectedMessageId);
        } catch (err) {
            console.error("[/report select error]", err);
        }

        if (!targetMessage) {
            return interaction.reply({
                content: STRINGS.errors.fetchSingleFailed,
                flags: MessageFlags.Ephemeral,
            });
        }

        let previewText = targetMessage.content
            ? targetMessage.content.trim()
            : "";
        if (!previewText && targetMessage.attachments.size > 0) {
            previewText = STRINGS.snippets.media;
        } else if (!previewText) {
            previewText = STRINGS.snippets.empty;
        }
        if (previewText.length > 200) {
            previewText = previewText.substring(0, 197) + "...";
        }

        const launchButton = new ButtonBuilder()
            .setCustomId(
                `report_launch_${targetMessage.id}_${targetMessage.channelId}`,
            )
            .setLabel(STRINGS.preview.buttonLabel)
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(launchButton);

        await interaction.update({
            content: `${STRINGS.preview.header(targetMessage.author.id)}\n> ${previewText.replace(/\n/g, "\n> ")}`,
            components: [actionRow],
            allowedMentions: { parse: [] },
        });
    },

    async handleLaunch(interaction) {
        const parts = interaction.customId
            .replace("report_launch_", "")
            .split("_");
        const messageId = parts[0];
        const channelId = parts[1];

        let targetMessage = null;
        try {
            const ch = await interaction.guild.channels.fetch(channelId);
            if (ch) {
                targetMessage = await ch.messages.fetch(messageId);
            }
        } catch (err) {
            console.error("[/report launch error]", err);
        }

        if (!targetMessage) {
            return interaction.reply({
                content: STRINGS.errors.notFound,
                flags: MessageFlags.Ephemeral,
            });
        }

        const modal = buildReportModal(
            targetMessage,
            interaction.channel?.name || "chat",
        );
        await interaction.showModal(modal);
    },
};
