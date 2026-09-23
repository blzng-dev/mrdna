const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require("discord.js");
const generateStaffReport = require("../../utils/generateStaffReport");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("activity-report")
        .setDescription("Generate a Staff Activity Report.")
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addBooleanOption((option) =>
            option
                .setName("public")
                .setDescription("Send as a public message? (Default: False)"),
        )
        .addIntegerOption((option) =>
            option
                .setName("days")
                .setDescription("Days to look back (default: 14)")
                .setMinValue(1),
        )
        .addUserOption((option) =>
            option
                .setName("staff")
                .setDescription(
                    "Specific staff member to check activity for (Admin only)",
                ),
        )
        .addBooleanOption((option) =>
            option
                .setName("all")
                .setDescription(
                    "Generate a global report for all staff members (Admin only)",
                ),
        ),

    async execute(interaction) {
        const isPublic = interaction.options.getBoolean("public") || false;

        // Use flags if not public, otherwise default reply
        if (isPublic) {
            await interaction.deferReply();
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        try {
            const days = interaction.options.getInteger("days") || 14;
            const isAdmin = interaction.member.permissions.has(
                PermissionFlagsBits.Administrator,
            );
            const staffMention = interaction.options.getUser("staff");
            const isAll = interaction.options.getBoolean("all") || false;

            let targetUser = interaction.user; // Default to self report

            if (isAdmin) {
                if (isAll) {
                    targetUser = null; // Global report
                } else if (staffMention) {
                    targetUser = staffMention; // Specific staff report
                }
            }

            const { messageContent, attachment, error } =
                await generateStaffReport(
                    interaction.client,
                    interaction.guild.id,
                    days,
                    targetUser,
                );

            if (error) {
                return interaction.editReply(`:x_: ${error}`);
            }

            const payload = { content: messageContent };
            if (!targetUser && attachment) {
                payload.files = [attachment];
            }

            await interaction.editReply(payload);
        } catch (err) {
            console.error(err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content:
                        ":x_: An error occurred while generating the report.",
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.editReply(
                    ":x_: An error occurred while generating the report.",
                );
            }
        }
    },
};
