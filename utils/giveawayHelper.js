const {
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MessageFlags,
} = require("discord.js");
const db = require("../db");

const STRINGS = {
    BUTTON_ENTER: "Enter",
    BUTTON_ENDED: "Ended",

    ENTER_SUCCESS: ":checkmark: You have entered the giveaway!",
    LEAVE_SUCCESS: ":x_: You have left the giveaway.",

    ROLE_REQUIRED_ANY: (roles) =>
        `:hazard: You need **at least one** of the following roles to enter: ${roles.map((r) => `<@&${r}>`).join(", ")}`,
    ROLE_REQUIRED_ALL: (roles) =>
        `:hazard: You need **all** of the following roles to enter: ${roles.map((r) => `<@&${r}>`).join(", ")}`,

    INVALID_DURATION:
        ":hazard: Invalid duration format! Examples: `10m`, `2h`, `1d`, `1w`.",
    INVALID_WINNERS:
        ":hazard: Winner count must be a positive number (minimum 1).",

    NO_ENTRIES: (prize) =>
        `Giveaway for **${prize}** ended, but there were no valid entries!`,

    WINNER_ANNOUNCE: (winners, prize, host) => {
        let text = `:sound: Congratulations ${winners}! You won **${prize}**!`;
        if (host) {
            text += `\n-# Please enable DMs from the server so that <@${host}> can send you **${prize}**.`;
        } else {
            text += `\n-# Please enable DMs from the server so that you can receive your **${prize}**.`;
        }
        return text;
    },

    WINNER_REROLL: (winners, prize, host) => {
        let text = `:sync: **Reroll:** Congratulations ${winners}! You are the new winner(s) of **${prize}**!`;
        if (host) {
            text += `\n-# Please enable DMs from the server so that <@${host}> can send you **${prize}**.`;
        } else {
            text += `\n-# Please enable DMs from the server so that you can receive your **${prize}**.`;
        }
        return text;
    },

    CANCELLED: ":x_: This giveaway has been cancelled.",
    NOT_ACTIVE: ":hazard: That giveaway is no longer active.",
    NOT_FOUND: ":hazard: Giveaway not found in the database.",

    PROMPT_ROLE_MODE: (roles) =>
        `You selected multiple required roles (${roles.map((r) => `<@&${r}>`).join(", ")}).\nPlease choose the matching requirement:`,
};

/**
 * Builds the 5-row Discord Modal for creating or editing a giveaway.
 */
function createGiveawayModal({
    isEdit = false,
    channelId = null,
    giveaway = null,
}) {
    const modalCustomId = isEdit
        ? `giveaway_edit_modal_${giveaway.id}`
        : `giveaway_create_modal_${channelId}`;

    const modal = new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle(isEdit ? "Edit Giveaway" : "Create Giveaway");

    // Row 1: Prize (TextInput, Short)
    const prizeInput = new TextInputBuilder()
        .setCustomId("giveaway_prize")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g. Discord Nitro, Dino Egg Pack");
    if (isEdit && giveaway.prize) {
        prizeInput.setValue(giveaway.prize);
    }
    const prizeLabel = new LabelBuilder()
        .setLabel("Prize")
        .setTextInputComponent(prizeInput);

    // Row 2: Duration (TextInput, Short)
    const durationInput = new TextInputBuilder()
        .setCustomId("giveaway_duration")
        .setStyle(TextInputStyle.Short)
        .setRequired(!isEdit)
        .setPlaceholder(
            isEdit
                ? "e.g. 2d to reset timer, or blank to keep"
                : "e.g. 10m, 2h, 1d",
        );
    const durationLabel = new LabelBuilder()
        .setLabel(
            isEdit
                ? "Duration (leave blank to keep current)"
                : "Duration (e.g. 10m, 2h, 1d)",
        )
        .setTextInputComponent(durationInput);

    // Row 3: Winner Count (TextInput, Short)
    const winnersInput = new TextInputBuilder()
        .setCustomId("giveaway_winners")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(isEdit ? String(giveaway.winner_count) : "1")
        .setPlaceholder("1");
    const winnersLabel = new LabelBuilder()
        .setLabel("Number of Winners")
        .setTextInputComponent(winnersInput);

    // Row 4: Host (UserSelectMenu)
    const hostSelect = new UserSelectMenuBuilder()
        .setCustomId("giveaway_host")
        .setPlaceholder("Select host (optional)")
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1);
    if (isEdit && giveaway.host_id) {
        hostSelect.setDefaultUsers(giveaway.host_id);
    }
    const hostLabel = new LabelBuilder()
        .setLabel("Host")
        .setUserSelectMenuComponent(hostSelect);

    // Row 5: Required Roles (RoleSelectMenu)
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId("giveaway_roles")
        .setPlaceholder("Select required roles (optional)")
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(5);
    if (
        isEdit &&
        giveaway.required_role_ids &&
        giveaway.required_role_ids.length > 0
    ) {
        roleSelect.setDefaultRoles(...giveaway.required_role_ids);
    }
    const roleLabel = new LabelBuilder()
        .setLabel("Required Roles")
        .setRoleSelectMenuComponent(roleSelect);

    modal.addComponents(
        prizeLabel,
        durationLabel,
        winnersLabel,
        hostLabel,
        roleLabel,
    );

    return modal;
}

