const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    MessageFlags,
} = require("discord.js");
const { buildReportModal, handleReportModalSubmit } = require("../../utils/reportHelper");

const STRINGS = {
    command: {
        name: "Report to Staff",
    },
    errors: {
        selfReport: ":hazard: You cannot report your own message.",
    },
};

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName(STRINGS.command.name)
        .setType(ApplicationCommandType.Message),

    async execute(interaction) {
        const targetMessage = interaction.targetMessage;

        if (targetMessage.author.id === interaction.user.id) {
            return interaction.reply({
                content: STRINGS.errors.selfReport,
                flags: MessageFlags.Ephemeral,
            });
        }

        const channelName = interaction.channel?.name || "unknown-channel";
        const modal = buildReportModal(targetMessage, channelName);
        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        return handleReportModalSubmit(interaction);
    },
};
