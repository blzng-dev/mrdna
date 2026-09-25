const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const db = require('../../db');
const {
    createGiveawayModal,
} = require('../../utils/giveawayHelper');

const STRINGS = {
    command: {
        name: 'Edit Giveaway',
    },
    errors: {
        notActive: ":warning: This message is not an active giveaway.",
    },
};

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName(STRINGS.command.name)
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const messageId = interaction.targetId;

        const { rows } = await db.query(
            "SELECT * FROM utility.giveaways WHERE id = $1 AND guild_id = $2 AND status = 'active'",
            [messageId, interaction.guildId]
        );

        if (rows.length === 0) {
            return interaction.reply({
                content: STRINGS.errors.notActive,
                flags: MessageFlags.Ephemeral,
            });
        }

        const giveaway = rows[0];
        const modal = createGiveawayModal({ isEdit: true, giveaway });
        return interaction.showModal(modal);
    },
};
