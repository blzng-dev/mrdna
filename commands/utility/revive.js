const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const REVIVE_ROLE_ID = "858331630997340170";
const LOG_CHANNEL_ID = "1350108952041492561";
const GLOBAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const BYPASS_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const BYPASS_ROLES = ["855954434935619584"];

const channelCooldowns = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName("revive")
        .setDescription("Pings the chat role with a topic to discuss")
        .addStringOption((option) =>
            option
                .setName("topic")
                .setDescription("The topic to discuss")
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
                    content:
                        "Please send the command again without any mentions.",
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
                            content: `Command bypass on cooldown. Next revive <t:${timeLeft}:R>`,
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
                            : "**Available Now**";

                    return interaction.reply({
                        content: `Command is on cooldown. Next revive <t:${globalTime}:R>\n-# Server boosters get a shorter cooldown, next revive ${bypassStatus}`,
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
                    const logMsg = `**Chat Revive Link Detected**\n**User:** <@${user.id}> (${user.id})\n**Channel:** ${channel.toString()}\n**Content:** ${topic}`;
                    await logChannel.send({ content: logMsg });
                }
            }

            // 5. Action Row for Role Toggle
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("toggle_revive_role")
                    .setLabel("Toggle Revive Notifications")
                    .setStyle(ButtonStyle.Primary)
            );

            // 6. Send Revive
            await interaction.reply({
                content: `<@&${REVIVE_ROLE_ID}> Let's discuss: ${topic}\n-# if you don't want to get pinged, go to <id:customize> & remove the role`,
                components: [row],
                allowedMentions: { roles: [REVIVE_ROLE_ID] },
            });
        } catch (error) {
            console.error("Error in revive command:", error);
            await interaction.reply({
                content: "There was an error sending the message.",
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
