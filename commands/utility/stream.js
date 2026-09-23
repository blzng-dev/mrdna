const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const STREAM_ROLE_ID = "1498877432780820610";
const LOG_CHANNEL_ID = "1207983772398526504";
const GLOBAL_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const channelCooldowns = new Map();

const STRINGS = {
    command: {
        name: "stream",
        description: "Pings the stream role",
        optionContentDescription: "What are you streaming?",
        optionChannelDescription: "Where are you streaming?",
        channelChoices: {
            general: "General",
            music: "Music",
            stream: "Stream",
        },
    },
    errors: {
        noMentions: "Please send the command again without any mentions.",
        noLinks: "Links are not allowed in the stream command.",
        generic: "There was an error sending the message.",
    },
    cooldown: {
        active: (timeLeft) => `Command is on cooldown. Available <t:${timeLeft}:R>`,
    },
    buttons: {
        toggleRole: "Toggle Stream Notifications",
    },
    messages: {
        streamPing: (roleId, userId, contents, channelSuffix) => `<@&${roleId}>, <@${userId}> is streaming **${contents}**${channelSuffix}`,
        logBlockedLink: (userId, channelStr, contents) => `**Stream Blocked (Link)**\n**User:** <@${userId}> (${userId})\n**Channel:** ${channelStr}\n**Content:** ${contents}`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addStringOption((option) =>
            option
                .setName("content")
                .setDescription(STRINGS.command.optionContentDescription)
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("channel")
                .setDescription(STRINGS.command.optionChannelDescription)
                .addChoices(
                    { name: STRINGS.command.channelChoices.general, value: "843830483141525564" },
                    { name: STRINGS.command.channelChoices.music, value: "843830571158339644" },
                    { name: STRINGS.command.channelChoices.stream, value: "843831162732544030" }
                )
        ),

    async execute(interaction) {
        try {
            const { guild, channel, member, user } = interaction;
            const contents = interaction.options.getString("content");
            const voiceChannelId = member.voice.channelId;
            const targetChannelId = interaction.options.getString("channel") || voiceChannelId;
            const channelSuffix = targetChannelId ? ` in <#${targetChannelId}>` : "";

            // 1. Mentions Check
            const pingPatterns = [/@everyone/, /@here/, /<@&?\d+>/];
            if (pingPatterns.some((p) => p.test(contents))) {
                return interaction.reply({
                    content: STRINGS.errors.noMentions,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // 2. Link Blocking
            const linkRegex = /https?:\/\/\S+/;
            if (linkRegex.test(contents)) {
                const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logMsg = STRINGS.messages.logBlockedLink(user.id, channel.toString(), contents);
                    await logChannel.send({ content: logMsg });
                }
                return interaction.reply({
                    content: STRINGS.errors.noLinks,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // 3. Cooldown Check
            const now = Date.now();
            const unlockTime = channelCooldowns.get(channel.id) || 0;
            if (now < unlockTime) {
                const timeLeft = Math.floor(unlockTime / 1000);
                return interaction.reply({
                    content: STRINGS.cooldown.active(timeLeft),
                    flags: MessageFlags.Ephemeral,
                });
            }
            channelCooldowns.set(channel.id, now + GLOBAL_COOLDOWN_MS);

            // 4. Action Row for Role Toggle
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("toggle_stream_role")
                    .setLabel(STRINGS.buttons.toggleRole)
                    .setStyle(ButtonStyle.Primary)
            );

            // 5. Send Stream Ping
            await interaction.reply({
                content: STRINGS.messages.streamPing(STREAM_ROLE_ID, user.id, contents, channelSuffix),
                components: [row],
                allowedMentions: { roles: [STREAM_ROLE_ID], users: [user.id] },
            });
        } catch (error) {
            console.error("Error in stream command:", error);
            await interaction.reply({
                content: STRINGS.errors.generic,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
