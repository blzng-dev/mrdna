const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require("discord.js");

const ROLE_CATEGORIES = require("../../data/role-categories.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("gradient-roles")
        .setDescription("Pick your cosmetic roles"),

    async execute(interaction) {
        try {
            // 1. Defer Immediately (Fixes "Unknown Interaction" timeout)
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const { guild } = interaction;
            let components = [];

            await guild.roles.fetch();

            // 2. Build the menus
            for (const cat of ROLE_CATEGORIES.filter(cat => cat.showInPicker !== false)) {
                const minRole = guild.roles.cache.get(cat.minId);
                const maxRole = guild.roles.cache.get(cat.maxId);

                if (!minRole || !maxRole) continue;

                const rolesInCat = guild.roles.cache.filter(
                    (r) =>
                        r.position > Math.min(minRole.position, maxRole.position) &&
                        r.position < Math.max(minRole.position, maxRole.position) &&
                        r.name !== "@everyone"
                );

                if (rolesInCat.size > 0) {
                    const sortedRoles = rolesInCat.sort(
                        (a, b) => b.position - a.position
                    );

                    const menuOptions = sortedRoles
                        .map((r) => {
                            const option = {
                                label: r.name,
                                value: r.id,
                            };
                            // Check shared file for emoji mapping
                            if (cat.emojis && cat.emojis[r.id]) {
                                option.emoji = cat.emojis[r.id];
                            } else if (r.unicodeEmoji) {
                                option.emoji = r.unicodeEmoji;
                            }
                            return option;
                        })
                        .slice(0, 25);

                    const menu = new StringSelectMenuBuilder()
                        .setCustomId(`select_${cat.id}`)
                        .setPlaceholder(`Select: ${cat.label}`)
                        .addOptions(menuOptions);

                    components.push(new ActionRowBuilder().addComponents(menu));
                }
            }

            // 3. Add Unequip Button
            const unequipBtn = new ButtonBuilder()
                .setCustomId("unequip_all")
                .setLabel("Unequip All Cosmetics")
                .setStyle(ButtonStyle.Danger);

            components.push(new ActionRowBuilder().addComponents(unequipBtn));

            if (components.length === 0) {
                // Change reply to editReply
                return interaction.editReply({
                    content: "No cosmetic roles found in configuration.",
                });
            }

            // 4. Send Message (Change reply to editReply)
            await interaction.editReply({
                content: "Select a cosmetic role below:",
                components: components,
            });
        } catch (error) {
            console.error("Error in gradient-roles:", error);
            await interaction.editReply({
                content: "An error occurred while loading the roles. Please try again later.",
            });
        }
    },
};
