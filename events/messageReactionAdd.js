const { Events } = require("discord.js");

const CHANNEL = "1553404734906433536";
const GUILD = "841699180271239218";

const HIGHLIGHTS_CONFIGS = [
    { emojis: ["⭐", "🌟", "🔥", "❤️", "😭", "💀"], count: 5 },
    { emojis: ["any"], count: 15 },
];

const ALLOW_SELF_REACTIONS = false;

const IGNORED_CATEGORIES = [
    "842742603857788929", //staff
    "860078313631383552", //ticket
    "845885438489395241", //logs
    "842746471249215508", //admin
    "842746769703829525", //public
    "1199360363762814996", //private
    "1423196305269723176", //roleplay
];

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        if (user.bot) return;

        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error("[Highlights] Failed to fetch reaction:", error);
                return;
            }
        }
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error("[Highlights] Failed to fetch message:", error);
                return;
            }
        }

        const message = reaction.message;

        if (
            !message.guild ||
            (GUILD && message.guildId !== GUILD) ||
            message.channelId === CHANNEL ||
            !CHANNEL
        ) {
            return;
        }

        const categoryId = message.channel.isThread?.()
            ? message.channel.parent?.parentId
            : message.channel.parentId;

        if (categoryId && IGNORED_CATEGORIES.includes(categoryId)) {
            return;
        }

        let config = HIGHLIGHTS_CONFIGS.find((c) =>
            c.emojis.some(
                (e) =>
                    e.toLowerCase() !== "any" &&
                    (e === reaction.emoji.name ||
                        (reaction.emoji.id &&
                            (e === reaction.emoji.id ||
                                e.includes(reaction.emoji.id))) ||
                        e === reaction.emoji.toString()),
            ),
        );

        if (!config) {
            config = HIGHLIGHTS_CONFIGS.find((c) =>
                c.emojis.some((e) => e.toLowerCase() === "any"),
            );
        }

        if (!config || reaction.count < config.count) return;

        if (!ALLOW_SELF_REACTIONS) {
            let effectiveCount = reaction.count;
            const reactedUsers = await reaction.users.fetch().catch(() => null);
            if (reactedUsers?.has(message.author.id)) {
                effectiveCount--;
            }

            if (effectiveCount < config.count) return;
        }

        const highlightsChannel =
            message.guild.channels.cache.get(CHANNEL) ||
            (await message.guild.channels.fetch(CHANNEL).catch(() => null));

        if (!highlightsChannel) {
            console.error(`[Highlights] Target channel ${CHANNEL} not found.`);
            return;
        }

        try {
            const fetchedMessages = await highlightsChannel.messages.fetch({
                limit: 100,
            });
            const alreadyPosted = fetchedMessages.some(
                (m) =>
                    m.reference?.messageId === message.id ||
                    m.embeds[0]?.footer?.text?.endsWith(message.id) ||
                    JSON.stringify(m.components).includes(message.id),
            );

            if (alreadyPosted) return;
        } catch (error) {
            console.error(
                "[Highlights] Error checking recent messages:",
                error,
            );
            return;
        }

        try {
            await message.forward(highlightsChannel);
        } catch (error) {
            console.error("[Highlights] Error forwarding message:", error);
        }
    },
};
