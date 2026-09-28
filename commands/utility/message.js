const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    LabelBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    FileUploadBuilder,
    AttachmentBuilder,
    ChannelType,
} = require("discord.js");
const { resolveEmojisInText } = require("../../utils/emojiResolver");
const { parseComponents } = require("../../utils/messageParser");
const {
    createForumDraft,
    handleForumButton,
    handleForumTagSelect,
    handleForumTitleModal,
} = require("../../utils/forumHandler");

const STRINGS = {
    command: {
        name: "message",
        description: "Send a formatted message using components v2",
    },
    modal: {
        title: "Message",
        input_label: "Text",
        input_desc:
            "'c---[#hex] [spoiler]' '/c---' for container; '[2]---[false]' for separator",
        channel_label: "Target Channel",
        channel_desc: "Defaults to current channel",
        mentions_label: "Allowed Mentions",
        mentions_desc: "Defaults to none",
        files_label: "Upload Attachments",
        files_desc:
            "'-media' places gallery (default: bottom); to rearrange items in uploaded order use '-media[1,3,2]'",
    },
    errors: {
        no_content: "No content was provided.",
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description),

    async execute(interaction) {
        const textInput = new TextInputBuilder()
            .setCustomId("message_input")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const textLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.input_label)
            .setDescription(STRINGS.modal.input_desc)
            .setTextInputComponent(textInput);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId("message_channel")
            .setPlaceholder("Select a channel")
            .setRequired(false)
            .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildForum,
                ChannelType.GuildMedia,
                ChannelType.PublicThread,
                ChannelType.PrivateThread,
                ChannelType.AnnouncementThread,
                ChannelType.GuildVoice,
                ChannelType.GuildStageVoice,
            );

        const channelLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.channel_label)
            .setDescription(STRINGS.modal.channel_desc)
            .setChannelSelectMenuComponent(channelSelect);

        const mentionsSelect = new StringSelectMenuBuilder()
            .setCustomId("message_mentions")
            .setPlaceholder("Mention users / roles")
            .setRequired(false)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel("No (Default)")
                    .setValue("false"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("Yes")
                    .setValue("true"),
            );

        const mentionsLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.mentions_label)
            .setDescription(STRINGS.modal.mentions_desc)
            .setStringSelectMenuComponent(mentionsSelect);

        const fileUpload = new FileUploadBuilder()
            .setCustomId("message_files")
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(10);

        const filesLabel = new LabelBuilder()
            .setLabel(STRINGS.modal.files_label)
            .setDescription(STRINGS.modal.files_desc)
            .setFileUploadComponent(fileUpload);

        const modal = new ModalBuilder()
            .setCustomId("message_modal")
            .setTitle(STRINGS.modal.title)
            .addComponents(textLabel, channelLabel, mentionsLabel, filesLabel);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let channelId = interaction.channelId;
        const channelField = interaction.fields?.fields?.get("message_channel");
        if (channelField?.values?.length > 0) {
            channelId = channelField.values[0];
        }

        let mentions = false;
        const mentionsField =
            interaction.fields?.fields?.get("message_mentions");
        if (mentionsField?.values?.length > 0) {
            mentions = mentionsField.values[0] === "true";
        }

        let rawText = "";
        try {
            rawText = interaction.fields.getTextInputValue("message_input");
        } catch {
            const textfield = interaction.fields?.fields?.get("message_input");
            rawText = textfield?.value || "";
        }

        rawText = await resolveEmojisInText(interaction.client, rawText, true);

        // Extract uploaded files
        let attachments = [];
        try {
            const files = interaction.fields.getUploadedFiles("message_files");
            if (files && files.size > 0)
                attachments = Array.from(files.values());
        } catch (_) {}
        if (attachments.length === 0) {
            if (interaction.fields?.attachments?.size > 0) {
                attachments = Array.from(
                    interaction.fields.attachments.values(),
                );
            } else if (interaction.data?.resolved?.attachments) {
                attachments = Object.values(
                    interaction.data.resolved.attachments,
                );
            }
        }

        const filesToSend = [];
        const allMediaItems = [];
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            let filename = att.name || `file_${i + 1}.png`;
            filename = filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
            if (att.url) {
                filesToSend.push(
                    new AttachmentBuilder(att.url, { name: filename }),
                );
                allMediaItems.push({
                    media: { url: `attachment://${filename}` },
                });
            }
        }

        const components = parseComponents(rawText, allMediaItems);

        if (components.length === 0 && filesToSend.length === 0) {
            return interaction.editReply({
                content: STRINGS.errors.no_content,
            });
        }

        try {
            const targetChannel =
                await interaction.client.channels.fetch(channelId);
            if (!targetChannel) {
                throw new Error("Target channel not found.");
            }

            // Check if selected channel is a Forum or Media channel
            if (
                targetChannel.type === ChannelType.GuildForum ||
                targetChannel.type === ChannelType.GuildMedia
            ) {
                const draftId = `${interaction.id}_${Date.now()}`;

                let defaultTitle = "";
                const firstLine = rawText
                    .split("\n")
                    .map((l) => l.trim())
                    .find(
                        (l) =>
                            l.length > 0 &&
                            !l.startsWith("c---") &&
                            !l.startsWith("-media") &&
                            !l.startsWith("---"),
                    );
                if (firstLine) {
                    defaultTitle = firstLine
                        .replace(/^[#\s]+/, "")
                        .substring(0, 80);
                }

                const setupPayload = createForumDraft({
                    id: draftId,
                    userId: interaction.user.id,
                    targetChannel,
                    components,
                    files: filesToSend,
                    allowedMentions: mentions
                        ? { parse: ["users", "roles", "everyone"] }
                        : { parse: [] },
                    defaultTitle,
                });

                return interaction.editReply(setupPayload);
            }

            // Regular channel / thread / voice chat send
            if (!targetChannel.send) {
                throw new Error("Cannot send messages to this channel type.");
            }

            const sendOptions = {
                components: components,
                flags: MessageFlags.IsComponentsV2 || 1 << 15,
                allowedMentions: mentions
                    ? { parse: ["users", "roles", "everyone"] }
                    : { parse: [] },
            };
            if (filesToSend.length > 0) {
                sendOptions.files = filesToSend;
            }

            await targetChannel.send(sendOptions);

            await interaction.editReply({
                content: "Message sent successfully.",
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: `Failed to send message: ${error.message}`,
            });
        }
    },

    handleForumButton,
    handleForumTagSelect,
    handleForumTitleModal,
};
