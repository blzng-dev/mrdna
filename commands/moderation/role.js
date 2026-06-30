const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} = require("discord.js");

const STAFF_ROLE_ID = "857990235194261514";
const LOG_CHANNEL_ID = "1350108952041492561";

const ASSIGNABLE_ROLES = [
    { name: "Artist", id: "846788337711972402" },
    { name: "Content Creator", id: "844531446269214740" },
];

const ROLE_CATEGORIES = require("../../data/role-categories.js");

// Generate REVOKE_CONFIGS from ROLE_CATEGORIES
const REVOKE_CONFIGS = {};
ROLE_CATEGORIES.forEach(cat => {
    REVOKE_CONFIGS[cat.id] = {
        minRoleId: cat.minId,
        maxRoleId: cat.maxId,
        requiredRoleIds: cat.requiredRoles,
        title: cat.label,
        checkUnused: cat.checkUnused || false,
        unauthorizedReason: "Revoked unauthorized gradient role"
    };
});

async function sendLogMessage(interaction, action, roleName, targetUser) {
    try {
        const logChannel = await interaction.guild.channels.fetch(
            LOG_CHANNEL_ID
        );
        if (!logChannel || !logChannel.isTextBased()) {
            console.error(`Log channel ${LOG_CHANNEL_ID} not found.`);
            return;
        }

        // Format: "staff username assigned/removed roleName to/from @user"
        const preposition = action === "assigned" ? "to" : "from";
        const logContent = `**${interaction.user.username
            }** ${action} **${roleName}** ${preposition} ${targetUser.toString()}`;

        await logChannel.send(logContent);
    } catch (error) {
        console.error("Failed to send log message:", error);
    }
}
async function handleRemove(interaction) {
    if (
        !interaction.member.roles.cache.has(STAFF_ROLE_ID) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
        return interaction.reply({
            content:
                "You do not have the required Staff role to use this command.",
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const targetUser = interaction.options.getUser("user");
        const roleNameValue = interaction.options.getString("role");

        const roleConfig = ASSIGNABLE_ROLES.find(
            (r) => r.name === roleNameValue
        );

        if (!roleConfig) {
            return interaction.editReply({ content: "Invalid role selected." });
        }

        const member = await interaction.guild.members
            .fetch(targetUser.id)
            .catch(() => null);
        if (!member) {
            return interaction.editReply({
                content: "User not found in this server.",
            });
        }

        const role = await interaction.guild.roles.fetch(roleConfig.id);
        if (!role) {
            return interaction.editReply({
                content: `Error: The **${roleConfig.name}** role (ID: ${roleConfig.id}) was not found.`,
            });
        }

        if (!member.roles.cache.has(role.id)) {
            return interaction.editReply({
                content: `${targetUser} does not have the **${role.name}** role.`,
            });
        }

        await member.roles.remove(role);
        await interaction.editReply({
            content: `✅ Successfully removed the **${role.name}** role from ${targetUser}.`,
        });
        await sendLogMessage(interaction, "removed", role.name, targetUser);
    } catch (error) {
        console.error("Error in remove logic:", error);
        await interaction.editReply({
            content: `An error occurred: ${error.message}`,
        });
    }
}
async function handleAssign(interaction) {
    if (
        !interaction.member.roles.cache.has(STAFF_ROLE_ID) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
        return interaction.reply({
            content:
                "You do not have the required Staff role to use this command.",
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const targetUser = interaction.options.getUser("user");
        const roleNameValue = interaction.options.getString("role");

        const roleConfig = ASSIGNABLE_ROLES.find(
            (r) => r.name === roleNameValue
        );

        if (!roleConfig) {
            return interaction.editReply({ content: "Invalid role selected." });
        }

        const member = await interaction.guild.members
            .fetch(targetUser.id)
            .catch(() => null);
        if (!member) {
            return interaction.editReply({
                content: "User not found in this server.",
            });
        }

        const role = await interaction.guild.roles.fetch(roleConfig.id);
        if (!role) {
            return interaction.editReply({
                content: `Error: The **${roleConfig.name}** role (ID: ${roleConfig.id}) was not found.`,
            });
        }

        if (member.roles.cache.has(role.id)) {
            return interaction.editReply({
                content: `${targetUser} already has the **${role.name}** role.`,
            });
        }

        await member.roles.add(role);
        await interaction.editReply({
            content: `✅ Successfully assigned the **${role.name}** role to ${targetUser}.`,
        });
        await sendLogMessage(interaction, "assigned", role.name, targetUser);
    } catch (error) {
        console.error("Error in assign logic:", error);
        await interaction.editReply({
            content: `An error occurred: ${error.message}`,
        });
    }
}
// Groups unauthorized users by role: { role -> [member, ...] }
function groupByRole(usersToProcess) {
    const byRole = new Map();
    usersToProcess.forEach(({ member, roles }) => {
        roles.forEach((role) => {
            if (!byRole.has(role.id)) byRole.set(role.id, { role, members: [] });
            byRole.get(role.id).members.push(member);
        });
    });
    return byRole;
}

function formatListByRole(usersToProcess, unusedRoles, categoryLabel) {
    const totalUsers = usersToProcess.size;
    let text = `Found **${totalUsers}** user(s). Option: \`${categoryLabel}\`\n`;
    const byRole = groupByRole(usersToProcess);
    byRole.forEach(({ role, members }) => {
        text += `- <@&${role.id}>\n`;
        members.forEach((m) => {
            text += `  - <@${m.id}>\n`;
        });
    });
    if (unusedRoles && unusedRoles.size > 0) {
        text += `\n**Unused Roles** (no members assigned)\n`;
        unusedRoles.forEach((role) => {
            text += `- <@&${role.id}>\n`;
        });
    }
    return text;
}

// NOTE: Assumes guild.roles.fetch() has already been called before invoking this.
function scanCategory(guild, config) {
    const minRole = guild.roles.cache.get(config.minRoleId);
    const maxRole = guild.roles.cache.get(config.maxRoleId);

    if (!minRole || !maxRole) return null;

    const lowerBound = Math.min(minRole.position, maxRole.position);
    const upperBound = Math.max(minRole.position, maxRole.position);

    const targetRoles = guild.roles.cache.filter(
        (role) => role.position > lowerBound && role.position < upperBound
    );

    if (targetRoles.size === 0) return null;

    // Track which roles have at least one non-bot member
    const rolesWithMembers = new Set();
    const usersToProcess = new Map();

    guild.members.cache.forEach((member) => {
        if (member.user.bot) return; // skip bots

        const isAuthorized = config.requiredRoleIds.some((roleId) =>
            member.roles.cache.has(roleId)
        );

        member.roles.cache.forEach((role) => {
            if (targetRoles.has(role.id)) rolesWithMembers.add(role.id);
        });

        if (!isAuthorized) {
            const rolesToRemove = member.roles.cache.filter((role) =>
                targetRoles.has(role.id)
            );
            if (rolesToRemove.size > 0) {
                usersToProcess.set(member.id, {
                    member,
                    roles: Array.from(rolesToRemove.values()),
                });
            }
        }
    });

    // Only track unused roles for categories that opt in
    const unusedRoles = config.checkUnused
        ? targetRoles.filter((role) => !rolesWithMembers.has(role.id))
        : targetRoles.filter(() => false); // empty

    return { usersToProcess, unusedRoles };
}

async function handleRevoke(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({
            content:
                'You need the "Manage Roles" permission to use this command.',
            flags: MessageFlags.Ephemeral,
        });
    }

    try {
        const categoryKey = interaction.options.getString("category");
        const action = interaction.options.getString("action") || "list";
        const isVisible = interaction.options.getBoolean("visible") ?? false;
        const shouldExecute = action === "execute";

        await interaction.deferReply(isVisible ? {} : { flags: MessageFlags.Ephemeral });

        // Fetch roles + members in parallel; give members up to 60s
        await Promise.all([
            interaction.guild.roles.fetch(),
            interaction.guild.members.fetch({ time: 60_000 }),
        ]);

        // --- ALL CATEGORIES ---
        if (categoryKey === "all") {
            if (!shouldExecute) {
                // LIST mode
                let response = "";
                let anyFound = false;
                const foundCategoryIds = [];

                for (const cat of ROLE_CATEGORIES) {
                    const config = REVOKE_CONFIGS[cat.id];
                    if (!config) continue;

                    const result = scanCategory(interaction.guild, config);

                    if (!result) {
                        response += `## ${config.title}\n✅ No roles found in boundaries.\n`;
                        continue;
                    }

                    const { usersToProcess, unusedRoles } = result;
                    const hasViolations = usersToProcess.size > 0;
                    const hasUnused = unusedRoles.size > 0;

                    if (!hasViolations && !hasUnused) {
                        response += `## ${config.title}\n✅ No unauthorized users or unused roles.\n`;
                        continue;
                    }

                    if (hasViolations) {
                        anyFound = true;
                        foundCategoryIds.push(cat.id);
                    }

                    response += `## ${config.title}\n`;
                    response += formatListByRole(usersToProcess, unusedRoles, config.title);
                }

                const replyPayload = {
                    content: response.length > 2000 ? response.substring(0, 1997) + "..." : response,
                    components: [],
                };

                if (anyFound) {
                    // Multi-select menu: one option per category that has violations
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId("revoke_select_categories")
                        .setPlaceholder("Select categories to revoke...")
                        .setMinValues(1)
                        .setMaxValues(foundCategoryIds.length)
                        .addOptions(
                            foundCategoryIds.map(id => ({
                                label: REVOKE_CONFIGS[id].title,
                                value: id,
                            }))
                        );

                    replyPayload.components = [
                        new ActionRowBuilder().addComponents(selectMenu),
                    ];
                }

                return await interaction.editReply(replyPayload);
            }

            // EXECUTE mode
            let response = "";
            let totalUsers = 0;
            let totalRemoved = 0;
            let totalFailed = 0;

            for (const cat of ROLE_CATEGORIES) {
                const config = REVOKE_CONFIGS[cat.id];
                if (!config) continue;

                const result = scanCategory(interaction.guild, config);

                if (!result) {
                    response += `## ${config.title}\n✅ No roles found in boundaries.\n`;
                    continue;
                }

                const { usersToProcess } = result;

                if (usersToProcess.size === 0) {
                    response += `## ${config.title}\n✅ No unauthorized users.\n`;
                    continue;
                }

                response += `## ${config.title}\n`;
                totalUsers += usersToProcess.size;

                for (const [userId, { member, roles }] of usersToProcess.entries()) {
                    response += `<@${userId}>:\n`;
                    for (const role of roles) {
                        try {
                            await member.roles.remove(role, config.unauthorizedReason);
                            response += `- ✅ Removed <@&${role.id}>\n`;
                            totalRemoved++;
                            await sendLogMessage(interaction, "revoked", role.name, member.user);
                        } catch (error) {
                            console.error(`Failed to remove role ${role.name} from ${member.user.tag}:`, error);
                            response += `- ⚠️ Failed <@&${role.id}>: ${error.message}\n`;
                            totalFailed++;
                        }
                    }
                }
            }

            response += `\n**Summary** — Users: ${totalUsers} | Removed: ${totalRemoved} | Failed: ${totalFailed}`;

            return await interaction.editReply({
                content: response.length > 2000 ? response.substring(0, 1997) + "..." : response,
                components: [],
            });
        }

        // --- SINGLE CATEGORY ---
        const config = REVOKE_CONFIGS[categoryKey];
        if (!config) {
            return interaction.editReply({ content: "Invalid category configuration." });
        }

        const result = scanCategory(interaction.guild, config);

        if (!result) {
            return interaction.editReply({
                content: "One of the boundary roles could not be found, or no roles exist between the boundaries.",
            });
        }

        const { usersToProcess, unusedRoles } = result;
        let response = "";

        if (!shouldExecute) {
            // LIST mode
            if (usersToProcess.size === 0 && unusedRoles.size === 0) {
                return await interaction.editReply({
                    content: `✅ No unauthorized users or unused roles found in **${config.title}**.`,
                    components: [],
                });
            }

            const listText = formatListByRole(usersToProcess, unusedRoles, config.title);
            const showButton = usersToProcess.size > 0;

            return await interaction.editReply({
                content: listText.length > 2000 ? listText.substring(0, 1997) + "..." : listText,
                components: showButton ? [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`revoke_execute_${categoryKey}`)
                            .setLabel("Revoke Roles")
                            .setStyle(ButtonStyle.Danger)
                    ),
                ] : [],
            });
        }

        // EXECUTE mode
        if (usersToProcess.size === 0) {
            return await interaction.editReply({
                content: `✅ No unauthorized users found in **${config.title}**.`,
                components: [],
            });
        }

        let rolesRemovedCount = 0;
        let failedRemovalsCount = 0;

        for (const [userId, { member, roles }] of usersToProcess.entries()) {
            response += `### <@${userId}>\n`;
            for (const role of roles) {
                try {
                    await member.roles.remove(role, config.unauthorizedReason);
                    response += `- ✅ Removed <@&${role.id}>\n`;
                    rolesRemovedCount++;
                    await sendLogMessage(interaction, "revoked", role.name, member.user);
                } catch (error) {
                    console.error(`Failed to remove role ${role.name} from ${member.user.tag}:`, error);
                    response += `- ⚠️ Failed to remove <@&${role.id}>: ${error.message}\n`;
                    failedRemovalsCount++;
                }
            }
            response += "\n";
        }
        response += `\n**Summary** — Users: ${usersToProcess.size} | Removed: ${rolesRemovedCount} | Failed: ${failedRemovalsCount}`;

        await interaction.editReply({
            content: response.length > 2000 ? response.substring(0, 1997) + "..." : response,
            components: [],
        });

    } catch (error) {
        console.error("Error in revoke logic:", error);
        await interaction.editReply({
            content: `An error occurred: ${error.message}`,
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("role")
        .setDescription("Manage specific roles in the server.")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("assign")
                .setDescription("assigns roles.")
                .addUserOption((option) =>
                    option
                        .setName("user")
                        .setDescription("The member to assign the role to")
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName("role")
                        .setDescription("The role to assign")
                        .setRequired(true)
                        .addChoices(
                            ...ASSIGNABLE_ROLES.map((r) => ({
                                name: r.name,
                                value: r.name,
                            }))
                        )
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("remove")
                .setDescription("Removes roles")
                .addUserOption((option) =>
                    option
                        .setName("user")
                        .setDescription("The member to remove the role from")
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName("role")
                        .setDescription("The role to remove")
                        .setRequired(true)
                        .addChoices(
                            ...ASSIGNABLE_ROLES.map((r) => ({
                                name: r.name,
                                value: r.name,
                            }))
                        )
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("revoke")
                .setDescription(
                    "Revokes gradient/custom roles from unauthorized users."
                )
                .addStringOption((option) =>
                    option
                        .setName("category")
                        .setDescription("The category of roles to check")
                        .setRequired(true)
                        .addChoices(
                            { name: "All Categories", value: "all" },
                            ...ROLE_CATEGORIES.map(cat => ({
                                name: cat.label,
                                value: cat.id
                            }))
                        )
                )
                .addStringOption((option) =>
                    option
                        .setName("action")
                        .setDescription("Action to take")
                        .setRequired(false)
                        .addChoices(
                            { name: "List Unauthorized Users", value: "list" },
                            { name: "Execute Revoke", value: "execute" }
                        )
                )
                .addBooleanOption((option) =>
                    option
                        .setName("visible")
                        .setDescription("Post the result publicly in the channel (default: hidden/ephemeral)")
                        .setRequired(false)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "assign") {
            await handleAssign(interaction);
        } else if (subcommand === "remove") {
            await handleRemove(interaction);
        } else if (subcommand === "revoke") {
            await handleRevoke(interaction);
        }
    },
};
