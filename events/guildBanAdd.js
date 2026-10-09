const {
    Events,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
} = require("discord.js");

const STRINGS = {
    BAN_CHANNEL_ID: "845885440417857577",
    MOSASAUR_GIF: "https://cdn.discordapp.com/attachments/906201819737358366/915876467634761738/bb2a0b2c70ef390ab4fb867adef8944a1.gif",
    bannedText: (displayName) => `${displayName} just got fed to the Mosasaur`,
};

module.exports = {
    name: Events.GuildBanAdd,
    async execute(ban) {
        try {
            const channel =
                ban.guild.channels.cache.get(STRINGS.BAN_CHANNEL_ID) ||
                (await ban.guild.channels
                    .fetch(STRINGS.BAN_CHANNEL_ID)
                    .catch(() => null));

            if (!channel) return;

            const member = ban.guild.members.cache.get(ban.user.id);
            const displayName =
                member?.nickname ||
                ban.user.displayName ||
                ban.user.globalName ||
                ban.user.username;

            const banContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(STRINGS.bannedText(displayName))
                )
                .addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(STRINGS.MOSASAUR_GIF)
                    )
                );

            await channel.send({
                components: [banContainer],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error("Error sending ban message:", error);
        }
    },
};
