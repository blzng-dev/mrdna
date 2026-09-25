const {
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const crypto = require("crypto");
const db = require("../db");
const { parseDuration } = require("./durationParser");
const { STRINGS, buildGiveawayComponents } = require("./giveawayHelper");

const pendingDrafts = new Map();

function cleanExpiredDrafts() {
    const now = Date.now();
    for (const [id, draft] of pendingDrafts.entries()) {
        if (now - draft.createdAt > 10 * 60 * 1000) {
            pendingDrafts.delete(id);
        }
    }
}
setInterval(cleanExpiredDrafts, 60 * 1000);

async function handleGiveawayModal(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith("giveaway_create_modal_")) {
        const channelId = customId.replace("giveaway_create_modal_", "");
        const targetChannel = await interaction.client.channels
            .fetch(channelId)
            .catch(() => null);

        if (!targetChannel) {
            return interaction.reply({
                content: ":hazard: Target channel could not be found.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const prize = interaction.fields
            .getTextInputValue("giveaway_prize")
            .trim();
        const durationStr = interaction.fields
            .getTextInputValue("giveaway_duration")
            .trim();
        const winnersStr = interaction.fields
            .getTextInputValue("giveaway_winners")
            .trim();

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs < 5000) {
            return interaction.reply({
                content: STRINGS.INVALID_DURATION,
                flags: MessageFlags.Ephemeral,
            });
        }

        const winnerCount = parseInt(winnersStr, 10);
        if (isNaN(winnerCount) || winnerCount <= 0) {
            return interaction.reply({
                content: STRINGS.INVALID_WINNERS,
                flags: MessageFlags.Ephemeral,
            });
        }

        let hostId = null;
        try {
            const selectedUsers =
                interaction.fields.getSelectedUsers("giveaway_host");
            if (selectedUsers && selectedUsers.size > 0)
                hostId = selectedUsers.firstKey();
        } catch {}
        if (!hostId) {
            const field = interaction.fields?.fields?.get("giveaway_host");
            if (field?.values?.length > 0) hostId = field.values[0];
        }

        let roleIds = [];
        try {
            const selectedRoles =
                interaction.fields.getSelectedRoles("giveaway_roles");
            if (selectedRoles && selectedRoles.size > 0)
                roleIds = Array.from(selectedRoles.keys());
        } catch {}
        if (roleIds.length === 0) {
            const field = interaction.fields?.fields?.get("giveaway_roles");
            if (field?.values?.length > 0) roleIds = field.values;
        }

        // If 2 or more roles selected, prompt for ANY vs ALL match mode
        if (roleIds.length >= 2) {
            const draftId = crypto.randomUUID();
            pendingDrafts.set(draftId, {
                type: "create",
                channelId: targetChannel.id,
                guildId: interaction.guildId,
                prize,
                durationMs,
                winnerCount,
                hostId,
                roleIds,
                userId: interaction.user.id,
                createdAt: Date.now(),
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`giveaway_rolemode_any_${draftId}`)
                    .setLabel("Require ANY of these roles")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`giveaway_rolemode_all_${draftId}`)
                    .setLabel("Require ALL of these roles")
                    .setStyle(ButtonStyle.Secondary),
            );

            return interaction.reply({
                content: STRINGS.PROMPT_ROLE_MODE(roleIds),
                components: [row],
                flags: MessageFlags.Ephemeral,
            });
        }

        // Finalize creation immediately (0 or 1 role)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await finalizeCreateGiveaway(interaction, {
            channelId: targetChannel.id,
            guildId: interaction.guildId,
            prize,
            durationMs,
            winnerCount,
            hostId,
            roleIds,
            roleMode: "any",
        });
        return;
    }

    if (customId.startsWith("giveaway_edit_modal_")) {
        const giveawayId = customId.replace("giveaway_edit_modal_", "");

        const { rows } = await db.query(
            "SELECT * FROM utility.giveaways WHERE id = $1 AND guild_id = $2 AND status = 'active'",
            [giveawayId, interaction.guildId],
        );

        if (rows.length === 0) {
            return interaction.reply({
                content: STRINGS.NOT_ACTIVE,
                flags: MessageFlags.Ephemeral,
            });
        }

        const existing = rows[0];
        const prize = interaction.fields
            .getTextInputValue("giveaway_prize")
            .trim();
        const durationStr =
            interaction.fields.getTextInputValue("giveaway_duration")?.trim() ||
            "";
        const winnersStr = interaction.fields
            .getTextInputValue("giveaway_winners")
            .trim();

        const winnerCount = parseInt(winnersStr, 10);
        if (isNaN(winnerCount) || winnerCount <= 0) {
            return interaction.reply({
                content: STRINGS.INVALID_WINNERS,
                flags: MessageFlags.Ephemeral,
            });
        }

        let newEndsAt = existing.ends_at;
        if (durationStr.length > 0) {
            const durationMs = parseDuration(durationStr);
            if (!durationMs || durationMs < 5000) {
                return interaction.reply({
                    content: STRINGS.INVALID_DURATION,
                    flags: MessageFlags.Ephemeral,
                });
            }
            newEndsAt = new Date(Date.now() + durationMs);
        }

        let hostId = null;
        try {
            const selectedUsers =
                interaction.fields.getSelectedUsers("giveaway_host");
            if (selectedUsers && selectedUsers.size > 0)
                hostId = selectedUsers.firstKey();
        } catch {}
        if (!hostId) {
            const field = interaction.fields?.fields?.get("giveaway_host");
            if (field?.values?.length > 0) hostId = field.values[0];
        }

        let roleIds = [];
        try {
            const selectedRoles =
                interaction.fields.getSelectedRoles("giveaway_roles");
            if (selectedRoles && selectedRoles.size > 0)
                roleIds = Array.from(selectedRoles.keys());
        } catch {}
        if (roleIds.length === 0) {
            const field = interaction.fields?.fields?.get("giveaway_roles");
            if (field?.values?.length > 0) roleIds = field.values;
        }

        // If 2 or more roles selected, prompt for ANY vs ALL match mode
        if (roleIds.length >= 2) {
            const draftId = crypto.randomUUID();
            pendingDrafts.set(draftId, {
                type: "edit",
                giveawayId: existing.id,
                channelId: existing.channel_id,
                guildId: interaction.guildId,
                prize,
                endsAt: newEndsAt,
                winnerCount,
                hostId,
                roleIds,
                userId: interaction.user.id,
                createdAt: Date.now(),
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`giveaway_rolemode_any_${draftId}`)
                    .setLabel("Require ANY of these roles")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`giveaway_rolemode_all_${draftId}`)
                    .setLabel("Require ALL of these roles")
                    .setStyle(ButtonStyle.Secondary),
            );

            return interaction.reply({
                content: STRINGS.PROMPT_ROLE_MODE(roleIds),
                components: [row],
                flags: MessageFlags.Ephemeral,
            });
        }

        // Finalize edit immediately (0 or 1 role)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await finalizeEditGiveaway(interaction, {
            giveawayId: existing.id,
            channelId: existing.channel_id,
            prize,
            endsAt: newEndsAt,
            winnerCount,
            hostId,
            roleIds,
            roleMode: "any",
        });
        return;
    }
}

