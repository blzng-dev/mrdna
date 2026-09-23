const {
    SlashCommandBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require("discord.js");

const BOOSTER_ROLE_ID = "855954434935619584";
// const BOOSTER_ROLE_ID = "1427145532874166272"; used for testing

const BOUNDARY_ONE_ID = "1424000379712045237";
const BOUNDARY_TWO_ID = "1424016949288898731";

const LOG_CHANNEL_ID = "1207983772398526504";

const STRINGS = {
    command: {
        name: "custom-role",
        description: "Booster command to create or edit a personal custom role.",
        options: {
            name: {
                name: "name",
                description: "The name for your custom role.",
            },
            primary: {
                name: "primary",
                description: "A primary color hex code for your role",
            },
            secondary: {
                name: "secondary",
                description: "A secondary color hex code for your role.",
            },
            emoji: {
                name: "emoji",
                description: "A server / global emoji to use as your role icon.",
            },
        },
    },
    modals: {
        createTitle: "Create Custom Role",
        roleNameLabel: "What should your role be named?",
    },
    errors: {
        boosterOnly: "This command is a special perk for server boosters. Please boost the server to use it!",
        genericError: (msg) => `An error occurred: ${msg}. If this persists, please contact an admin.`,
        invalidPrimaryHex: "The primary color you provided is not a valid hex code. Please use a format like `#FF5733` or `FF5733`.",
        invalidSecondaryHex: "The secondary color you provided is not a valid hex code. Please use a format like `#FF5733` or `FF5733`.",
        tierTooLowForIcons: "Your server must be Boost Level 2 to use role icons.",
        customEmojiNotFound: "Could not find that custom emoji in this server.",
        noEditFieldsProvided: "You must provide a new name, a new color, or a new emoji to edit your role.",
        iconFailed: "\n\n**Warning:** Failed to set role icon. The emoji provided appears to be invalid or unsupported.",
        iconRemoveFailed: "\n\n**Warning:** Failed to remove role icon.",
        gradientNotSupported: "\n\n**Warning:** Gradient could not be applied because the server does not have Enhanced Role Styles enabled yet.",
    },
    messages: {
        roleCreated: (roleId) => `Your new custom role <@&${roleId}> has been created and assigned to you!`,
        roleUpdated: (roleId) => `Your custom role <@&${roleId}> has been successfully updated!`,
        iconCustomSet: "\n\n**Role Icon:** Icon set to the selected custom emoji.",
        iconUnicodeSet: (emoji) => `\n\n**Role Icon:** Icon set to ${emoji}.`,
        iconCustomUpdated: "\n\n**Role Icon:** Icon updated to the selected custom emoji.",
        iconUnicodeUpdated: (emoji) => `\n\n**Role Icon:** Icon updated to ${emoji}.`,
        iconRemoved: "\n\n**Role Icon:** Icon removed.",
        gradientApplied: "\n\n**Gradient Applied:** Gradient colors applied successfully!",
        auditReasonCreated: (tag) => `Custom role created for booster ${tag}`,
        auditReasonUpdated: (tag) => `Custom role updated for booster ${tag}`,
        logMessage: (memberMention, action, roleMention, emojiString) =>
            `Booster ${memberMention} has ${action} custom role ${roleMention}${emojiString ? ` with emoji ${emojiString} as icon` : ""}`,
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.name.name)
                .setDescription(STRINGS.command.options.name.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.primary.name)
                .setDescription(STRINGS.command.options.primary.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.secondary.name)
                .setDescription(STRINGS.command.options.secondary.description)
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName(STRINGS.command.options.emoji.name)
                .setDescription(STRINGS.command.options.emoji.description)
                .setRequired(false),
        ),

    async execute(interaction) {
        try {
            const member = interaction.member;
            const { existingUserRole, upperPosition } =
                await findUserCustomRole(interaction);

            let isAllowed = member.roles.cache.has(BOOSTER_ROLE_ID);

            if (!isAllowed && existingUserRole) {
                // Check if any member with this custom role is a booster
                isAllowed = existingUserRole.members.some((m) =>
                    m.roles.cache.has(BOOSTER_ROLE_ID),
                );

                if (!isAllowed) {
                    // Fetch members to ensure offline boosters are checked
                    await interaction.guild.members.fetch();
                    isAllowed = existingUserRole.members.some((m) =>
                        m.roles.cache.has(BOOSTER_ROLE_ID),
                    );
                }
            }

            if (!isAllowed) {
                return interaction.reply({
                    content: STRINGS.errors.boosterOnly,
                    flags: MessageFlags.Ephemeral,
                });
            }

            let finalRoleName = interaction.options.getString(STRINGS.command.options.name.name);
            const rawPrimary = interaction.options.getString(STRINGS.command.options.primary.name);
            const rawSecondary = interaction.options.getString(STRINGS.command.options.secondary.name);
            const rawEmoji = interaction.options.getString(STRINGS.command.options.emoji.name);

            let replyInteraction = interaction;

            // Trigger modal if creating a new role without specifying a name
            if (!existingUserRole && !finalRoleName) {
                const modal = new ModalBuilder()
                    .setCustomId("customRoleNameModal")
                    .setTitle(STRINGS.modals.createTitle);

                const nameInput = new TextInputBuilder()
                    .setCustomId("roleNameInput")
                    .setLabel(STRINGS.modals.roleNameLabel)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(nameInput),
                );

                await interaction.showModal(modal);

                try {
                    const modalSubmit = await interaction.awaitModalSubmit({
                        filter: (i) =>
                            i.customId === "customRoleNameModal" &&
                            i.user.id === interaction.user.id,
                        time: 300000, // 5 minutes to submit
                    });

                    finalRoleName =
                        modalSubmit.fields.getTextInputValue("roleNameInput");
                    await modalSubmit.deferReply({
                        flags: MessageFlags.Ephemeral,
                    });
                    replyInteraction = modalSubmit;
                } catch (err) {
                    return; // Timeout or dismissed modal
                }
            } else {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }

            if (existingUserRole) {
                await handleEdit(
                    replyInteraction,
                    interaction.guild,
                    member,
                    existingUserRole,
                    finalRoleName,
                    rawPrimary,
                    rawSecondary,
                    rawEmoji,
                );
            } else {
                await handleCreate(
                    replyInteraction,
                    interaction.guild,
                    member,
                    upperPosition,
                    finalRoleName,
                    rawPrimary,
                    rawSecondary,
                    rawEmoji,
                );
            }
        } catch (error) {
            console.error("Error in custom-role command:", error);
            const errorMessage = STRINGS.errors.genericError(error.message);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({
                        content: errorMessage,
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await interaction.reply({
                        content: errorMessage,
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } catch (e) {}
        }
    },
};

async function handleCreate(
    replyInteraction,
    guild,
    member,
    upperPosition,
    roleName,
    rawPrimary,
    rawSecondary,
    rawEmoji,
) {
    let clearPrimary =
        rawPrimary &&
        ["none", "null", "false"].includes(rawPrimary.toLowerCase());
    let validPrimaryColor = clearPrimary ? null : validateColor(rawPrimary);

    let clearSecondary =
        rawSecondary &&
        ["none", "null", "false"].includes(rawSecondary.toLowerCase());
    let validSecondaryColor = clearSecondary
        ? null
        : validateColor(rawSecondary);

    let clearEmoji =
        rawEmoji && ["none", "null", "false"].includes(rawEmoji.toLowerCase());

    if (rawPrimary && !clearPrimary && validPrimaryColor === false) {
        return replyInteraction.followUp({
            content: STRINGS.errors.invalidPrimaryHex,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (rawSecondary && !clearSecondary && validSecondaryColor === false) {
        return replyInteraction.followUp({
            content: STRINGS.errors.invalidSecondaryHex,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (rawEmoji && !clearEmoji && guild.premiumTier < 2) {
        return replyInteraction.followUp({
            content: STRINGS.errors.tierTooLowForIcons,
            flags: MessageFlags.Ephemeral,
        });
    }

    let roleIconUrl = null;
    let unicodeEmoji = null;

    if (rawEmoji && !clearEmoji) {
        const customEmojiMatch = rawEmoji.match(/<a?:.+:(\d+)>/);
        if (customEmojiMatch) {
            const emojiId = customEmojiMatch[1];
            const emoji = guild.emojis.cache.get(emojiId);
            if (emoji) {
                roleIconUrl = emoji.imageURL({ extension: 'png' });
            } else {
                return replyInteraction.followUp({
                    content: STRINGS.errors.customEmojiNotFound,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } else {
            unicodeEmoji = rawEmoji;
        }
    }

    let newPrimary = validPrimaryColor
        ? parseInt(validPrimaryColor.replace(/^#/, ""), 16)
        : null;
    let newSecondary = validSecondaryColor
        ? parseInt(validSecondaryColor.replace(/^#/, ""), 16)
        : null;

    // Creation rule: If only secondary is provided, create a solid color role with that secondary color
    if (!newPrimary && newSecondary) {
        newPrimary = newSecondary;
        newSecondary = null;
    }

    const hasEnhancedStyles = guild.features.includes("ENHANCED_ROLE_COLORS");
    let roleOptions = {
        name: roleName,
        permissions: [],
        position: upperPosition - 1,
        reason: STRINGS.messages.auditReasonCreated(member.user.tag),
    };

    if (newPrimary && newSecondary) {
        if (hasEnhancedStyles) {
            roleOptions.colors = {
                primaryColor: newPrimary,
                secondaryColor: newSecondary,
            };
        } else {
            roleOptions.colors = { primaryColor: newPrimary };
        }
    } else if (newPrimary) {
        roleOptions.colors = { primaryColor: newPrimary };
    }

    const newRole = await guild.roles.create(roleOptions);
    await member.roles.add(newRole.id);

    let replyMsg = STRINGS.messages.roleCreated(newRole.id);

    let emojiStringForLog = null;

    if (roleIconUrl) {
        try {
            await newRole.setIcon(roleIconUrl);
            replyMsg += STRINGS.messages.iconCustomSet;
            emojiStringForLog = rawEmoji;
        } catch (error) {
            console.error("Failed to set role icon:", error);
            replyMsg += STRINGS.errors.iconFailed;
        }
    } else if (unicodeEmoji) {
        try {
            await newRole.setUnicodeEmoji(unicodeEmoji);
            replyMsg += STRINGS.messages.iconUnicodeSet(unicodeEmoji);
            emojiStringForLog = unicodeEmoji;
        } catch (error) {
            console.error("Failed to set unicode emoji:", error);
            replyMsg += STRINGS.errors.iconFailed;
        }
    }

    if (hasEnhancedStyles && newPrimary && newSecondary) {
        replyMsg += STRINGS.messages.gradientApplied;
    } else if (newSecondary && !hasEnhancedStyles) {
        replyMsg += STRINGS.errors.gradientNotSupported;
    }

    await replyInteraction.followUp({
        content: replyMsg,
        flags: MessageFlags.Ephemeral,
    });

    await sendLogMessage(guild, "created", newRole, member, emojiStringForLog);
}

async function handleEdit(
    replyInteraction,
    guild,
    member,
    existingUserRole,
    roleName,
    rawPrimary,
    rawSecondary,
    rawEmoji,
) {
    let clearPrimary =
        rawPrimary &&
        ["none", "null", "false"].includes(rawPrimary.toLowerCase());
    let validPrimaryColor = clearPrimary ? null : validateColor(rawPrimary);

    let clearSecondary =
        rawSecondary &&
        ["none", "null", "false"].includes(rawSecondary.toLowerCase());
    let validSecondaryColor = clearSecondary
        ? null
        : validateColor(rawSecondary);

    let clearEmoji =
        rawEmoji && ["none", "null", "false"].includes(rawEmoji.toLowerCase());

    if (rawPrimary && !clearPrimary && validPrimaryColor === false) {
        return replyInteraction.followUp({
            content: STRINGS.errors.invalidPrimaryHex,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (rawSecondary && !clearSecondary && validSecondaryColor === false) {
        return replyInteraction.followUp({
            content: STRINGS.errors.invalidSecondaryHex,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (rawEmoji && !clearEmoji && guild.premiumTier < 2) {
        return replyInteraction.followUp({
            content: STRINGS.errors.tierTooLowForIcons,
            flags: MessageFlags.Ephemeral,
        });
    }

    let roleIconUrl = null;
    let unicodeEmoji = null;

    if (rawEmoji && !clearEmoji) {
        const customEmojiMatch = rawEmoji.match(/<a?:.+:(\d+)>/);
        if (customEmojiMatch) {
            const emojiId = customEmojiMatch[1];
            const emoji = guild.emojis.cache.get(emojiId);
            if (emoji) {
                roleIconUrl = emoji.imageURL({ extension: 'png' });
            } else {
                return replyInteraction.followUp({
                    content: STRINGS.errors.customEmojiNotFound,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } else {
            unicodeEmoji = rawEmoji;
        }
    }

    if (!roleName && !rawPrimary && !rawSecondary && !rawEmoji) {
        return replyInteraction.followUp({
            content: STRINGS.errors.noEditFieldsProvided,
            flags: MessageFlags.Ephemeral,
        });
    }

    const hasEnhancedStyles = guild.features.includes("ENHANCED_ROLE_COLORS");
    let editOptions = {
        name: roleName || existingUserRole.name,
        reason: STRINGS.messages.auditReasonUpdated(member.user.tag),
    };

    const oldPrimary =
        existingUserRole.colors?.primaryColor ?? existingUserRole.color;
    const oldSecondary = existingUserRole.colors?.secondaryColor ?? null;

    let newPrimary = clearPrimary
        ? null
        : validPrimaryColor
          ? parseInt(validPrimaryColor.replace(/^#/, ""), 16)
          : oldPrimary;
    let newSecondary = clearSecondary
        ? null
        : validSecondaryColor
          ? parseInt(validSecondaryColor.replace(/^#/, ""), 16)
          : oldSecondary;

    if (newPrimary && newSecondary) {
        if (hasEnhancedStyles) {
            editOptions.colors = {
                primaryColor: newPrimary,
                secondaryColor: newSecondary,
            };
        } else {
            editOptions.colors = { primaryColor: newPrimary };
        }
    } else if (newPrimary) {
        editOptions.colors = { primaryColor: newPrimary };
    } else if (newSecondary) {
        // Triggers if primary was cleared but secondary was kept/provided
        editOptions.colors = { primaryColor: newSecondary };
    } else {
        editOptions.colors = { primaryColor: 0 };
    }

    const updatedRole = await existingUserRole.edit(editOptions);

    let replyMsg = STRINGS.messages.roleUpdated(updatedRole.id);

    let emojiStringForLog = null;

    if (clearEmoji) {
        try {
            await updatedRole.setIcon(null);
            await updatedRole.setUnicodeEmoji(null);
            replyMsg += STRINGS.messages.iconRemoved;
            emojiStringForLog = "removed";
        } catch (error) {
            console.error("Failed to remove role icon:", error);
            replyMsg += STRINGS.errors.iconRemoveFailed;
        }
    } else if (roleIconUrl) {
        try {
            await updatedRole.setIcon(roleIconUrl);
            replyMsg += STRINGS.messages.iconCustomUpdated;
            emojiStringForLog = rawEmoji;
        } catch (error) {
            console.error("Failed to set role icon:", error);
            replyMsg += STRINGS.errors.iconFailed;
        }
    } else if (unicodeEmoji) {
        try {
            await updatedRole.setUnicodeEmoji(unicodeEmoji);
            replyMsg += STRINGS.messages.iconUnicodeUpdated(unicodeEmoji);
            emojiStringForLog = unicodeEmoji;
        } catch (error) {
            console.error("Failed to set unicode emoji:", error);
            replyMsg += STRINGS.errors.iconFailed;
        }
    }

    if (hasEnhancedStyles && validSecondaryColor) {
        replyMsg += STRINGS.messages.gradientApplied;
    } else if (validSecondaryColor && !hasEnhancedStyles) {
        replyMsg += STRINGS.errors.gradientNotSupported;
    }

    await replyInteraction.followUp({
        content: replyMsg,
        flags: MessageFlags.Ephemeral,
    });

    await sendLogMessage(
        guild,
        "edited",
        updatedRole,
        member,
        emojiStringForLog,
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

async function sendLogMessage(guild, action, role, member, emojiString) {
    try {
        const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);
        if (!logChannel || !logChannel.isTextBased()) return;

        const logMessage = STRINGS.messages.logMessage(member.toString(), action, role.toString(), emojiString);
        await logChannel.send(logMessage);
    } catch (error) {
        console.error("Failed to send log message:", error);
    }
}
