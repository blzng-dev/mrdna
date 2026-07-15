const {
    Events,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} = require("discord.js");
const menuData = require("../data/menu-data.json");
const commandData = require("../data/command-data.json");

const TRANSCRIPT_LOG_CHANNEL_ID = "915884828153511946";
const STAFF_ROLE_IDS = ["913864890916147270", "857990235194261514"];

const ROLE_CATEGORIES = require("../data/role-categories.js");

// Build REVOKE_CONFIGS the same way role.js does, for button handler use
const REVOKE_CONFIGS = {};
ROLE_CATEGORIES.forEach(cat => {
    REVOKE_CONFIGS[cat.id] = {
        minRoleId: cat.minId,
        maxRoleId: cat.maxId,
        requiredRoleIds: cat.requiredRoles,
        title: cat.label,
        unauthorizedReason: "Revoked unauthorized gradient role",
    };
});

// NOTE: Assumes guild.roles.fetch() + guild.members.fetch() have already been called.
function scanCategoryForRevoke(guild, config) {
    const minRole = guild.roles.cache.get(config.minRoleId);
    const maxRole = guild.roles.cache.get(config.maxRoleId);

    if (!minRole || !maxRole) return null;

    const lowerBound = Math.min(minRole.position, maxRole.position);
    const upperBound = Math.max(minRole.position, maxRole.position);

    const targetRoles = guild.roles.cache.filter(
        (role) => role.position > lowerBound && role.position < upperBound
    );
    if (targetRoles.size === 0) return null;

    const usersToProcess = new Map();
    guild.members.cache.forEach((member) => {
        if (member.user.bot) return;
        const isAuthorized = config.requiredRoleIds.some(id => member.roles.cache.has(id));
        if (!isAuthorized) {
            const rolesToRemove = member.roles.cache.filter(r => targetRoles.has(r.id));
            if (rolesToRemove.size > 0) {
                usersToProcess.set(member.id, { member, roles: Array.from(rolesToRemove.values()) });
            }
        }
    });
    return usersToProcess;
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        try {
            // 1. SLASH COMMANDS & CONTEXT MENUS
            if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
                const command = interaction.client.commands.get(
                    interaction.commandName
                );
                if (!command) return;

                try {
                    await command.execute(interaction);
                } catch (error) {
                    if (error.code === 10062) {
                        console.warn(`[Command Warning] Unknown Interaction (Timeout) for ${interaction.commandName}`);
                    } else {
                        console.error(error);
                    }

                    try {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({
                                content: "There was an error executing this command!",
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            await interaction.reply({
                                content: "There was an error executing this command!",
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                    } catch (err) {
                        // Ignore secondary errors (e.g. Unknown Interaction if timed out)
                        if (err.code !== 10062) {
                            console.error("Failed to send error response:", err.message);
                        }
                    }
                }
                return;
            }

            // 2. AUTOCOMPLETE (NEW - REQUIRED FOR WORDLE CATEGORIES)
            if (interaction.isAutocomplete()) {
                const command = interaction.client.commands.get(
                    interaction.commandName
                );
                if (!command) return;

                try {
                    await command.autocomplete(interaction);
                } catch (error) {
                    console.error(error);
                }
                return;
            }

            // 3. BUTTONS
            if (interaction.isButton()) {
                const customId = interaction.customId;

                // --- A. Transcript Logging ---
                if (customId.startsWith("send_to_logs")) {
                    const attachment = interaction.message.attachments.first();
                    if (!attachment) {
                        return interaction.reply({
                            content:
                                "Error: No transcript file found on this message.",
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await interaction.deferUpdate();

                    const logChannel = await interaction.guild.channels.fetch(
                        TRANSCRIPT_LOG_CHANNEL_ID
                    );
                    if (logChannel) {
                        await logChannel.send({
                            content: interaction.message.content,
                            files: [attachment],
                        });

                        const disabledRow = ActionRowBuilder.from(
                            interaction.message.components[0]
                        );
                        disabledRow.components[0]
                            .setDisabled(true)
                            .setLabel("Sent to Logs")
                            .setStyle(ButtonStyle.Success);
                        await interaction.editReply({ components: [disabledRow] });
                    } else {
                        await interaction.followUp({
                            content: "Log channel not found.",
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                    return;
                }

                // --- B. Unequip All Cosmetics ---
                if (customId === "unequip_all") {
                    await interaction.deferReply({
                        flags: MessageFlags.Ephemeral,
                    });

                    let allCosmeticRoleIds = [];
                    await interaction.guild.roles.fetch();
                    for (const cat of ROLE_CATEGORIES) {
                        const minRole = interaction.guild.roles.cache.get(
                            cat.minId
                        );
                        const maxRole = interaction.guild.roles.cache.get(
                            cat.maxId
                        );
                        if (minRole && maxRole) {
                            interaction.guild.roles.cache.forEach((r) => {
                                if (
                                    r.position >
                                    Math.min(
                                        minRole.position,
                                        maxRole.position
                                    ) &&
                                    r.position <
                                    Math.max(
                                        minRole.position,
                                        maxRole.position
                                    )
                                ) {
                                    allCosmeticRoleIds.push(r.id);
                                }
                            });
                        }
                    }

                    const rolesToRemove = interaction.member.roles.cache.filter(
                        (r) => allCosmeticRoleIds.includes(r.id)
                    );
                    if (rolesToRemove.size > 0) {
                        await interaction.member.roles.remove(rolesToRemove);
                        await interaction.editReply({
                            content: `removed: ${rolesToRemove.map(r => r.toString()).join(', ')}`,
                        });
                    } else {
                        await interaction.editReply({
                            content:
                                "You don't have any cosmetic roles equipped.",
                        });
                    }
                    return;
                }

                // --- C. Legacy & Generic Buttons ---
                if (customId === "show-retired-staff") {
                    await handleRetiredStaff(interaction);
                    return;
                }

                const handler = findInteractionHandler(customId);
                if (handler) {
                    await interaction.reply({
                        content: handler.content,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                // --- D. Revoke Execute Button ---
                if (customId.startsWith("revoke_execute_")) {
                    if (!interaction.member.permissions.has(0x10000000n)) { // ManageRoles
                        return interaction.reply({
                            content: 'You need the "Manage Roles" permission to use this.',
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    await Promise.all([
                        interaction.guild.roles.fetch(),
                        interaction.guild.members.fetch({ time: 60_000 }),
                    ]);

                    const categoryKey = customId.replace("revoke_execute_", "");
                    const categoriesToProcess = categoryKey === "all"
                        ? ROLE_CATEGORIES
                        : ROLE_CATEGORIES.filter(c => c.id === categoryKey);

                    if (categoriesToProcess.length === 0) {
                        return interaction.editReply({ content: "Unknown category." });
                    }

                    let response = categoryKey === "all"
                        ? `# Unauthorized Roles — All Categories (Execute)\n\n`
                        : `# Unauthorized ${REVOKE_CONFIGS[categoryKey]?.title} (Execute)\n\n`;

                    let totalRemoved = 0;
                    let totalFailed = 0;
                    let totalUsers = 0;

                    for (const cat of categoriesToProcess) {
                        const config = REVOKE_CONFIGS[cat.id];
                        if (!config) continue;

                        const usersToProcess = await scanCategoryForRevoke(interaction.guild, config);

                        if (!usersToProcess || usersToProcess.size === 0) {
                            if (categoryKey === "all") response += `## ${config.title}\n✅ No unauthorized users.\n\n`;
                            continue;
                        }

                        if (categoryKey === "all") response += `## ${config.title}\n`;
                        totalUsers += usersToProcess.size;

                        for (const [userId, { member, roles }] of usersToProcess.entries()) {
                            response += `<@${userId}>:\n`;
                            for (const role of roles) {
                                try {
                                    await member.roles.remove(role, config.unauthorizedReason);
                                    response += `- ✅ Removed <@&${role.id}>\n`;
                                    totalRemoved++;
                                } catch (err) {
                                    response += `- ⚠️ Failed <@&${role.id}>: ${err.message}\n`;
                                    totalFailed++;
                                }
                            }
                        }
                        response += "\n";
                    }

                    response += `## Summary\n- Users processed: ${totalUsers}\n- Roles removed: ${totalRemoved}\n- Failed: ${totalFailed}`;

                    // Disable the button on the original list message
                    try {
                        const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
                        disabledRow.components[0].setDisabled(true).setLabel("Revoke Executed").setStyle(ButtonStyle.Secondary);
                        await interaction.message.edit({ components: [disabledRow] });
                    } catch (_) {}

                    return interaction.editReply({
                        content: response.length > 2000 ? response.substring(0, 1997) + "..." : response,
                    });
                }

                // --- E. Stream Role Toggle ---

                if (customId === "toggle_stream_role") {
                    const roleId = "1498877432780820610";
                    const member = interaction.member;
                    const hasRole = member.roles.cache.has(roleId);

                    if (hasRole) {
                        await member.roles.remove(roleId);
                        await interaction.reply({
                            content: `**Removed**: <@&${roleId}>\n-# You will not get pinged for streams`,
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        await member.roles.add(roleId);
                        await interaction.reply({
                            content: `**Added**: <@&${roleId}>\n-# You will get pinged for streams`,
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                    return;
                }
            }

            // 4. SELECT MENUS
            else if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;
                const selectedValue = interaction.values[0];

                if (customId === "revoke_select_categories") {
                    if (!interaction.member.permissions.has(0x10000000n)) {
                        return interaction.reply({
                            content: 'You need the "Manage Roles" permission.',
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    await Promise.all([
                        interaction.guild.roles.fetch(),
                        interaction.guild.members.fetch({ time: 60_000 }),
                    ]);

                    const selectedCategoryIds = interaction.values;
                    let response = "";
                    let totalRemoved = 0;
                    let totalFailed = 0;
                    let totalUsers = 0;

                    for (const catId of selectedCategoryIds) {
                        const config = REVOKE_CONFIGS[catId];
                        if (!config) continue;

                        const usersToProcess = await scanCategoryForRevoke(interaction.guild, config);

                        if (!usersToProcess || usersToProcess.size === 0) {
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
                                } catch (err) {
                                    response += `- ⚠️ Failed <@&${role.id}>: ${err.message}\n`;
                                    totalFailed++;
                                }
                            }
                        }
                    }

                    response += `\n**Summary** — Users: ${totalUsers} | Removed: ${totalRemoved} | Failed: ${totalFailed}`;

                    // Disable the select menu on the original message
                    try {
                        const disabledMenu = StringSelectMenuBuilder
                            .from(interaction.message.components[0].components[0])
                            .setDisabled(true)
                            .setPlaceholder("Revoke executed");
                        await interaction.message.edit({
                            components: [new ActionRowBuilder().addComponents(disabledMenu)],
                        });
                    } catch (_) {}

                    return interaction.editReply({
                        content: response.length > 2000 ? response.substring(0, 1997) + "..." : response,
                    });
                }

                if (customId.startsWith("select_")) {

                    await handleGradientSelection(
                        interaction,
                        customId,
                        selectedValue
                    );
                    return;
                }

                if (selectedValue === "staff-info") {
                    await handleStaffInfo(interaction);
                    return;
                }

                const handler = findInteractionHandler(customId, selectedValue);
                if (handler) {
                    const originalComponents = resetPlaceholder(
                        interaction,
                        customId
                    );
                    await interaction.update({
                        components: originalComponents,
                    });
                    await interaction.followUp({
                        content: handler.content,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
            }
        } catch (error) {
            console.error(`Error in interactionCreate:`, error);
        }
    },
};

// --- HELPER FUNCTIONS ---

async function handleGradientSelection(interaction, customId, selectedValue) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const categoryId = customId.replace("select_", "");
    const cat = ROLE_CATEGORIES.find((c) => c.id === categoryId);

    if (!cat) return interaction.editReply("Unknown role category.");

    const isAuthorized =
        cat.requiredRoles.length === 0 ||
        cat.requiredRoles.some((id) => interaction.member.roles.cache.has(id));
    if (!isAuthorized) {
        return interaction.editReply(
            `You do not have permission to select roles from **${cat.label}**.`
        );
    }

    const selectedRole = interaction.guild.roles.cache.get(selectedValue);

    const targetHasIcon = cat.hasIcon || false;
    let rolesToRemoveIds = [];

    for (const c of ROLE_CATEGORIES) {
        const cHasIcon = c.hasIcon || false;
        if (cHasIcon === targetHasIcon) {
            const min = interaction.guild.roles.cache.get(c.minId);
            const max = interaction.guild.roles.cache.get(c.maxId);
            if (min && max) {
                interaction.guild.roles.cache.forEach((r) => {
                    if (
                        r.position > Math.min(min.position, max.position) &&
                        r.position < Math.max(min.position, max.position)
                    ) {
                        rolesToRemoveIds.push(r.id);
                    }
                });
            }
        }
    }

    const currentCosmetics = interaction.member.roles.cache.filter((r) =>
        rolesToRemoveIds.includes(r.id)
    );
    
    const removedRoles = currentCosmetics.size > 0 ? currentCosmetics.map(r => r.toString()).join(', ') : "";

    if (currentCosmetics.size > 0)
        await interaction.member.roles.remove(currentCosmetics);

    if (selectedRole) {
        await interaction.member.roles.add(selectedRole);
        
        let content = `added: ${selectedRole.toString()}`;
        if (removedRoles) {
            content += `\nremoved: ${removedRoles}`;
        }
        await interaction.editReply(content);
    }
}

function findInteractionHandler(customId, value = null) {
    for (const item of menuData) {
        if (!item.components) continue;
        for (const component of item.components) {
            if (
                component.type === "button" &&
                component.custom_id === customId
            ) {
                return component.onInteraction;
            }
            if (
                component.type === "string-select-menu" &&
                component.custom_id === customId
            ) {
                if (value && component.options) {
                    for (const option of component.options) {
                        if (option.value === value) return option.onInteraction;
                    }
                }
            }
        }
    }
    if (commandData && commandData.components) {
        for (const component of commandData.components) {
            if (
                component.type === "button" &&
                component.custom_id === customId
            ) {
                return component.onInteraction;
            }
        }
    }
    return null;
}

async function handleRetiredStaff(interaction) {
    try {
        await interaction.deferUpdate();
        const members = await interaction.guild.members.fetch();
        const retiredRole = interaction.guild.roles.cache.get(
            "1349062812722397305"
        );
        let content = "# RETIRED STAFF\n\n**Retired Staff**\n";
        if (retiredRole) {
            const retired = members.filter((m) =>
                m.roles.cache.has(retiredRole.id)
            );
            if (retired.size > 0)
                retired.forEach((m) => (content += `- ${m.toString()}\n`));
            else content += "- No members found.\n";
        } else content += "- Role not found.\n";
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } catch (error) {
        console.error("Error in retired staff:", error);
    }
}

async function handleStaffInfo(interaction) {
    try {
        const originalComponents = resetPlaceholder(
            interaction,
            interaction.customId
        );
        await interaction.update({ components: originalComponents });
        const guild = interaction.guild;
        const members = await guild.members.fetch();

        const roles = {
            admin: guild.roles.cache.get("913864890916147270"),
            senior: guild.roles.cache.get("867964544717295646"),
            staff: guild.roles.cache.get("842763148985368617"),
            trial: guild.roles.cache.get("842742230409150495"),
        };
        let content = "# STAFF\nhierarchy of staff in the server\n\n";
        const listMembers = (role, title) => {
            content += `**${title}** (${role ? role.toString() : "Role not found"
                })\n`;
            if (role) {
                const matched = members.filter((m) =>
                    m.roles.cache.has(role.id)
                );
                if (matched.size > 0)
                    matched.forEach((m) => (content += `- ${m.toString()}\n`));
                else content += "- No members\n";
            }
            content += "\n";
        };
        listMembers(roles.admin, "Administrators");
        listMembers(roles.senior, "Senior Staff");
        listMembers(roles.staff, "Staff");
        listMembers(roles.trial, "Trial Staff");
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("show-retired-staff")
                .setLabel("Show Retired Staff")
                .setStyle(ButtonStyle.Secondary)
        );
        await interaction.followUp({
            content,
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        console.error("Error in staff info:", error);
    }
}

function resetPlaceholder(interaction, targetCustomId) {
    return interaction.message.components.map((row) => {
        const newRow = new ActionRowBuilder();
        row.components.forEach((component) => {
            if (component.type === 3) {
                const newMenu = StringSelectMenuBuilder.from(component);
                if (component.customId === targetCustomId) {
                    const originalItem = menuData.find((item) =>
                        item.components?.some(
                            (comp) => comp.custom_id === targetCustomId
                        )
                    );
                    const originalComp = originalItem?.components?.find(
                        (comp) => comp.custom_id === targetCustomId
                    );
                    newMenu.setPlaceholder(
                        originalComp?.placeholder || "Select an option"
                    );
                }
                newRow.addComponents(newMenu);
            } else if (component.type === 2) {
                newRow.addComponents(ButtonBuilder.from(component));
            }
        });
        return newRow;
    });
}