/**
 * Builds the Discord Components V2 Container message components.
 */
function buildGiveawayComponents(giveaway, isEnded = false, winners = null) {
    const endUnix = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);

    const lines = [`- Prize - ${giveaway.prize}`];

    if (isEnded) {
        const winnerList =
            winners && winners.length > 0
                ? winners.map((id) => `<@${id}>`).join(", ")
                : giveaway.winners && giveaway.winners.length > 0
                  ? giveaway.winners.map((id) => `<@${id}>`).join(", ")
                  : "None";
        lines.push(`- Winners - ${winnerList}`);
    } else {
        lines.push(`- Winners - ${giveaway.winner_count}`);
    }

    if (giveaway.host_id) {
        lines.push(`- Host - <@${giveaway.host_id}>`);
    }

    if (giveaway.required_role_ids && giveaway.required_role_ids.length > 0) {
        const roleMentions = giveaway.required_role_ids
            .map((id) => `<@&${id}>`)
            .join(", ");
        lines.push(`- Required Role - ${roleMentions}`);
    }

    const timestampPrefix = isEnded ? "ended" : "ends";
    lines.push(`-# ${timestampPrefix} <t:${endUnix}:R>, <t:${endUnix}:F>`);

    const textContent = lines.join("\n");

    return [
        {
            type: 17, // Container
            components: [
                {
                    type: 9, // Section
                    components: [
                        {
                            type: 10, // Text Display
                            content: "# Giveaway",
                        },
                    ],
                    accessory: {
                        type: 2, // Button
                        style: 1, // Primary (Blurple)
                        label: isEnded
                            ? STRINGS.BUTTON_ENDED
                            : STRINGS.BUTTON_ENTER,
                        custom_id: `giveaway_enter_${giveaway.id}`,
                        disabled: Boolean(isEnded),
                    },
                },
                {
                    type: 14, // Separator
                    divider: true,
                    spacing: 2,
                },
                {
                    type: 10, // Text Display
                    content: textContent,
                },
            ],
        },
    ];
}

/**
 * Ends a giveaway: draws winners, edits message, sends announcement, and updates DB.
 */
