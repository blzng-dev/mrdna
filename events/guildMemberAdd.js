const {
    Events,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
} = require("discord.js");

const STRINGS = {
    WELCOME_CHANNEL_ID: "1008659239864115220",
    welcomeText: (userId) => `<@${userId}> welcome to Jurassic World`,
};

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const channel =
                member.guild.channels.cache.get(STRINGS.WELCOME_CHANNEL_ID) ||
                (await member.guild.channels
                    .fetch(STRINGS.WELCOME_CHANNEL_ID)
                    .catch(() => null));

            if (!channel) return;

            await channel.send({
                content: STRINGS.welcomeText(member.id),
                allowedMentions: { users: [member.id] },
            });
        } catch (error) {
            console.error("Error sending welcome message:", error);
        }
    },
};
