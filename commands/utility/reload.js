const {
    SlashCommandBuilder,
    MessageFlags,
    PermissionFlagsBits,
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// --- ADDED: Owner ID for shutdown functionality ---
// PASTE YOUR DISCORD USER ID HERE TO USE THIS COMMAND
const OWNER_ID = "732177983741362256";

module.exports = {
    category: "utility",
    data: new SlashCommandBuilder()
        .setName("reload")
        .setDescription("reloads a command")
        .addStringOption((option) =>
            option
                .setName("command")
                .setDescription("The command to reload")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Restrict to administrators only
    async execute(interaction) {
        const commandName = interaction.options
            .getString("command", true)
            .toLowerCase();

        // --- ADDED: Shutdown logic ---
        if (commandName === "shutdown") {
            // Check if the user is the bot owner
            if (interaction.user.id !== OWNER_ID) {
                return interaction.reply({
                    content:
                        "The shutdown action is restricted to the bot owner.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            try {
                console.log(
                    `Shutdown command received from ${interaction.user.tag}.`
                );
                await interaction.reply({
                    content: "Bot is shutting down...",
                    flags: MessageFlags.Ephemeral,
                });
                // Exit the process
                process.exit(0);
            } catch (error) {
                console.error(
                    "An error occurred during the shutdown action:",
                    error
                );
                // This is a fallback in case the reply fails for some reason
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: "An error occurred while trying to shut down.",
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }
            return; // Stop execution here after handling shutdown
        }

        // --- Existing reload logic ---
        const command = interaction.client.commands.get(commandName);

        if (!command) {
            return interaction.reply({
                content: `There is no command with the name \`/${commandName}\`!`,
                flags: MessageFlags.Ephemeral,
            });
        }

        try {
            // Find the command file in the commands directory structure
            const foldersPath = path.join(__dirname, ".."); // Go up one level to commands folder
            const commandFolders = fs.readdirSync(foldersPath);

            let commandPath = null;
            folderLoop: for (const folder of commandFolders) {
                const folderPath = path.join(foldersPath, folder);
                // Make sure it's a directory, not a file
                if (fs.statSync(folderPath).isDirectory()) {
                    const commandFiles = fs
                        .readdirSync(folderPath)
                        .filter((file) => file.endsWith(".js"));
                    for (const file of commandFiles) {
                        const filePath = path.join(folderPath, file);
                        // Check if this is the command we're looking for
                        if (file === `${commandName}.js`) {
                            commandPath = filePath;
                            break folderLoop;
                        }
                    }
                }
            }

            if (!commandPath) {
                return interaction.reply({
                    content: `Could not find the file for command \`/${commandName}\`!`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Delete from cache
            delete require.cache[require.resolve(commandPath)];

            // Reload the command
            const newCommand = require(commandPath);
            interaction.client.commands.set(newCommand.data.name, newCommand);

            await interaction.reply({
                content: `Command \`/${newCommand.data.name}\` was successfully reloaded! 🔄`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `Error reloading \`/${commandName}\`\n\`${error.message}\``,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
