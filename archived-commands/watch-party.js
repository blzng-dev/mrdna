const {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");

const WATCH_PARTY_ROLE_ID = "1285652226009862204";
const LOG_CHANNEL_ID = "1207983772398526504";
const GLOBAL_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const channelCooldowns = new Map();

const STRINGS = {
    command: {
        name: "watch-party",
        description: "Pings the watch party role",
        optionContentDescription: "What are you watching?",
        optionChannelDescription: "Where are you watching?",
        channelChoices: {
            general: "General",
            music: "Music",
            stream: "Stream",
        },
    },
    errors: {
        noMentions: "Please send the command again without any mentions.",
        generic: "There was an error sending the message.",
    },
    cooldown: {
        active: (timeLeft) => `Command is on cooldown. Available <t:${timeLeft}:R>`,
    },
    messages: {
        announcement: (userId, roleId, contents, channelSuffix) => `<@${userId}> is hosting a <@&${roleId}> for **${contents}**${channelSuffix}\n-# if you don't want to get pinged, go to <id:customize> & remove the role`,
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
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("channel")
                .setDescription(STRINGS.command.optionChannelDescription)
                .addChoices(
                    { name: STRINGS.command.channelChoices.general, value: "843830483141525564" },
                    { name: STRINGS.command.channelChoices.music, value: "843830571158339644" },
                    { name: STRINGS.command.channelChoices.stream, value: "843831162732544030" },
                ),
        ),

    async execute(interaction) {
        try {
            const { guild, channel, member, user } = interaction;
            const contents = interaction.options.getString("content");
            const voiceChannelId = member.voice.channelId;
            const targetChannelId =
                interaction.options.getString("channel") || voiceChannelId;
            const channelSuffix = targetChannelId
                ? ` in <#${targetChannelId}>`
                : "";

            // 1. Mentions Check
            const pingPatterns = [/@everyone/, /@here/, /<@&?\d+>/];
            if (pingPatterns.some((p) => p.test(contents))) {
                return interaction.reply({
                    content: STRINGS.errors.noMentions,
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

            // 4. Send Watch Party Ping
            await interaction.reply({
                content: STRINGS.messages.announcement(user.id, WATCH_PARTY_ROLE_ID, contents, channelSuffix),
                allowedMentions: {
                    roles: [WATCH_PARTY_ROLE_ID],
                    users: [user.id],
                },
            });
        } catch (error) {
            console.error("Error in watch-party command:", error);
            await interaction.reply({
                content: STRINGS.errors.generic,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