async function endGiveaway(client, giveaway) {
    try {
        // Atomically transition from 'active' to 'ended' to prevent double drawing
        const updateRes = await db.query(
            "UPDATE utility.giveaways SET status = 'ended' WHERE id = $1 AND status = 'active' RETURNING *",
            [giveaway.id],
        );
        if (updateRes.rowCount === 0) return; // Already ended or cancelled

        const current = updateRes.rows[0];
        const entries = current.entries || [];
        const winners = [];

        if (entries.length > 0) {
            const pool = [...entries];
            const toPick = Math.min(current.winner_count, pool.length);
            for (let i = 0; i < toPick; i++) {
                const idx = Math.floor(Math.random() * pool.length);
                winners.push(pool.splice(idx, 1)[0]);
            }
        }

        // Save chosen winners to DB
        await db.query("UPDATE utility.giveaways SET winners = $1 WHERE id = $2", [
            winners,
            current.id,
        ]);
        current.winners = winners;

        // Fetch channel and message
        const channel = await client.channels
            .fetch(current.channel_id)
            .catch(() => null);
        if (!channel) return;

        const message = await channel.messages
            .fetch(current.id)
            .catch(() => null);

        // Edit original message components
        if (message) {
            const updatedComponents = buildGiveawayComponents(
                current,
                true,
                winners,
            );
            await message
                .edit({
                    components: updatedComponents,
                    flags: MessageFlags.IsComponentsV2 || 1 << 15,
                    allowedMentions: { parse: [] },
                })
                .catch(console.error);
        }

        // Send winner announcement as reply to giveaway message
        if (winners.length > 0) {
            const winnerTags = winners.map((id) => `<@${id}>`).join(", ");
            const announcement = {
                content: STRINGS.WINNER_ANNOUNCE(
                    winnerTags,
                    current.prize,
                    current.host_id,
                ),
                allowedMentions: { users: winners, roles: [] },
            };
            if (message) {
                await message.reply(announcement).catch(console.error);
            } else {
                await channel.send(announcement).catch(console.error);
            }
        } else {
            const announcement = {
                content: STRINGS.NO_ENTRIES(current.prize),
                allowedMentions: { parse: [] },
            };
            if (message) {
                await message.reply(announcement).catch(console.error);
            } else {
                await channel.send(announcement).catch(console.error);
            }
        }
    } catch (err) {
        console.error(`[Giveaway] Error ending giveaway ${giveaway.id}:`, err);
    }
}

/**
 * Rerolls winners for an ended giveaway.
 */
async function rerollGiveaway(client, giveaway, count = null) {
    const entries = giveaway.entries || [];
    if (entries.length === 0) {
        return { error: STRINGS.NO_ENTRIES(giveaway.prize) };
    }

    const pool = [...entries];
    const winners = [];
    const winnerCount = count || giveaway.winner_count || 1;
    const toPick = Math.min(winnerCount, pool.length);

    for (let i = 0; i < toPick; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        winners.push(pool.splice(idx, 1)[0]);
    }

    await db.query("UPDATE utility.giveaways SET winners = $1 WHERE id = $2", [
        winners,
        giveaway.id,
    ]);
    giveaway.winners = winners;

    const channel = await client.channels
        .fetch(giveaway.channel_id)
        .catch(() => null);
    if (channel) {
        const message = await channel.messages
            .fetch(giveaway.id)
            .catch(() => null);
        if (message) {
            const updatedComponents = buildGiveawayComponents(
                giveaway,
                true,
                winners,
            );
            await message
                .edit({
                    components: updatedComponents,
                    flags: MessageFlags.IsComponentsV2 || 1 << 15,
                    allowedMentions: { parse: [] },
                })
                .catch(console.error);
        }

        const winnerTags = winners.map((id) => `<@${id}>`).join(", ");
        const rerollAnnouncement = {
            content: STRINGS.WINNER_REROLL(
                winnerTags,
                giveaway.prize,
                giveaway.host_id,
            ),
            allowedMentions: { users: winners, roles: [] },
        };
        if (message) {
            await message.reply(rerollAnnouncement).catch(console.error);
        } else {
            await channel.send(rerollAnnouncement).catch(console.error);
        }
    }

    return { winners };
}

module.exports = {
    STRINGS,
    createGiveawayModal,
    buildGiveawayComponents,
    endGiveaway,
    rerollGiveaway,
};
