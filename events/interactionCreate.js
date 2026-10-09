const {
    Events,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    FileBuilder,
    AttachmentBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
} = require("discord.js");
const menuData = require("../data/menu-data.json");
const commandData = require("../data/command-data.json");
const {
    handleGiveawayModal,
    handleGiveawayButton,
} = require("../utils/giveawayInteractionHandler");

const TRANSCRIPT_LOG_CHANNEL_ID = "915884828153511946";

const ROLE_CATEGORIES = require("../data/role-categories.js");
const { notifyError } = require("../utils/errorNotifier");

const STRINGS = {
    errors: {
        notAuthor: "Only the user who ran this command can use this.",
        manageRolesRequired: 'You need the "Manage Roles" permission to use this.',
        unknownCategory: "Unknown category.",
        noTranscriptFound: "Error: No transcript file found on this message.",
        logChannelNotFound: "Log channel not found.",
    },
    buttons: {
        sentToLogs: "Sent to Logs",
    },
};

// Build REVOKE_CONFIGS the same way role.js does, for button handler use
const REVOKE_CONFIGS = {};
ROLE_CATEGORIES.forEach((cat) => {
    REVOKE_CONFIGS[cat.id] = {
        minRoleId: cat.minId,
        maxRoleId: cat.maxId,
        requiredRoleIds: cat.requiredRoles,
        bypassUsers: cat.bypassUsers || [],
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
        (role) => role.position > lowerBound && role.position < upperBound,
    );
    if (targetRoles.size === 0) return null;

    const usersToProcess = new Map();
    guild.members.cache.forEach((member) => {
        if (member.user.bot) return;
        const isAuthorized =
            (config.bypassUsers && config.bypassUsers.includes(member.id)) ||
            config.requiredRoleIds.some((id) =>
                member.roles.cache.has(id),
            );
        if (!isAuthorized) {
            const rolesToRemove = member.roles.cache.filter((r) =>
                targetRoles.has(r.id),
            );
            if (rolesToRemove.size > 0) {
                usersToProcess.set(member.id, {
                    member,
                    roles: Array.from(rolesToRemove.values()),
                });
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
            if (
                interaction.isChatInputCommand() ||
                interaction.isContextMenuCommand()
            ) {
                const command = interaction.client.commands.get(
                    interaction.commandName,
                );
                if (!command) return;

                try {
                    await command.execute(interaction);
                } catch (error) {
                    if (error.code === 10062) {
                        console.warn(
                            `[Command Warning] Unknown Interaction (Timeout) for ${interaction.commandName}`,
                        );
                    } else {
                        console.error(error);
                        notifyError(error, `Command Error: /${interaction.commandName}`);
                    }

                    try {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({
                                content:
                                    "There was an error executing this command!",
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            await interaction.reply({
                                content:
                                    "There was an error executing this command!",
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                    } catch (err) {
                        // Ignore secondary errors (e.g. Unknown Interaction if timed out)
                        if (err.code !== 10062) {
                            console.error(
                                "Failed to send error response:",
                                err.message,
                            );
                        }
                    }
                }
                return;
            }

            // 2. AUTOCOMPLETE (NEW - REQUIRED FOR WORDLE CATEGORIES)
            if (interaction.isAutocomplete()) {
                const command = interaction.client.commands.get(
                    interaction.commandName,
                );
                if (!command) return;

                try {
                    await command.autocomplete(interaction);
                } catch (error) {
                    console.error(error);
                }
                return;
            }

            // 2.5 MODAL SUBMITS
            if (interaction.isModalSubmit()) {
                if (
                    interaction.customId.startsWith("giveaway_create_modal_") ||
                    interaction.customId.startsWith("giveaway_edit_modal_")
                ) {
                    try {
                        await handleGiveawayModal(interaction);
                    } catch (error) {
                        console.error("[Giveaway Modal Error]", error);
                    }
                    return;
                }

                if (interaction.customId.startsWith("forum_title_modal_")) {
                    const messageCommand =
                        interaction.client.commands.get("message");
                    if (
                        messageCommand &&
                        messageCommand.handleForumTitleModal
                    ) {
                        try {
                            await messageCommand.handleForumTitleModal(
                                interaction,
                            );
                        } catch (error) {
                            console.error(error);
                        }
                    }
                    return;
                }

                // --- Ticket Creation & DM Modals ---
                if (interaction.customId === "ticket_creation_modal") {
                    const { handleTicketModalSubmit } = require("../utils/ticketHandler");
                    return handleTicketModalSubmit(interaction);
                } else if (interaction.customId.startsWith("ticket_dm_modal_")) {
                    const { handleTicketDmModalSubmit } = require("../utils/ticketHandler");
                    return handleTicketDmModalSubmit(interaction);
                } else if (interaction.customId === "ticket_preview_edit_subject_modal") {
                    const { handleTicketPreviewEditSubjectSubmit } = require("../utils/ticketHandler");
                    return handleTicketPreviewEditSubjectSubmit(interaction);
                } else if (interaction.customId === "ticket_preview_edit_body_modal") {
                    const { handleTicketPreviewEditBodySubmit } = require("../utils/ticketHandler");
                    return handleTicketPreviewEditBodySubmit(interaction);
                } else if (interaction.customId === "ticket_preview_edit_users_modal") {
                    const { handleTicketPreviewEditUsersSubmit } = require("../utils/ticketHandler");
                    return handleTicketPreviewEditUsersSubmit(interaction);
                } else if (interaction.customId === "ticket_preview_add_files_modal") {
                    const { handleTicketPreviewAddFilesSubmit } = require("../utils/ticketHandler");
                    return handleTicketPreviewAddFilesSubmit(interaction);
                }

                let commandName = null;
                if (
                    interaction.customId === "message_modal" ||
                    interaction.customId.startsWith("message_modal_")
                ) {
                    commandName = "message";
                } else if (
                    interaction.customId.startsWith("edit_message_modal")
                ) {
                    commandName = "Edit Message";
                } else if (interaction.customId.startsWith("add_link_modal_")) {
                    commandName = "Add Link Button";
                } else if (
                    interaction.customId.startsWith("replace_media_modal_")
                ) {
                    commandName = "Replace Media";
                } else if (
                    interaction.customId.startsWith("add_media_modal_")
                ) {
                    commandName = "Add Media";
                } else if (
                    interaction.customId.startsWith("remove_media_modal_")
                ) {
                    commandName = "Remove Media";
                } else if (
                    interaction.customId.startsWith("btn_add_modal_")
                ) {
                    commandName = "Add Button";
                } else if (
                    interaction.customId.startsWith("btn_edit_form_")
                ) {
                    commandName = "Edit Button";
                } else if (
                    interaction.customId.startsWith("btn_remove_modal_")
                ) {
                    commandName = "Remove Button";
                } else if (
                    interaction.customId.startsWith("report_msg_modal_")
                ) {
                    commandName = "Report to Staff";
                }

                if (commandName) {
                    const command =
                        interaction.client.commands.get(commandName);
                    if (command && command.handleModal) {
                        try {
                            await command.handleModal(interaction);
                        } catch (error) {
                            console.error(error);
                        }
                    }
                }
                return;
            }

            // 3. BUTTONS
            if (interaction.isButton()) {
                const customId = interaction.customId;

                // --- Ticket Open Button ---
                if (customId === "ticket_open") {
                    const { buildTicketModal } = require("../utils/ticketModal");
                    return interaction.showModal(buildTicketModal());
                }

                // --- Ticket Action Buttons ---
                if (customId === "ticket_claim") {
                    const { handleTicketClaim } = require("../utils/ticketHandler");
                    return handleTicketClaim(interaction);
                } else if (customId === "ticket_create_channel") {
                    const { handleTicketCreatePrivateChannel } = require("../utils/ticketHandler");
                    return handleTicketCreatePrivateChannel(interaction);
                } else if (customId === "ticket_dm_user") {
                    const { handleTicketDmUser } = require("../utils/ticketHandler");
                    return handleTicketDmUser(interaction);
                } else if (customId.startsWith("ticket_dm_confirm_")) {
                    const { handleTicketDmConfirm } = require("../utils/ticketHandler");
                    return handleTicketDmConfirm(interaction);
                } else if (customId.startsWith("ticket_dm_edit_")) {
                    const { handleTicketDmEdit } = require("../utils/ticketHandler");
                    return handleTicketDmEdit(interaction);
                } else if (customId.startsWith("ticket_mark_resolved")) {
                    const { promptTicketResolve } = require("../utils/ticketHandler");
                    const threadId = customId.replace("ticket_mark_resolved_", "");
                    return promptTicketResolve(interaction, threadId !== "ticket_mark_resolved" ? threadId : null);
                } else if (customId === "ticket_channel_lock_toggle") {
                    const { handleChannelLockToggle } = require("../utils/ticketHandler");
                    return handleChannelLockToggle(interaction);
                } else if (customId === "ticket_channel_close_toggle") {
                    const { handleChannelCloseToggle } = require("../utils/ticketHandler");
                    return handleChannelCloseToggle(interaction);
                } else if (customId === "ticket_channel_delete") {
                    const { handleChannelDelete } = require("../utils/ticketHandler");
                    return handleChannelDelete(interaction);
                }

                // --- Ticket Confirmation Triggers ---
                if (customId === "ticket_confirm_cancel") {
                    const { STRINGS } = require("../utils/ticketHandler");
                    const isComponentsV2 = Boolean(interaction.message?.flags?.has(MessageFlags.IsComponentsV2));
                    if (isComponentsV2) {
                        return interaction.update({
                            components: [new TextDisplayBuilder().setContent(STRINGS.confirmations.cancelled)],
                            flags: MessageFlags.IsComponentsV2,
                        });
                    }
                    return interaction.update({
                        content: STRINGS.confirmations.cancelled,
                        components: [],
                    });
                } else if (customId === "ticket_confirm_lock_toggle") {
                    const { executeChannelLockToggle } = require("../utils/ticketHandler");
                    return executeChannelLockToggle(interaction);
                } else if (customId === "ticket_confirm_close_toggle") {
                    const { executeChannelCloseToggle } = require("../utils/ticketHandler");
                    return executeChannelCloseToggle(interaction);
                } else if (customId === "ticket_confirm_channel_delete") {
                    const { executeChannelDelete } = require("../utils/ticketHandler");
                    return executeChannelDelete(interaction);
                } else if (customId.startsWith("ticket_confirm_resolve_")) {
                    const { handleTicketMarkResolved } = require("../utils/ticketHandler");
                    const threadId = customId.replace("ticket_confirm_resolve_", "");
                    return handleTicketMarkResolved(interaction, threadId);
                } else if (customId.startsWith("ticket_conf_usr_tok_")) {
                    const { executeChannelUserToggle } = require("../utils/ticketHandler");
                    const token = customId.replace("ticket_conf_usr_tok_", "");
                    return executeChannelUserToggle(interaction, token);
                } else if (customId.startsWith("ticket_conf_usr_a_")) {
                    const { executeChannelUserToggle } = require("../utils/ticketHandler");
                    const match = customId.match(/^ticket_conf_usr_a_(.+)_r_(.+)$/);
                    if (match) {
                        return executeChannelUserToggle(interaction, match[1], match[2]);
                    }
                } else if (customId === "ticket_preview_edit_subject") {
                    const { handleTicketPreviewEditSubject } = require("../utils/ticketHandler");
                    return handleTicketPreviewEditSubject(interaction);
                } else if (customId === "ticket_preview_edit_body") {
                    const { handleTicketPreviewEditBody } = require("../utils/ticketHandler");
                    return handleTicketPreviewEditBody(interaction);
                } else if (customId === "ticket_preview_edit_users") {
                    const { handleTicketPreviewEditUsers } = require("../utils/ticketHandler");
                    return handleTicketPreviewEditUsers(interaction);
                } else if (customId === "ticket_preview_add_files") {
                    const { handleTicketPreviewAddFiles } = require("../utils/ticketHandler");
                    return handleTicketPreviewAddFiles(interaction);
                } else if (customId === "ticket_preview_send") {
                    const { handleTicketPreviewSend } = require("../utils/ticketHandler");
                    return handleTicketPreviewSend(interaction);
                } else if (customId === "ticket_preview_cancel") {
                    const { handleTicketPreviewCancel } = require("../utils/ticketHandler");
                    return handleTicketPreviewCancel(interaction);
                }

                // --- Report Action Buttons (Delete Message, Dismiss) ---
                if (customId.startsWith("report_del_") || customId.startsWith("report_dismiss_")) {
                    const reportCommand = interaction.client.commands.get("Report to Staff");
                    if (reportCommand && reportCommand.handleButton) {
                        return reportCommand.handleButton(interaction);
                    }
                }

                // --- Report Slash Command Launch Button ---
                if (customId.startsWith("report_launch_")) {
                    const reportSlash = interaction.client.commands.get("report");
                    if (reportSlash && reportSlash.handleLaunch) {
                        return reportSlash.handleLaunch(interaction);
                    }
                }

                // --- Giveaway Buttons (Entry Toggle & Multi-Role Prompt) ---
                if (
                    customId === "giveaway_enter" ||
                    customId.startsWith("giveaway_enter_") ||
                    customId.startsWith("giveaway_rolemode_")
                ) {
                    try {
                        await handleGiveawayButton(interaction);
                    } catch (error) {
                        console.error("[Giveaway Button Error]", error);
                    }
                    return;
                }

                // --- Forum Post Setup Buttons ---
                if (
                    customId.startsWith("forum_title_btn_") ||
                    customId.startsWith("forum_confirm_") ||
                    customId.startsWith("forum_cancel_")
                ) {
                    const messageCommand =
                        interaction.client.commands.get("message");
                    if (messageCommand && messageCommand.handleForumButton) {
                        try {
                            await messageCommand.handleForumButton(interaction);
                        } catch (error) {
                            console.error(error);
                        }
                    }
                    return;
                }

                // --- A. Transcript Logging ---
                // --- A. Transcript Logging ---
                if (customId === "send_to_logs") {
                    let messageToUse = interaction.message;
                    let attachments = Array.from(messageToUse.attachments?.values() || []);

                    // Ephemeral messages or Components V2 messages may not expose attachments on interaction.message.
                    // Extract file components (type 13) from the container if attachments collection is empty.
                    if (attachments.length === 0) {
                        const fileComponents = [];
                        for (const topComp of (messageToUse.components || [])) {
                            if (topComp.type === 13) {
                                fileComponents.push(topComp);
                            } else if (topComp.components) {
                                for (const sub of topComp.components) {
                                    if (sub.type === 13) fileComponents.push(sub);
                                }
                            }
                        }

                        for (const fc of fileComponents) {
                            const fileUrl = fc.file?.url || fc.url;
                            if (fileUrl) {
                                const filename = fc.file?.name || fileUrl.split("/").pop().split("?")[0] || "file";
                                try {
                                    const res = await fetch(fileUrl);
                                    if (res.ok) {
                                        const buf = Buffer.from(await res.arrayBuffer());
                                        attachments.push(new AttachmentBuilder(buf, { name: filename }));
                                    }
                                } catch (err) {
                                    console.error("[send_to_logs] Failed to fetch file component:", err);
                                }
                            }
                        }
                    }

                    if (attachments.length === 0) {
                        return interaction.reply({
                            content: STRINGS.errors.noTranscriptFound,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await interaction.deferUpdate();

                    const logChannel = await interaction.guild.channels.fetch(
                        TRANSCRIPT_LOG_CHANNEL_ID,
                    ).catch(() => null);

                    if (!logChannel) {
                        return interaction.followUp({
                            content: STRINGS.errors.logChannelNotFound,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    // Build container for log channel (strip out ActionRow)
                    const rawContainer = interaction.message.components.find((c) => c.type === 17) || interaction.message.components[0];
                    const logContainer = new ContainerBuilder();
                    for (const inner of (rawContainer?.components || [])) {
                        if (inner.type === 1) continue; // Skip ActionRow
                        if (inner.type === 10) {
                            logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(inner.content));
                        } else if (inner.type === 13) {
                            const rawUrl = inner.file?.url || inner.url || "";
                            let filename = "";
                            if (rawUrl.startsWith("attachment://")) {
                                filename = rawUrl.replace("attachment://", "");
                            } else {
                                filename = inner.file?.name || rawUrl.split("/").pop().split("?")[0] || "file";
                            }
                            logContainer.addFileComponents(new FileBuilder().setURL(`attachment://${filename}`));
                        }
                    }

                    // 1. Send the exact message to the log channel without the button
                    const logMsg = await logChannel.send({
                        components: [logContainer],
                        files: attachments,
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [] },
                    }).catch(console.error);

                    // 2. Also send reply with raw .txt file for Discord native unfurl
                    const txtAttachment = attachments.find((a) => (a.name || "").endsWith(".txt"));
                    if (logMsg && txtAttachment) {
                        await logMsg.reply({
                            files: [txtAttachment],
                            allowedMentions: { parse: [] },
                        }).catch(console.error);
                    }

                    // 3. Update original message to show disabled "Sent to Logs" button outside container
                    const updatedContainer = new ContainerBuilder();
                    for (const inner of (rawContainer?.components || [])) {
                        if (inner.type === 1) continue; // Skip if any row was nested
                        if (inner.type === 10) {
                            updatedContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(inner.content));
                        } else if (inner.type === 13) {
                            const rawUrl = inner.file?.url || inner.url || "";
                            let filename = "";
                            if (rawUrl.startsWith("attachment://")) {
                                filename = rawUrl.replace("attachment://", "");
                            } else {
                                filename = inner.file?.name || rawUrl.split("/").pop().split("?")[0] || "file";
                            }
                            updatedContainer.addFileComponents(new FileBuilder().setURL(`attachment://${filename}`));
                        }
                    }

                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId("sent_to_logs")
                            .setLabel(STRINGS.buttons.sentToLogs)
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true),
                    );

                    await interaction.editReply({
                        components: [updatedContainer, disabledRow],
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [] },
                    });
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
                            cat.minId,
                        );
                        const maxRole = interaction.guild.roles.cache.get(
                            cat.maxId,
                        );
                        if (minRole && maxRole) {
                            interaction.guild.roles.cache.forEach((r) => {
                                if (
                                    r.position >
                                        Math.min(
                                            minRole.position,
                                            maxRole.position,
                                        ) &&
                                    r.position <
                                        Math.max(
                                            minRole.position,
                                            maxRole.position,
                                        )
                                ) {
                                    allCosmeticRoleIds.push(r.id);
                                }
                            });
                        }
                    }

                    const rolesToRemove = interaction.member.roles.cache.filter(
                        (r) => allCosmeticRoleIds.includes(r.id),
                    );
                    if (rolesToRemove.size > 0) {
                        await interaction.member.roles.remove(rolesToRemove);
                        await interaction.editReply({
                            content: `removed: ${rolesToRemove.map((r) => r.toString()).join(", ")}`,
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
                    const originalAuthorId =
                        interaction.message?.interactionMetadata?.user?.id;
                    if (originalAuthorId && interaction.user.id !== originalAuthorId) {
                        return interaction.reply({
                            content: STRINGS.errors.notAuthor,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    if (!interaction.member.permissions.has(0x10000000n)) {
                        // ManageRoles
                        return interaction.reply({
                            content: STRINGS.errors.manageRolesRequired,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await interaction.deferReply({
                        flags: MessageFlags.Ephemeral,
                    });
                    await Promise.all([
                        interaction.guild.roles.fetch(),
                        interaction.guild.members.fetch({ time: 60_000 }),
                    ]);

                    const categoryKey = customId.replace("revoke_execute_", "");
                    const categoriesToProcess =
                        categoryKey === "all"
                            ? ROLE_CATEGORIES
                            : ROLE_CATEGORIES.filter(
                                  (c) => c.id === categoryKey,
                              );

                    if (categoriesToProcess.length === 0) {
                        return interaction.editReply({
                            content: "Unknown category.",
                        });
                    }

                    let response =
                        categoryKey === "all"
                            ? `# Unauthorized Roles — All Categories (Execute)\n\n`
                            : `# Unauthorized ${REVOKE_CONFIGS[categoryKey]?.title} (Execute)\n\n`;

                    let totalRemoved = 0;
                    let totalFailed = 0;
                    let totalUsers = 0;

                    for (const cat of categoriesToProcess) {
                        const config = REVOKE_CONFIGS[cat.id];
                        if (!config) continue;

                        const usersToProcess = await scanCategoryForRevoke(
                            interaction.guild,
                            config,
                        );

                        if (!usersToProcess || usersToProcess.size === 0) {
                            if (categoryKey === "all")
                                response += `## ${config.title}\n:checkmark: No unauthorized users.\n\n`;
                            continue;
                        }

                        if (categoryKey === "all")
                            response += `## ${config.title}\n`;
                        totalUsers += usersToProcess.size;

                        for (const [
                            userId,
                            { member, roles },
                        ] of usersToProcess.entries()) {
                            response += `<@${userId}>:\n`;
                            for (const role of roles) {
                                try {
                                    await member.roles.remove(
                                        role,
                                        config.unauthorizedReason,
                                    );
                                    response += `- :checkmark: Removed <@&${role.id}>\n`;
                                    totalRemoved++;
                                } catch (err) {
                                    response += `- :warning: Failed <@&${role.id}>: ${err.message}\n`;
                                    totalFailed++;
                                }
                            }
                        }
                        response += "\n";
                    }

                    response += `## Summary\n- Users processed: ${totalUsers}\n- Roles removed: ${totalRemoved}\n- Failed: ${totalFailed}`;

                    // Disable the button on the original list message
                    try {
                        const disabledRow = ActionRowBuilder.from(
                            interaction.message.components[0],
                        );
                        disabledRow.components[0]
                            .setDisabled(true)
                            .setLabel("Revoke Executed")
                            .setStyle(ButtonStyle.Secondary);
                        await interaction.message.edit({
                            components: [disabledRow],
                        });
                    } catch (_) {}

                    return interaction.editReply({
                        content:
                            response.length > 2000
                                ? response.substring(0, 1997) + "..."
                                : response,
                        allowedMentions: { parse: [] },
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

                // --- F. Revive Role Toggle ---

                if (customId === "toggle_revive_role") {
                    const roleId = "1539115115280994304";
                    const member = interaction.member;
                    const hasRole = member.roles.cache.has(roleId);

                    if (hasRole) {
                        await member.roles.remove(roleId);
                        await interaction.reply({
                            content: `**Removed**: <@&${roleId}>\n-# You will not get pinged for chat revives`,
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        await member.roles.add(roleId);
                        await interaction.reply({
                            content: `**Added**: <@&${roleId}>\n-# You will get pinged for chat revives`,
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                    return;
                }
            }

            // 4. USER SELECT MENUS
            else if (interaction.isUserSelectMenu()) {
                if (interaction.customId === "ticket_channel_add_users") {
                    const { handleChannelAddUsers } = require("../utils/ticketHandler");
                    return handleChannelAddUsers(interaction);
                }
            }

            // 5. STRING SELECT MENUS
            else if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;
                const selectedValue = interaction.values[0];

                if (customId === "ticket_preview_remove_attachment") {
                    const { handleTicketPreviewRemoveAttachment } = require("../utils/ticketHandler");
                    return handleTicketPreviewRemoveAttachment(interaction);
                }

                if (customId.startsWith("edit_btn_select_")) {
                    const editBtnCommand = interaction.client.commands.get("Edit Button");
                    if (editBtnCommand && editBtnCommand.handleSelectMenu) {
                        return editBtnCommand.handleSelectMenu(interaction);
                    }
                }

                if (customId.startsWith("report_select_msg_")) {
                    const reportSlash = interaction.client.commands.get("report");
                    if (reportSlash && reportSlash.handleSelect) {
                        return reportSlash.handleSelect(interaction);
                    }
                }

                if (customId.startsWith("forum_tag_")) {
                    const messageCommand =
                        interaction.client.commands.get("message");
                    if (messageCommand && messageCommand.handleForumTagSelect) {
                        try {
                            await messageCommand.handleForumTagSelect(
                                interaction,
                            );
                        } catch (error) {
                            console.error(error);
                        }
                    }
                    return;
                }

                if (customId === "revoke_select_categories") {
                    const originalAuthorId =
                        interaction.message?.interactionMetadata?.user?.id;
                    if (originalAuthorId && interaction.user.id !== originalAuthorId) {
                        return interaction.reply({
                            content: STRINGS.errors.notAuthor,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    if (!interaction.member.permissions.has(0x10000000n)) {
                        return interaction.reply({
                            content: STRINGS.errors.manageRolesRequired,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await interaction.deferReply({
                        flags: MessageFlags.Ephemeral,
                    });
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

                        const usersToProcess = await scanCategoryForRevoke(
                            interaction.guild,
                            config,
                        );

                        if (!usersToProcess || usersToProcess.size === 0) {
                            response += `## ${config.title}\n:checkmark: No unauthorized users.\n`;
                            continue;
                        }

                        response += `## ${config.title}\n`;
                        totalUsers += usersToProcess.size;

                        for (const [
                            userId,
                            { member, roles },
                        ] of usersToProcess.entries()) {
                            response += `<@${userId}>:\n`;
                            for (const role of roles) {
                                try {
                                    await member.roles.remove(
                                        role,
                                        config.unauthorizedReason,
                                    );
                                    response += `- :checkmark: Removed <@&${role.id}>\n`;
                                    totalRemoved++;
                                } catch (err) {
                                    response += `- :warning: Failed <@&${role.id}>: ${err.message}\n`;
                                    totalFailed++;
                                }
                            }
                        }
                    }

                    response += `\n**Summary** — Users: ${totalUsers} | Removed: ${totalRemoved} | Failed: ${totalFailed}`;

                    // Disable the select menu on the original message
                    try {
                        const disabledMenu = StringSelectMenuBuilder.from(
                            interaction.message.components[0].components[0],
                        )
                            .setDisabled(true)
                            .setPlaceholder("Revoke executed");
                        await interaction.message.edit({
                            components: [
                                new ActionRowBuilder().addComponents(
                                    disabledMenu,
                                ),
                            ],
                        });
                    } catch (_) {}

                    return interaction.editReply({
                        content:
                            response.length > 2000
                                ? response.substring(0, 1997) + "..."
                                : response,
                        allowedMentions: { parse: [] },
                    });
                }

                if (customId.startsWith("select_")) {
                    await handleGradientSelection(
                        interaction,
                        customId,
                        selectedValue,
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
                        customId,
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
            notifyError(error, `Interaction Error: ${interaction.customId || interaction.commandName || "Unknown"}`);
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
            `You do not have permission to select roles from **${cat.label}**.`,
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
        rolesToRemoveIds.includes(r.id),
    );

    const removedRoles =
        currentCosmetics.size > 0
            ? currentCosmetics.map((r) => r.toString()).join(", ")
            : "";

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
            "1349062812722397305",
        );
        let content = "# RETIRED STAFF\n\n**Retired Staff**\n";
        if (retiredRole) {
            const retired = members.filter((m) =>
                m.roles.cache.has(retiredRole.id),
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
            interaction.customId,
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
            content += `**${title}** (${
                role ? role.toString() : "Role not found"
            })\n`;
            if (role) {
                const matched = members.filter((m) =>
                    m.roles.cache.has(role.id),
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
                .setStyle(ButtonStyle.Secondary),
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
                            (comp) => comp.custom_id === targetCustomId,
                        ),
                    );
                    const originalComp = originalItem?.components?.find(
                        (comp) => comp.custom_id === targetCustomId,
                    );
                    newMenu.setPlaceholder(
                        originalComp?.placeholder || "Select an option",
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
