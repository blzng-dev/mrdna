const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
} = require("discord.js");
const CONFIG = require("../ticketConfig");

// User-facing strings and configuration
const STRINGS = {
    errors: {
        logChannelNotFound: "Transcript/audit log channel not found.",
    },
};

/**
 * Logs a milestone action to the transcript/log channel inside Components V2 Containers
 */
async function logTicketMilestone(guild, markdownContentOrComponents, extraContainers = []) {
    if (!guild || !CONFIG.TRANSCRIPT_LOG_CHANNEL_ID) return;
    try {
        const logChannel = await guild.channels.fetch(CONFIG.TRANSCRIPT_LOG_CHANNEL_ID).catch(() => null);
        if (!logChannel) {
            console.error(`[Ticket Logging] ${STRINGS.errors.logChannelNotFound}`);
            return;
        }

        let components = [];
        if (Array.isArray(markdownContentOrComponents)) {
            components = markdownContentOrComponents;
        } else {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(markdownContentOrComponents),
                );
            components = [container, ...extraContainers];
        }

        await logChannel.send({
            components,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    } catch (err) {
        console.error("Error logging ticket milestone:", err);
    }
}

module.exports = {
    STRINGS,
    logTicketMilestone,
};
