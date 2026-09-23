const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    AttachmentBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} = require("discord.js");

const TARGET_ROLE_ID = "868049671694716969";

const EXCEPTION_IDS = ["732177983741362256"];

const STRINGS = {
    command: {
        name: "check-missing-role",
        description: "List members without the role",
    },
    status: {
        allHaveRole: (roleId) => `Everyone (except exceptions) has the <@&${roleId}> role!`,
        header: (count, roleId) => `**Found ${count} members** without <@&${roleId}>:`,
        tooLongNotice: "(List too long, see attached file)",
        operationComplete: (success, failed) => `**Operation Complete**\nGiven role to: ${success}\nFailed: ${failed}`,
    },
    buttons: {
        giveRoleAll: (count) => `Give Role to All (${count})`,
        processing: "Processing...",
    },
    errors: {
        cannotUseButton: "You cannot use this button.",
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        // Force fetch to ensure we see everyone
        await guild.members.fetch();

        // 1. Find missing members (With Exception Filter)
        const missingMembers = guild.members.cache.filter(
            (member) =>
                !member.user.bot &&
                !member.roles.cache.has(TARGET_ROLE_ID) &&
                !EXCEPTION_IDS.includes(member.id)
        );

        if (missingMembers.size === 0) {
            return interaction.editReply(
                STRINGS.status.allHaveRole(TARGET_ROLE_ID)
            );
        }

        // 2. Prepare the List
        const list = missingMembers
            .map((m) => `${m.user.tag} (${m.id})`)
            .join("\n");
        const header = STRINGS.status.header(missingMembers.size, TARGET_ROLE_ID);

        // 3. Create the "Fix It" Button
        const fixButton = new ButtonBuilder()
            .setCustomId("fix_roles")
            .setLabel(STRINGS.buttons.giveRoleAll(missingMembers.size))
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(fixButton);

        // 4. Send the Report
        let response;
        if (list.length + header.length < 1950) {
            response = await interaction.editReply({
                content: `${header}\n\`\`\`text\n${list}\n\`\`\``,
                components: [row],
            });
        } else {
            const buffer = Buffer.from(list, "utf-8");
            const attachment = new AttachmentBuilder(buffer, {
                name: "missing_role.txt",
            });
            response = await interaction.editReply({
                content: `${header}\n${STRINGS.status.tooLongNotice}`,
                files: [attachment],
                components: [row],
            });
        }

        // 5. Button Listener (Collector)
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60_000, // Button works for 60 seconds
        });

        collector.on("collect", async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: STRINGS.errors.cannotUseButton,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Disable button immediately
            fixButton.setDisabled(true).setLabel(STRINGS.buttons.processing);
            await i.update({
                components: [new ActionRowBuilder().addComponents(fixButton)],
            });

            let successCount = 0;
            let failCount = 0;

            // Loop through and add roles
            for (const [id, member] of missingMembers) {
                try {
                    await member.roles.add(TARGET_ROLE_ID);
                    successCount++;
                } catch (err) {
                    console.error(
                        `Failed to add role to ${member.user.tag}:`,
                        err
                    );
                    failCount++;
                }
            }

            await interaction.followUp({
                content: STRINGS.status.operationComplete(successCount, failCount),
                flags: MessageFlags.Ephemeral,
            });
        });

        collector.on("end", () => {
            interaction.editReply({ components: [] }).catch(() => {});
        });
    },
};
