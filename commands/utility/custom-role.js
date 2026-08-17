const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const BOOSTER_ROLE_ID = "855954434935619584";

const BOUNDARY_ONE_ID = "1424000379712045237";
const BOUNDARY_TWO_ID = "1424016949288898731";

const LOG_CHANNEL_ID = "1207983772398526504";

module.exports = {
    data: new SlashCommandBuilder()
        .setName("custom-role")
        .setDescription(
            "Booster commands to create or edit a personal custom role.",
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("create")
                .setDescription("Create a new custom role")
                .addStringOption((option) =>
                    option
                        .setName("name")
                        .setDescription("The name for your new custom role.")
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("primary_color")
                        .setDescription("A hex code for your role")
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName("emoji")
                        .setDescription(
                            "A server emoji to use as your role icon.",
                        )
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName("secondary_color")
                        .setDescription(
                            "A secondary hex code for a gradient role.",
                        )
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("edit")
                .setDescription("Edit your existing custom role")
                .addStringOption((option) =>
                    option
                        .setName("name")
                        .setDescription("The new name for your custom role.")
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName("primary_color")
                        .setDescription("The new hex code for your role.")
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName("emoji")
                        .setDescription(
                            "A server emoji to use as your role icon.",
                        )
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName("remove_icon")
                        .setDescription(
                            "Set to true to remove your role icon/emoji.",
                        )
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName("secondary_color")
                        .setDescription(
                            "A secondary hex code for a gradient role.",
                        )
                        .setRequired(false),
                ),
        ),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(BOOSTER_ROLE_ID)) {
            return interaction.reply({
                content:
                    "This command is a special perk for server boosters. Please boost the server to use it!",
                flags: MessageFlags.Ephemeral,
            });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const subcommand = interaction.options.getSubcommand();
            const member = interaction.member;

            // Find role boundaries and user's existing custom role
            const { existingUserRole, upperPosition } =
                await findUserCustomRole(interaction);

            if (subcommand === "create") {
                await handleCreate(
                    interaction,
                    member,
                    existingUserRole,
                    upperPosition,
                );
            } else if (subcommand === "edit") {
                await handleEdit(interaction, member, existingUserRole);
            }
        } catch (error) {
            console.error("Error in custom-role command:", error);
            const errorMessage = `An error occurred: ${error.message}. If this persists, please contact an admin.`;
            await interaction.followUp({
                content: errorMessage,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

async function handleCreate(
    interaction,
    member,
    existingUserRole,
    upperPosition,
) {
    if (existingUserRole) {
        return interaction.followUp({
            content: `You already have a custom role (<@&${existingUserRole.id}>). Use \`/custom-role edit\` to modify it.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    const roleName = interaction.options.getString("name");
    const roleColor = validateColor(
        interaction.options.getString("primary_color"),
    );
    const secondaryColor = validateColor(
        interaction.options.getString("secondary_color"),
    );
    const emojiString = interaction.options.getString("emoji");

    if (interaction.options.getString("primary_color") && roleColor === false) {
        return interaction.followUp({
            content:
                "The primary color you provided is not a valid hex code. Please use a format like `#FF5733` or `FF5733`.",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (
        interaction.options.getString("secondary_color") &&
        secondaryColor === false
    ) {
        return interaction.followUp({
            content:
                "The secondary color you provided is not a valid hex code. Please use a format like `#FF5733` or `FF5733`.",
            flags: MessageFlags.Ephemeral,
        });
    }

    let roleIconUrl = null;
    let unicodeEmoji = null;

    if (emojiString) {
        const customEmojiMatch = emojiString.match(/<a?:.+:(\d+)>/);
        if (customEmojiMatch) {
            const emojiId = customEmojiMatch[1];
            const emoji = interaction.guild.emojis.cache.get(emojiId);
            if (emoji) {
                roleIconUrl = emoji.imageURL();
            } else {
                return interaction.followUp({
                    content: "Could not find that custom emoji in this server.",
                    flags: MessageFlags.Ephemeral,
                });
            }
        } else {
            unicodeEmoji = emojiString;
        }
    }

    const hasEnhancedStyles =
        interaction.guild.premiumTier >= 2 ||
        interaction.guild.features.includes("ROLE_ICONS");
    let roleOptions = {
        name: roleName,
        permissions: [],
        position: upperPosition - 1,
        reason: `Custom role created for booster ${interaction.user.tag}`,
    };

    if (hasEnhancedStyles && roleColor && secondaryColor) {
        roleOptions.colors = {
            primaryColor: parseInt(roleColor.replace(/^#/, ""), 16),
            secondaryColor: parseInt(secondaryColor.replace(/^#/, ""), 16),
        };
    } else if (roleColor) {
        roleOptions.color = roleColor;
    }

    const newRole = await interaction.guild.roles.create(roleOptions);

    await member.roles.add(newRole.id);

    let replyMsg = `Your new custom role <@&${newRole.id}> has been created and assigned to you!`;

    if (roleIconUrl) {
        try {
            await newRole.setIcon(roleIconUrl);
            replyMsg +=
                "\n\n**Role Icon:** Icon set to the selected custom emoji.";
        } catch (error) {
            console.error("Failed to set role icon:", error);
            replyMsg +=
                "\n\n**Warning:** Failed to set role icon. This usually happens if the server is not boosted to Level 2.";
        }
    } else if (unicodeEmoji) {
        try {
            await newRole.setUnicodeEmoji(unicodeEmoji);
            replyMsg += `\n\n**Role Icon:** Icon set to ${unicodeEmoji}.`;
        } catch (error) {
            console.error("Failed to set unicode emoji:", error);
            replyMsg +=
                "\n\n**Warning:** Failed to set role icon. This usually happens if the server is not boosted to Level 2.";
        }
    }

    if (hasEnhancedStyles && roleColor && secondaryColor) {
        replyMsg += `\n\n**Gradient Applied:** Gradient colors applied successfully!`;
    } else if (secondaryColor && !hasEnhancedStyles) {
        replyMsg += `\n\n**Warning:** Gradient could not be applied because the server does not have Enhanced Role Styles enabled yet.`;
    }

    await interaction.followUp({
        content: replyMsg,
        flags: MessageFlags.Ephemeral,
    });

    await sendLogMessage(interaction, "created", newRole, member, emojiString);
}

async function handleEdit(interaction, member, existingUserRole) {
    if (!existingUserRole) {
        return interaction.followUp({
            content:
                "You do not have a custom role to edit. Use </custom-role create:1439114388492779624> to make one first.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const roleName = interaction.options.getString("name");

    const rawPrimaryColor = interaction.options.getString("primary_color");
    const validPrimaryColor = validateColor(rawPrimaryColor);

    const rawSecondaryColor = interaction.options.getString("secondary_color");
    const validSecondaryColor = validateColor(rawSecondaryColor);

    const emojiString = interaction.options.getString("emoji");
    const removeIcon = interaction.options.getBoolean("remove_icon");

    if (rawPrimaryColor && validPrimaryColor === false) {
        return interaction.followUp({
            content:
                "The primary color you provided is not a valid hex code. Please use a format like `#FF5733` or `FF5733`.",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (rawSecondaryColor && validSecondaryColor === false) {
        return interaction.followUp({
            content:
                "The secondary color you provided is not a valid hex code. Please use a format like `#FF5733` or `FF5733`.",
            flags: MessageFlags.Ephemeral,
        });
    }

    let roleIconUrl = null;
    let unicodeEmoji = null;

    if (emojiString) {
        const customEmojiMatch = emojiString.match(/<a?:.+:(\d+)>/);
        if (customEmojiMatch) {
            const emojiId = customEmojiMatch[1];
            const emoji = interaction.guild.emojis.cache.get(emojiId);
            if (emoji) {
                roleIconUrl = emoji.imageURL();
            } else {
                return interaction.followUp({
                    content: "Could not find that custom emoji in this server.",
                    flags: MessageFlags.Ephemeral,
                });
            }
        } else {
            unicodeEmoji = emojiString;
        }
    }

    if (
        !roleName &&
        !rawPrimaryColor &&
        !rawSecondaryColor &&
        !emojiString &&
        !removeIcon
    ) {
        return interaction.followUp({
            content:
                "You must provide a new name, a new color, a new emoji, or an icon removal to edit your role.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const hasEnhancedStyles =
        interaction.guild.premiumTier >= 2 ||
        interaction.guild.features.includes("ROLE_ICONS");
    let editOptions = {
        name: roleName || existingUserRole.name,
        reason: `Custom role updated for booster ${interaction.user.tag}`,
    };

    if (hasEnhancedStyles && (validPrimaryColor || validSecondaryColor)) {
        if (validPrimaryColor && validSecondaryColor) {
            editOptions.colors = {
                primaryColor: parseInt(validPrimaryColor.replace(/^#/, ""), 16),
                secondaryColor: parseInt(
                    validSecondaryColor.replace(/^#/, ""),
                    16,
                ),
            };
        } else if (validSecondaryColor) {
            editOptions.colors = {
                primaryColor: existingUserRole.color || 0,
                secondaryColor: parseInt(
                    validSecondaryColor.replace(/^#/, ""),
                    16,
                ),
            };
        } else if (validPrimaryColor) {
            editOptions.color = validPrimaryColor;
        }
    } else if (validPrimaryColor) {
        editOptions.color = validPrimaryColor;
    }

    const updatedRole = await existingUserRole.edit(editOptions);

    let replyMsg = `Your custom role <@&${updatedRole.id}> has been successfully updated!`;

    if (removeIcon) {
        try {
            await updatedRole.setIcon(null);
            await updatedRole.setUnicodeEmoji(null);
            replyMsg += "\n\n**Role Icon:** Icon removed.";
        } catch (error) {
            console.error("Failed to remove role icon:", error);
            replyMsg += "\n\n**Warning:** Failed to remove role icon.";
        }
    } else if (roleIconUrl) {
        try {
            await updatedRole.setIcon(roleIconUrl);
            replyMsg +=
                "\n\n**Role Icon:** Icon updated to the selected custom emoji.";
        } catch (error) {
            console.error("Failed to set role icon:", error);
            replyMsg +=
                "\n\n**Warning:** Failed to set role icon. This usually happens if the server is not boosted to Level 2.";
        }
    } else if (unicodeEmoji) {
        try {
            await updatedRole.setUnicodeEmoji(unicodeEmoji);
            replyMsg += `\n\n**Role Icon:** Icon updated to ${unicodeEmoji}.`;
        } catch (error) {
            console.error("Failed to set unicode emoji:", error);
            replyMsg +=
                "\n\n**Warning:** Failed to set role icon. This usually happens if the server is not boosted to Level 2.";
        }
    }

    if (hasEnhancedStyles && validSecondaryColor) {
        replyMsg += `\n\n**Gradient Applied:** Gradient colors applied successfully!`;
    } else if (validSecondaryColor && !hasEnhancedStyles) {
        replyMsg += `\n\n**Warning:** Gradient could not be applied because the server does not have Enhanced Role Styles enabled yet.`;
    }

    await interaction.followUp({
        content: replyMsg,
        flags: MessageFlags.Ephemeral,
    });

    await sendLogMessage(
        interaction,
        "edited",
        updatedRole,
        member,
        emojiString,
    );
}

async function findUserCustomRole(interaction) {
    const boundaryOneRole =
        await interaction.guild.roles.fetch(BOUNDARY_ONE_ID);
    const boundaryTwoRole =
        await interaction.guild.roles.fetch(BOUNDARY_TWO_ID);

    if (!boundaryOneRole || !boundaryTwoRole) {
        throw new Error("Custom role boundaries are not configured correctly.");
    }

    const lowerPosition = Math.min(
        boundaryOneRole.position,
        boundaryTwoRole.position,
    );
    const upperPosition = Math.max(
        boundaryOneRole.position,
        boundaryTwoRole.position,
    );

    const customRolesInCategory = interaction.guild.roles.cache.filter(
        (role) =>
            role.position > lowerPosition && role.position < upperPosition,
    );

    const existingUserRole =
        interaction.member.roles.cache.find((role) =>
            customRolesInCategory.has(role.id),
        ) || null;

    return { existingUserRole, upperPosition };
}

function validateColor(color) {
    if (!color) return null;
    if (!color.startsWith("#")) {
        color = `#${color}`;
    }
    const hexColorRegex = /^#([0-9A-F]{3}){1,2}$/i;
    return hexColorRegex.test(color) ? color : false;
}

async function sendLogMessage(interaction, action, role, member, emojiString) {
    try {
        const logChannel =
            await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
        if (!logChannel || !logChannel.isTextBased()) return;

        let logMessage = `Booster ${member.toString()} has ${action} custom role ${role.toString()}`;
        if (emojiString) {
            logMessage += ` with emoji ${emojiString} as icon`;
        }
        await logChannel.send(logMessage);
    } catch (error) {
        console.error("Failed to send log message:", error);
    }
}
