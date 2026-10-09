const { SlashCommandBuilder } = require("discord.js");
const { buildTicketModal } = require("../../utils/ticketModal");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Open a new support ticket"),

    async execute(interaction) {
        const modal = buildTicketModal();
        await interaction.showModal(modal);
    },
};
