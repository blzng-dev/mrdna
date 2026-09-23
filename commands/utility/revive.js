const {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");

const REVIVE_ROLE_ID = "1539115115280994304";
const LOG_CHANNEL_ID = "1350108952041492561";
const GLOBAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const BYPASS_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const BYPASS_ROLES = ["855954434935619584"];

const channelCooldowns = new Map();

const STRINGS = {
    command: {
        name: "revive",
        description: "Pings the chat role with a topic to discuss",
        topicDescription: "The topic to discuss",
    },
    errors: {
        noMentions: "Please send the command again without any mentions.",
        generic: "There was an error sending the message.",
    },
    cooldown: {
        bypassActive: (timeLeft) => `Command bypass on cooldown. Next revive <t:${timeLeft}:R>`,
        standardActive: (globalTime, bypassStatus) => `Command is on cooldown. Next revive <t:${globalTime}:R>\n-# Server boosters get a shorter cooldown, next revive ${bypassStatus}`,
        availableNow: "**Available Now**",
    },
    buttons: {
        toggleRole: "Toggle Revive Notifications",
    },
    messages: {
        revivePrompt: (roleId, topic) => `<@&${roleId}> discuss: ${topic}\n-# if you don't want to get pinged, click the button below`,
        logLinkDetected: (userId, channelStr, topic) => `**Chat Revive Link Detected**\n**User:** <@${userId}> (${userId})\n**Channel:** ${channelStr}\n**Content:** ${topic}`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addStringOption((option) =>
            option
                .setName("topic")
                .setDescription(STRINGS.command.topicDescription)
                .setMinLength(24)
                .setRequired(true),
        ),

    async execute(interaction) {
        try {
            const { guild, channel, user, member } = interaction;
            const topic = interaction.options.getString("topic");

            const pingPatterns = [/@everyone/, /@here/, /<@&?\d+>/];
            if (pingPatterns.some((p) => p.test(topic))) {
                return interaction.reply({
                    content: STRINGS.errors.noMentions,
                    flags: MessageFlags.Ephemeral,
                });
            }

            const now = Date.now();
            let cooldownData = channelCooldowns.get(channel.id) || {
                globalUnlock: 0,
                bypassUnlock: 0,
            };

            const isBypassUser = BYPASS_ROLES.some((roleId) =>
                member.roles.cache.has(roleId),
            );
            const isGlobalCooldownActive = now < cooldownData.globalUnlock;

            if (isGlobalCooldownActive) {
                if (isBypassUser) {
                    if (now < cooldownData.bypassUnlock) {
                        const timeLeft = Math.floor(
                            cooldownData.bypassUnlock / 1000,
                        );
                        return interaction.reply({
                            content: STRINGS.cooldown.bypassActive(timeLeft),
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                    cooldownData.bypassUnlock = now + BYPASS_COOLDOWN_MS;
                } else {
                    const globalTime = Math.floor(
                        cooldownData.globalUnlock / 1000,
                    );
                    const bypassTime = Math.floor(
                        cooldownData.bypassUnlock / 1000,
                    );
                    const bypassStatus =
                        now < cooldownData.bypassUnlock
                            ? `<t:${bypassTime}:R>`
                            : STRINGS.cooldown.availableNow;

                    return interaction.reply({
                        content: STRINGS.cooldown.standardActive(globalTime, bypassStatus),
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } else {
                cooldownData.globalUnlock = now + GLOBAL_COOLDOWN_MS;
                cooldownData.bypassUnlock = now + BYPASS_COOLDOWN_MS;
            }

            channelCooldowns.set(channel.id, cooldownData);

            const linkRegex = /https?:\/\/\S+/;
            if (linkRegex.test(topic)) {
                const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logMsg = STRINGS.messages.logLinkDetected(user.id, channel.toString(), topic);
                    await logChannel.send({ content: logMsg });
                }
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("toggle_revive_role")
                    .setLabel(STRINGS.buttons.toggleRole)
                    .setStyle(ButtonStyle.Primary),
            );

            await interaction.reply({
                content: STRINGS.messages.revivePrompt(REVIVE_ROLE_ID, topic),
                components: [row],
                allowedMentions: { roles: [REVIVE_ROLE_ID] },
            });
        } catch (error) {
            console.error("Error in revive command:", error);
            await interaction.reply({
                content: STRINGS.errors.generic,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
