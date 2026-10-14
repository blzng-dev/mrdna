const { REST, Routes } = require("discord.js");
require("dotenv").config();

const STRINGS = {
    START_GLOBAL: "Started clearing all global application (/) commands.",
    SUCCESS_GLOBAL: "Successfully cleared all global application (/) commands.",
    START_GUILD: (guildId) => `Started clearing all guild application (/) commands for guild ${guildId}.`,
    SUCCESS_GUILD: (guildId) => `Successfully cleared all guild application (/) commands for guild ${guildId}.`,
    MISSING_CREDENTIALS: "Missing TOKEN or CLIENTID in environment variables.",
};

const token = process.env.TOKEN;
const clientId = process.env.CLIENTID;
const guildId = process.argv[2] || process.env.GUILD_ID;

if (!token || !clientId) {
    console.error(STRINGS.MISSING_CREDENTIALS);
    process.exit(1);
}

const rest = new REST().setToken(token);

(async () => {
    try {
        console.log(STRINGS.START_GLOBAL);
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log(STRINGS.SUCCESS_GLOBAL);

        if (guildId) {
            console.log(STRINGS.START_GUILD(guildId));
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
            console.log(STRINGS.SUCCESS_GUILD(guildId));
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