/**
 * Handles Button Clicks (Giveaway Entry & Multi-Role Match Prompt)
 */
async function handleGiveawayButton(interaction) {
    const customId = interaction.customId;

    // 1. Multi-role prompt button clicks
    if (
        customId.startsWith("giveaway_rolemode_any_") ||
        customId.startsWith("giveaway_rolemode_all_")
    ) {
        const isAny = customId.startsWith("giveaway_rolemode_any_");
        const draftId = isAny
            ? customId.replace("giveaway_rolemode_any_", "")
            : customId.replace("giveaway_rolemode_all_", "");

        const draft = pendingDrafts.get(draftId);
        if (!draft) {
            return interaction.reply({
                content:
                    ":warning: This prompt has expired. Please run the command again.",
                flags: MessageFlags.Ephemeral,
            });
        }

        if (draft.userId !== interaction.user.id) {
            return interaction.reply({
                content: ":x_: Only the command author can select this.",
                flags: MessageFlags.Ephemeral,
            });
        }

        pendingDrafts.delete(draftId);
        await interaction.deferUpdate();

        if (draft.type === "create") {
            await finalizeCreateGiveaway(interaction, {
                channelId: draft.channelId,
                guildId: draft.guildId,
                prize: draft.prize,
                durationMs: draft.durationMs,
                winnerCount: draft.winnerCount,
                hostId: draft.hostId,
                roleIds: draft.roleIds,
                roleMode: isAny ? "any" : "all",
            });
        } else if (draft.type === "edit") {
            await finalizeEditGiveaway(interaction, {
                giveawayId: draft.giveawayId,
                channelId: draft.channelId,
                prize: draft.prize,
                endsAt: draft.endsAt,
                winnerCount: draft.winnerCount,
                hostId: draft.hostId,
                roleIds: draft.roleIds,
                roleMode: isAny ? "any" : "all",
            });
        }
        return;
    }

    // 2. Giveaway Entry Toggle (custom_id: 'giveaway_enter' or 'giveaway_enter_<id>')
    if (
        customId === "giveaway_enter" ||
        customId.startsWith("giveaway_enter_")
    ) {
        const giveawayId = interaction.message.id;

        const { rows } = await db.query(
            "SELECT * FROM utility.giveaways WHERE id = $1",
            [giveawayId],
        );

        if (rows.length === 0 || rows[0].status !== "active") {
            return interaction.reply({
                content: STRINGS.NOT_ACTIVE,
                flags: MessageFlags.Ephemeral,
            });
        }

        const giveaway = rows[0];

        // Role requirement check
        const requiredRoles = giveaway.required_role_ids || [];
        if (requiredRoles.length > 0) {
            const mode = giveaway.role_requirement_mode || "any";
            const hasRole = (roleId) =>
                interaction.member.roles.cache.has(roleId);

            let isEligible = false;
            if (mode === "all") {
                isEligible = requiredRoles.every(hasRole);
            } else {
                isEligible = requiredRoles.some(hasRole);
            }

            if (!isEligible) {
                const errorMsg =
                    mode === "all"
                        ? STRINGS.ROLE_REQUIRED_ALL(requiredRoles)
                        : STRINGS.ROLE_REQUIRED_ANY(requiredRoles);
                return interaction.reply({
                    content: errorMsg,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }

        // Toggle participation: Check if already entered
        const currentEntries = giveaway.entries || [];
        const isEntered = currentEntries.includes(interaction.user.id);

        if (isEntered) {
            await db.query(
                "UPDATE utility.giveaways SET entries = array_remove(entries, $1) WHERE id = $2",
                [interaction.user.id, giveaway.id],
            );
            return interaction.reply({
                content: STRINGS.LEAVE_SUCCESS,
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await db.query(
                "UPDATE utility.giveaways SET entries = array_append(entries, $1) WHERE id = $2 AND NOT ($1 = ANY(entries))",
                [interaction.user.id, giveaway.id],
            );
            return interaction.reply({
                content: STRINGS.ENTER_SUCCESS,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}

/**
 * Creates and posts the giveaway message, then saves row to PostgreSQL
 */
async function finalizeCreateGiveaway(interaction, data) {
    try {
        const channel = await interaction.client.channels
            .fetch(data.channelId)
            .catch(() => null);
        if (!channel) {
            const replyFn = interaction.deferred
                ? interaction.editReply.bind(interaction)
                : interaction.reply.bind(interaction);
            return replyFn({
                content: ":warning: Could not find target channel.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const endsAt = new Date(Date.now() + data.durationMs);

        const draftGiveaway = {
            id: "temp",
            prize: data.prize,
            ends_at: endsAt,
            winner_count: data.winnerCount,
            host_id: data.hostId,
            required_role_ids: data.roleIds,
            role_requirement_mode: data.roleMode,
        };

        const components = buildGiveawayComponents(draftGiveaway, false);
        const sentMessage = await channel.send({
            components,
            flags: MessageFlags.IsComponentsV2 || 1 << 15,
            allowedMentions: { parse: [] },
        });

        // Insert into DB using actual Discord message ID
        await db.query(
            `INSERT INTO utility.giveaways (
                id, guild_id, channel_id, host_id, prize, winner_count,
                ends_at, required_role_ids, role_requirement_mode, status, entries, winners
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', '{}', '{}')`,
            [
                sentMessage.id,
                data.guildId,
                data.channelId,
                data.hostId,
                data.prize,
                data.winnerCount,
                endsAt,
                data.roleIds,
                data.roleMode,
            ],
        );

        const replyFn = interaction.deferred
            ? interaction.editReply.bind(interaction)
            : interaction.reply.bind(interaction);
        return replyFn({
            content: `:sound: Giveaway for **${data.prize}** created in <#${data.channelId}>! [Jump to Message](${sentMessage.url})`,
            components: [],
        });
    } catch (err) {
        console.error("[Giveaway Create] Error:", err);
        const replyFn = interaction.deferred
            ? interaction.editReply.bind(interaction)
            : interaction.reply.bind(interaction);
        return replyFn({
            content: ":x_: Failed to create giveaway.",
            components: [],
        });
    }
}

/**
 * Updates giveaway message and database row
 */
async function finalizeEditGiveaway(interaction, data) {
    try {
        const { rows } = await db.query(
            `UPDATE utility.giveaways
             SET prize = $1, ends_at = $2, winner_count = $3, host_id = $4, required_role_ids = $5, role_requirement_mode = $6
             WHERE id = $7 RETURNING *`,
            [
                data.prize,
                data.endsAt,
                data.winnerCount,
                data.hostId,
                data.roleIds,
                data.roleMode,
                data.giveawayId,
            ],
        );

        if (rows.length === 0) {
            const replyFn = interaction.deferred
                ? interaction.editReply.bind(interaction)
                : interaction.reply.bind(interaction);
            return replyFn({ content: STRINGS.NOT_ACTIVE, components: [] });
        }

        const updated = rows[0];
        const channel = await interaction.client.channels
            .fetch(updated.channel_id)
            .catch(() => null);
        if (channel) {
            const message = await channel.messages
                .fetch(updated.id)
                .catch(() => null);
            if (message) {
                const components = buildGiveawayComponents(updated, false);
                await message
                    .edit({
                        components,
                        flags: MessageFlags.IsComponentsV2 || 1 << 15,
                        allowedMentions: { parse: [] },
                    })
                    .catch(console.error);
            }
        }

        const replyFn = interaction.deferred
            ? interaction.editReply.bind(interaction)
            : interaction.reply.bind(interaction);
        return replyFn({
            content: `:checkmark: Giveaway **${updated.prize}** updated successfully!`,
            components: [],
        });
    } catch (err) {
        console.error("[Giveaway Edit] Error:", err);
        const replyFn = interaction.deferred
            ? interaction.editReply.bind(interaction)
            : interaction.reply.bind(interaction);
        return replyFn({
            content: ":x_: Failed to update giveaway.",
            components: [],
        });
    }
}

module.exports = {
    handleGiveawayModal,
    handleGiveawayButton,
};
