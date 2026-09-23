const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    AttachmentBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
    ComponentType,
} = require("discord.js");
const db = require("../../db.js");
const https = require("https");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const STAFF_ROLE_ID = "857990235194261514";
const LOG_CHANNEL_ID = "1461971930880938129";
const QUOTES_TABLE = "fun.quotes";
const PROPERTIES_TABLE = "wordle.properties";
const MULTI_SELECT_OPTION = "➕ Select Multiple...";

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const STRINGS = {
    command: {
        name: "manage",
        description: "Manage Quotes and Wordle Databases",
        subcommands: {
            quotesAdd: {
                name: "quotes-add",
                description: "Add a quote",
                options: {
                    link: { name: "link", description: "Message link" },
                    reply: { name: "reply", description: "Include reply?" },
                },
            },
            quotesEdit: {
                name: "quotes-edit",
                description: "Edit quote reply status",
                options: {
                    link: { name: "link", description: "Message link" },
                    showReply: {
                        name: "show_reply",
                        description: "Show reply context?",
                    },
                },
            },
            quotesRemove: {
                name: "quotes-remove",
                description: "Remove a quote",
                options: {
                    link: { name: "link", description: "Message link" },
                },
            },
            quotesExport: {
                name: "quotes-export",
                description: "Export quotes JSON",
            },
            wordleBulkAdd: {
                name: "wordle-bulk-add",
                description: "Paste a list of words. AI will fill details.",
                options: {
                    database: {
                        name: "database",
                        description: "Target Database",
                    },
                },
            },
            wordleAdd: {
                name: "wordle-add",
                description: "Add a single word (AI Autofill)",
                options: {
                    database: {
                        name: "database",
                        description: "Target Database",
                    },
                    word: { name: "word", description: "The word" },
                },
            },
            wordleEdit: {
                name: "wordle-edit",
                description: "Edit a word entry",
                options: {
                    database: {
                        name: "database",
                        description: "Target Database",
                    },
                    targetWord: {
                        name: "target_word",
                        description: "Word to find",
                    },
                    newWord: { name: "new_word", description: "New spelling" },
                    editProperties: {
                        name: "edit_properties",
                        description: "Open JSON editor modal?",
                    },
                },
            },
            wordleRemove: {
                name: "wordle-remove",
                description: "Remove a word",
                options: {
                    database: {
                        name: "database",
                        description: "Target Database",
                    },
                    targetWord: {
                        name: "target_word",
                        description: "Word to remove",
                    },
                },
            },
            wordleExport: {
                name: "wordle-export",
                description: "Export database",
                options: {
                    database: { name: "database", description: "Target DB" },
                },
            },
            wordleImport: {
                name: "wordle-import",
                description: "Import JSON file (Upsert)",
                options: {
                    database: { name: "database", description: "Target DB" },
                    file: { name: "file", description: "The JSON file" },
                },
            },
            wordlePropertiesFill: {
                name: "wordle-properties-fill",
                description:
                    "Auto-fill properties for words that have none (via AI)",
                options: {
                    database: { name: "database", description: "Target DB" },
                },
            },
            wordlePropertyAdd: {
                name: "wordle-property-add",
                description: "Add a known property value",
                options: {
                    database: {
                        name: "database",
                        description: "Target Database",
                    },
                    property: {
                        name: "property",
                        description: "Value (e.g. 'Theropod')",
                    },
                    type: {
                        name: "type",
                        description: "Type (e.g. 'type', 'diet')",
                    },
                },
            },
            wordlePropertyRemove: {
                name: "wordle-property-remove",
                description: "Remove a known property",
                options: {
                    database: {
                        name: "database",
                        description: "Target Database",
                    },
                    property: { name: "property", description: "Value" },
                },
            },
        },
    },
    emojis: {
        CHECKMARK: ":checkmark:",
        CROSS: ":x_:",
        HAZARD: ":hazard:",
        CATEGORY_ADD: ":categoryadd:",
        CATEGORY: ":category:",
        AI: "🤖",
    },
    modals: {
        bulkAddTitle: (dbChoice) => `Bulk Add (${dbChoice})`,
        bulkAddLabel: "Paste words (AI will fill details)",
        bulkRemoveTitle: (dbChoice) => `Bulk Remove (${dbChoice})`,
        bulkRemoveLabel: "Paste words to remove",
        editPropsTitle: (target) => `Edit Properties: ${target}`,
        editPropsLabel: "JSON Properties",
    },
    errors: {
        permissionDenied: ":x_: Permission Denied.",
        wordAlreadyExists: (word) => `:hazard: **${word}** already exists.`,
        wordNotFound: (target) => `:x_: Word **${target}** not found.`,
        invalidJson: ":x_: Invalid JSON format. Update cancelled.",
        editSpecifyRequired:
            ":info: Please specify a new word OR set `edit_properties` to True.",
        propertyAddError: ":x_: Error (likely duplicate).",
        notJsonFile: "Not a JSON file.",
        jsonMustBeArray: "JSON must be array.",
        importFailed: "Import failed.",
        invalidDiscordLink: ":x_: Invalid Discord Message Link.",
        quoteAlreadyExists: ":warning: Quote already exists.",
        cannotAccessChannel: ":x_: Cannot access channel.",
        cannotFindMessage: ":x_: Cannot find message.",
        quoteNotFound: ":warning: Quote not found.",
        quoteNotFoundErr: ":x_: Quote not found.",
        messageHasNoReply: ":x_: This message has no reply.",
        bulkAddNoWords: ":x_: No valid words found.",
        bulkAddDbError: ":hazard: Database error checking existing words.",
    },
    messages: {
        generatingProps: (word) =>
            `🤖 Generating properties for **${word}**...`,
        wordAdded: (word, dbChoice, propsJson) =>
            `:checkmark: Added **${word}** to ${dbChoice}.\n🤖 Properties:\n\`\`\`json\n${propsJson}\n\`\`\``,
        updatedWordProps: (word) =>
            `:checkmark: Updated **${word}** properties.`,
        renamedWord: (oldWord, newWord) =>
            `:checkmark: Renamed **${oldWord}** to **${newWord}**.`,
        wordRemoved: (target) => `:checkmark: Removed **${target}**.`,
        propertyAdded: (prop, type) =>
            `:checkmark: Added property **${prop}** (${type}).`,
        propertyRemoved: (prop) => `:checkmark: Removed property **${prop}**.`,
        exportHeader: (dbChoice) => `**${dbChoice}** Export:`,
        importedItems: (count) => `:checkmark: Imported ${count} items.`,
        noEmptyPropertyWords: (dbChoice) =>
            `:checkmark: No empty property words found in **${dbChoice}**.`,
        batchProcessStart: (count, batches) =>
            `🤖 Found ${count} words to fill. Processing in ${batches} batches...`,
        batchProcessProgress: (current, total, count) =>
            `🤖 Filled batch ${current}/${total}... (Total: ${count})`,
        autoFillDone: (count) =>
            `:checkmark: Done! Auto-filled properties for **${count}** words.`,
        quotesBackup: ":category: Quotes Backup:",
        quoteAdded: (content) => `:checkmark: Quote added!\n> ${content}`,
        quoteDeleted: ":checkmark: Quote removed.",
        quoteUpdated: ":checkmark: Quote updated.",
        bulkAddAllExist: (count) =>
            `:checkmark: All **${count}** words already exist in the database! No action needed.`,
        bulkAddProcessing: (newCount, skippedCount, batches) =>
            `🤖 Found **${newCount}** new words (Skipped ${skippedCount} existing). Processing in ${batches} batches...`,
        bulkAddBatchProgress: (current, total, addedCount) =>
            `🤖 Processed batch ${current}/${total}... (Added so far: ${addedCount})`,
        bulkAddDone: (addedCount, skippedCount, errorCount) =>
            `:checkmark: Done. Added: **${addedCount}**. Skipped (Existing): **${skippedCount}**. Errors: ${errorCount}\n\n:hazard: **Disclaimer:** Properties are AI-generated & may not be 100% accurate especially for recent movies/shows (Rebirth and Chaos Theory). Please review important entries manually from the json in <#1461971930880938129>.`,
        bulkRemoveDone: (count) => `:checkmark: Removed ${count} words.`,
        logQuotesAdded: "Quote added",
        logQuotesDeleted: "Quote deleted",
        logQuotesEdited: "Quote edited",
        logWordleAdded: (dbChoice) => `Wordle entry added (${dbChoice})`,
        logWordleRemoved: (target) => `Removed ${target}`,
        logBulkAdd: (dbChoice) => `Bulk Add (${dbChoice})`,
        logBulkAddFile: "Bulk Add Log",
    },
};

const EMOJIS = STRINGS.emojis;

function getTable(choice) {
    return choice === "paleo" ? "wordle.paleo" : "wordle.jurassic";
}

function normalizeLink(link) {
    return link.replace(
        /https?:\/\/(canary\.|ptb\.)?discord\.com/,
        "https://discord.com",
    );
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on("error", reject);
    });
}

async function sendLog(interaction, header, contentCodeBlock) {
    try {
        const channel = await interaction.client.channels
            .fetch(LOG_CHANNEL_ID)
            .catch(() => null);
        if (channel) {
            await channel.send(
                `${header} by ${interaction.user.username} (${interaction.user.id})\n${contentCodeBlock}`,
            );
        }
    } catch (err) {
        console.error("Failed to send log:", err);
    }
}

// ---------------------------------------------------------
//  AI GENERATION
// ---------------------------------------------------------
const AI_PROMPTS = {
    PALEO: `Fields usually are arrays of strings:
           - type: e.g. ["theropod", "sauropod", "avian", "aquatic", etc]
           - family: e.g. ["Tyrannosaurid"]
           - region: e.g. ["North America"]
           - diet: e.g. ["carnivore"]
           - period: e.g. ["Cretaceous"]
           Return ONLY valid JSON. No markdown.`,

    JURASSIC: `Logic:
           - If Human:
             {
               "category": ["human"],
               "appearances": ["Jurassic Park", "World", etc],
               "diet": null,
               "type": null
             }
           - If Dinosaur/Creature:
             {
               "category": ["creature"],
               "type": ["theropod", "sauropod", "hybrid", "pterosaur", etc],
               "diet": ["carnivore", "herbivore"],
               "appearances": ["Jurassic Park", "Camp Cretaceous", etc]
             }
           - If Location:
             {
               "category": ["location"],
               "type": ["attraction", "building", "paddock", etc],
               "appearances": ["Jurassic Park", "Camp Cretaceous", etc]
             }
           - If Misc:
             {
               "category": ["misc"],
               "type": [" wtv fits best description"],
               "appearances": ["Jurassic Park", "Camp Cretaceous", etc]
             }

           IMPORTANT: "appearances" must ONLY include Movies/tv shows (Jurassic Park 1-3, World, FK, Dominion, Rebirth, Camp Cretaceous, Chaos Theory, Battle at big rock) and Novels (Jurassic Park, The Lost World). DO NOT include games, toys, comics, or rides.

           CRITICAL: If you are not 100% certain about specific appearances (especially for obscure chars), return an empty array [] for "appearances". DO NOT  GUESS or HALLUCINATE.

           Return ONLY valid JSON. No markdown.`,
};

async function generateProperties(word, database) {
    const isPaleo = database === "paleo";
    const prompt = isPaleo
        ? `Generate a JSON object for the Paleo entity "${word}". \n${AI_PROMPTS.PALEO}`
        : `Generate a JSON object for the Jurassic Park/World franchise entity "${word}".\n${AI_PROMPTS.JURASSIC}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log(`[AI RAW] ${word}:`, text); // Debug log

        // Robust JSON extraction
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error(`[AI Parser] No JSON found for ${word}`);
            return {};
        }

        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error(`[AI Error] ${word}:`, e);
        return {}; // Return empty on failure
    }
}

// Helper to update the global properties table
async function updateGlobalProperties(database, propertiesJson) {
    // propertiesJson: { type: ["val"], diet: ["val"] ... }
    for (const [key, values] of Object.entries(propertiesJson)) {
        if (!Array.isArray(values)) continue;
        for (const val of values) {
            try {
                await db.query(
                    `INSERT INTO ${PROPERTIES_TABLE} (property, database, type)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (property, database, type) DO NOTHING`,
                    [val, database, key],
                );
            } catch (e) {
                // Ignore duplicates
            }
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // --- QUOTES (Standard) ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.quotesAdd.name)
                .setDescription(
                    STRINGS.command.subcommands.quotesAdd.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.quotesAdd.options.link
                                .name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.quotesAdd.options.link
                                .description,
                        )
                        .setRequired(true),
                )
                .addBooleanOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.quotesAdd.options.reply
                                .name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.quotesAdd.options.reply
                                .description,
                        )
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.quotesEdit.name)
                .setDescription(
                    STRINGS.command.subcommands.quotesEdit.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.quotesEdit.options.link
                                .name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.quotesEdit.options.link
                                .description,
                        )
                        .setRequired(true),
                )
                .addBooleanOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.quotesEdit.options
                                .showReply.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.quotesEdit.options
                                .showReply.description,
                        )
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.quotesRemove.name)
                .setDescription(
                    STRINGS.command.subcommands.quotesRemove.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.quotesRemove.options
                                .link.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.quotesRemove.options
                                .link.description,
                        )
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.quotesExport.name)
                .setDescription(
                    STRINGS.command.subcommands.quotesExport.description,
                ),
        )

        // --- WORDLE: BULK ADD ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordleBulkAdd.name)
                .setDescription(
                    STRINGS.command.subcommands.wordleBulkAdd.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleBulkAdd.options
                                .database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleBulkAdd.options
                                .database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                ),
        )
        // --- WORDLE: ADD (Single) ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordleAdd.name)
                .setDescription(
                    STRINGS.command.subcommands.wordleAdd.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleAdd.options
                                .database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleAdd.options
                                .database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleAdd.options.word
                                .name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleAdd.options.word
                                .description,
                        )
                        .setRequired(true),
                ),
        )
        // --- WORDLE: EDIT ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordleEdit.name)
                .setDescription(
                    STRINGS.command.subcommands.wordleEdit.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleEdit.options
                                .database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleEdit.options
                                .database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleEdit.options
                                .targetWord.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleEdit.options
                                .targetWord.description,
                        )
                        .setRequired(true),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleEdit.options
                                .newWord.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleEdit.options
                                .newWord.description,
                        )
                        .setRequired(false),
                )
                .addBooleanOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleEdit.options
                                .editProperties.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleEdit.options
                                .editProperties.description,
                        )
                        .setRequired(false),
                ),
        )
        // --- WORDLE: REMOVE ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordleRemove.name)
                .setDescription(
                    STRINGS.command.subcommands.wordleRemove.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleRemove.options
                                .database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleRemove.options
                                .database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleRemove.options
                                .targetWord.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleRemove.options
                                .targetWord.description,
                        )
                        .setRequired(true),
                ),
        )
        // --- WORDLE: EXPORT/IMPORT ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordleExport.name)
                .setDescription(
                    STRINGS.command.subcommands.wordleExport.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleExport.options
                                .database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleExport.options
                                .database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordleImport.name)
                .setDescription(
                    STRINGS.command.subcommands.wordleImport.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleImport.options
                                .database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleImport.options
                                .database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                )
                .addAttachmentOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordleImport.options
                                .file.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordleImport.options
                                .file.description,
                        )
                        .setRequired(true),
                ),
        )
        // --- WORDLE: AUTO-FILL PROPERTIES (New) ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordlePropertiesFill.name)
                .setDescription(
                    STRINGS.command.subcommands.wordlePropertiesFill
                        .description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordlePropertiesFill
                                .options.database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordlePropertiesFill
                                .options.database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                ),
        )

        // --- PROPERTY MANAGEMENT (Renamed from Category) ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordlePropertyAdd.name)
                .setDescription(
                    STRINGS.command.subcommands.wordlePropertyAdd.description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordlePropertyAdd
                                .options.database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordlePropertyAdd
                                .options.database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordlePropertyAdd
                                .options.property.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordlePropertyAdd
                                .options.property.description,
                        )
                        .setRequired(true),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordlePropertyAdd
                                .options.type.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordlePropertyAdd
                                .options.type.description,
                        )
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.wordlePropertyRemove.name)
                .setDescription(
                    STRINGS.command.subcommands.wordlePropertyRemove
                        .description,
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordlePropertyRemove
                                .options.database.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordlePropertyRemove
                                .options.database.description,
                        )
                        .setRequired(true)
                        .addChoices(
                            { name: "Jurassic", value: "jurassic" },
                            { name: "Paleo", value: "paleo" },
                        ),
                )
                .addStringOption((o) =>
                    o
                        .setName(
                            STRINGS.command.subcommands.wordlePropertyRemove
                                .options.property.name,
                        )
                        .setDescription(
                            STRINGS.command.subcommands.wordlePropertyRemove
                                .options.property.description,
                        )
                        .setRequired(true)
                        .setAutocomplete(true),
                ),
        ),

    // ---------------------------------------------------------
    //  AUTOCOMPLETE
    // ---------------------------------------------------------
    async autocomplete(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const dbChoice = interaction.options.getString("database");

        if (!dbChoice) return interaction.respond([]);
        const focusedValue = interaction.options.getFocused().toLowerCase();

        // Autocomplete for properties (formerly categories)
        if (subcommand === "wordle-property-remove") {
            try {
                const res = await db.query(
                    `
                    SELECT property FROM ${PROPERTIES_TABLE}
                    WHERE database = $1
                    ORDER BY property ASC
                `,
                    [dbChoice],
                );

                const choices = res.rows
                    .map((r) => r.property)
                    .filter((p) => p.toLowerCase().includes(focusedValue))
                    .slice(0, 25);

                await interaction.respond(
                    choices.map((c) => ({ name: c, value: c })),
                );
            } catch (err) {
                console.error(err);
                await interaction.respond([]);
            }
        }
    },

    // ---------------------------------------------------------
    //  EXECUTE
    // ---------------------------------------------------------
    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has(
            PermissionFlagsBits.Administrator,
        );
        const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);

        if (!isAdmin && !isStaff) {
            return interaction.reply({
                content: STRINGS.errors.permissionDenied,
                flags: MessageFlags.Ephemeral,
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const dbChoice = interaction.options.getString("database");

        // ------------------------------------------------------------------
        // BULK ADD
        // ------------------------------------------------------------------
        if (subcommand === "wordle-bulk-add") {
            const modal = new ModalBuilder()
                .setCustomId(`bulk_add_${dbChoice}`)
                .setTitle(STRINGS.modals.bulkAddTitle(dbChoice));
            const input = new TextInputBuilder()
                .setCustomId("words_input")
                .setLabel(STRINGS.modals.bulkAddLabel)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));

            await interaction.showModal(modal);
            const submission = await interaction
                .awaitModalSubmit({
                    time: 300_000,
                    filter: (i) => i.user.id === interaction.user.id,
                })
                .catch(() => null);

            if (!submission) return;

            await handleBulkAdd(submission, dbChoice, interaction.user);
            return;
        }

        // ------------------------------------------------------------------
        // BULK REMOVE
        // ------------------------------------------------------------------
        if (subcommand === "wordle-bulk-remove") {
            const modal = new ModalBuilder()
                .setCustomId(`bulk_remove_${dbChoice}`)
                .setTitle(STRINGS.modals.bulkRemoveTitle(dbChoice));
            const input = new TextInputBuilder()
                .setCustomId("words_input")
                .setLabel(STRINGS.modals.bulkRemoveLabel)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));

            await interaction.showModal(modal);
            const submission = await interaction
                .awaitModalSubmit({
                    time: 300_000,
                    filter: (i) => i.user.id === interaction.user.id,
                })
                .catch(() => null);
            if (!submission) return;

            await handleBulkRemove(submission, dbChoice, interaction.user);
            return;
        }

        // ------------------------------------------------------------------
        // SINGLE ADD (With AI)
        // ------------------------------------------------------------------
        if (subcommand === "wordle-add") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const word = interaction.options
                .getString("word")
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .trim();
            const tableName = getTable(dbChoice);

            // 1. Generate Properties via AI
            await interaction.editReply(STRINGS.messages.generatingProps(word));
            const properties = await generateProperties(word, dbChoice);

            // 2. Insert
            try {
                const res = await db.query(
                    `INSERT INTO ${tableName} (word, properties, added_by) VALUES ($1, $2, $3) RETURNING *`,
                    [word, properties, interaction.user.id],
                );

                // 3. Update Global Properties List
                await updateGlobalProperties(dbChoice, properties);

                const logObj = { word, properties };
                await sendLog(
                    interaction,
                    STRINGS.messages.logWordleAdded(dbChoice),
                    `\`\`\`json\n${JSON.stringify(logObj, null, 4)}\n\`\`\``,
                );

                return interaction.editReply({
                    content: STRINGS.messages.wordAdded(
                        word,
                        dbChoice,
                        JSON.stringify(properties, null, 2),
                    ),
                });
            } catch (err) {
                if (err.code === "23505")
                    return interaction.editReply(
                        STRINGS.errors.wordAlreadyExists(word),
                    );
                throw err;
            }
        }

        // ------------------------------------------------------------------
        // EDIT (Logic Updated for Modal)
        // ------------------------------------------------------------------
        if (subcommand === "wordle-edit") {
            const target = interaction.options
                .getString("target_word")
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .trim();
            const rawNewWord = interaction.options.getString("new_word");
            const wantEditProps =
                interaction.options.getBoolean("edit_properties");
            const tableName = getTable(dbChoice);

            // Fetch current data
            const search = await db.query(
                `SELECT * FROM ${tableName} WHERE word = $1`,
                [target],
            );
            if (search.rows.length === 0)
                return interaction.reply({
                    content: STRINGS.errors.wordNotFound(target),
                    flags: MessageFlags.Ephemeral,
                });
            const oldRecord = search.rows[0];

            // If user wants to edit properties via Modal
            if (wantEditProps) {
                const modal = new ModalBuilder()
                    .setCustomId(`edit_props_${target}`)
                    .setTitle(STRINGS.modals.editPropsTitle(target));

                const jsonInput = new TextInputBuilder()
                    .setCustomId("json_data")
                    .setLabel(STRINGS.modals.editPropsLabel)
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(JSON.stringify(oldRecord.properties, null, 2))
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(jsonInput),
                );

                await interaction.showModal(modal);

                const submission = await interaction
                    .awaitModalSubmit({
                        time: 300_000,
                        filter: (i) => i.user.id === interaction.user.id,
                    })
                    .catch(() => null);

                if (!submission) return;

                // Process Edit Submission
                const rawJson =
                    submission.fields.getTextInputValue("json_data");
                let newProps;
                try {
                    newProps = JSON.parse(rawJson);
                } catch (e) {
                    return submission.reply({
                        content: STRINGS.errors.invalidJson,
                        flags: MessageFlags.Ephemeral,
                    });
                }

                const finalWord = rawNewWord
                    ? rawNewWord.toLowerCase().replace(/[^a-z0-9\s-]/g, "")
                    : oldRecord.word;

                await db.query(
                    `UPDATE ${tableName} SET word = $1, properties = $2 WHERE word = $3`,
                    [finalWord, newProps, oldRecord.word],
                );
                await updateGlobalProperties(dbChoice, newProps);

                return submission.reply({
                    content: STRINGS.messages.updatedWordProps(finalWord),
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Standard Edit (Just Word name)
            if (rawNewWord) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const finalWord = rawNewWord
                    .toLowerCase()
                    .replace(/[^a-z0-9\s-]/g, "");
                await db.query(
                    `UPDATE ${tableName} SET word = $1 WHERE word = $2`,
                    [finalWord, oldRecord.word],
                );
                return interaction.editReply(
                    STRINGS.messages.renamedWord(oldRecord.word, finalWord),
                );
            }

            return interaction.reply({
                content: STRINGS.errors.editSpecifyRequired,
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // REMOVE
        // ------------------------------------------------------------------
        if (subcommand === "wordle-remove") {
            const target = interaction.options
                .getString("target_word")
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .trim();
            await db.query(
                `DELETE FROM ${getTable(dbChoice)} WHERE word = $1`,
                [target],
            );
            await sendLog(
                interaction,
                STRINGS.messages.logWordleRemoved(target),
                `Deleted by ${interaction.user.username}`,
            );
            return interaction.editReply(STRINGS.messages.wordRemoved(target));
        }

        // ------------------------------------------------------------------
        // PROPERTY MANAGEMENT
        // ------------------------------------------------------------------
        if (subcommand === "wordle-property-add") {
            const prop = interaction.options.getString("property");
            const type = interaction.options.getString("type");
            try {
                await db.query(
                    `INSERT INTO ${PROPERTIES_TABLE} (property, database, type) VALUES ($1, $2, $3)`,
                    [prop, dbChoice, type],
                );
                return interaction.editReply(
                    STRINGS.messages.propertyAdded(prop, type),
                );
            } catch (err) {
                return interaction.editReply(STRINGS.errors.propertyAddError);
            }
        }

        if (subcommand === "wordle-property-remove") {
            const prop = interaction.options.getString("property");
            await db.query(
                `DELETE FROM ${PROPERTIES_TABLE} WHERE property = $1 AND database = $2`,
                [prop, dbChoice],
            );
            return interaction.editReply(
                STRINGS.messages.propertyRemoved(prop),
            );
        }

        // ------------------------------------------------------------------
        // EXPORT / IMPORT
        // ------------------------------------------------------------------
        if (subcommand === "wordle-export") {
            const res = await db.query(
                `SELECT word, properties FROM ${getTable(dbChoice)} ORDER BY word ASC`,
            );
            const file = new AttachmentBuilder(
                Buffer.from(JSON.stringify(res.rows, null, 2)),
                { name: `${dbChoice}_export.json` },
            );
            return interaction.editReply({
                content: STRINGS.messages.exportHeader(dbChoice),
                files: [file],
            });
        }

        if (subcommand === "wordle-import") {
            const fileObj = interaction.options.getAttachment("file");
            if (!fileObj.contentType.includes("json"))
                return interaction.editReply(STRINGS.errors.notJsonFile);
            try {
                const data = await fetchJson(fileObj.url);
                if (!Array.isArray(data))
                    return interaction.editReply(
                        STRINGS.errors.jsonMustBeArray,
                    );

                let count = 0;
                for (const item of data) {
                    if (!item.word) continue;
                    const cleanWord = item.word
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, "");
                    const props = item.properties || {};
                    await db.query(
                        `
                        INSERT INTO ${getTable(dbChoice)} (word, properties, added_by)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (word) DO UPDATE SET properties = $2
                    `,
                        [cleanWord, props, interaction.user.id],
                    );
                    await updateGlobalProperties(dbChoice, props);
                    count++;
                }
                return interaction.editReply(
                    STRINGS.messages.importedItems(count),
                );
            } catch (e) {
                return interaction.editReply(STRINGS.errors.importFailed);
            }
        }

        // ------------------------------------------------------------------
        // PROPERTIES FILL (Auto-Complete Empty)
        // ------------------------------------------------------------------
        if (subcommand === "wordle-properties-fill") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const tableName = getTable(dbChoice);

            // 1. Find words with empty properties
            const res = await db.query(
                `SELECT word FROM ${tableName} WHERE properties = '{}'::jsonb OR properties IS NULL`,
            );
            const wordsToFill = res.rows.map((r) => r.word);

            if (wordsToFill.length === 0) {
                return interaction.editReply(
                    STRINGS.messages.noEmptyPropertyWords(dbChoice),
                );
            }

            // 2. Reuse Batch Logic
            const CHUNK_SIZE = 50;
            const chunks = [];
            for (let i = 0; i < wordsToFill.length; i += CHUNK_SIZE) {
                chunks.push(wordsToFill.slice(i, i + CHUNK_SIZE));
            }

            await interaction.editReply(
                STRINGS.messages.batchProcessStart(
                    wordsToFill.length,
                    chunks.length,
                ),
            );

            let updatedCount = 0;
            let errors = [];

            for (const [index, chunk] of chunks.entries()) {
                let batchResults = {};
                try {
                    batchResults = await generatePropertiesBatch(
                        chunk,
                        dbChoice,
                    );
                } catch (aiErr) {
                    console.error(`[Fill Batch ${index + 1} AI Fail]`, aiErr);
                }

                for (const word of chunk) {
                    try {
                        const props =
                            batchResults[word] ||
                            batchResults[word.replace(/\s/g, "")] ||
                            {};
                        // Skip if AI gave us nothing (keep it empty for next time or manual fix)
                        if (Object.keys(props).length === 0) continue;

                        await db.query(
                            `UPDATE ${tableName} SET properties = $1 WHERE word = $2`,
                            [props, word],
                        );
                        await updateGlobalProperties(dbChoice, props);
                        updatedCount++;
                    } catch (err) {
                        errors.push(word);
                    }
                }
                // Update progress
                await interaction.editReply(
                    STRINGS.messages.batchProcessProgress(
                        index + 1,
                        chunks.length,
                        updatedCount,
                    ),
                );
                await new Promise((r) => setTimeout(r, 2000));
            }

            return interaction.editReply(
                STRINGS.messages.autoFillDone(updatedCount),
            );
        }

        // --- QUOTES LOGIC (Restored) ---
        if (subcommand.startsWith("quotes-")) {
            if (subcommand === "quotes-export") {
                const res = await db.query(
                    `SELECT * FROM ${QUOTES_TABLE} ORDER BY id ASC`,
                );
                const file = new AttachmentBuilder(
                    Buffer.from(JSON.stringify(res.rows, null, 2)),
                    { name: "quotes_export.json" },
                );
                return interaction.editReply({
                    content: STRINGS.messages.quotesBackup,
                    files: [file],
                });
            }

            const link = normalizeLink(interaction.options.getString("link"));
            const linkParts = link.split("/");
            const messageId = linkParts.pop();
            const channelId = linkParts.pop();

            if (!messageId || !channelId)
                return interaction.editReply(STRINGS.errors.invalidDiscordLink);

            if (subcommand === "quotes-add") {
                const wantReply = interaction.options.getBoolean("reply");
                const check = await db.query(
                    `SELECT * FROM ${QUOTES_TABLE} WHERE link = $1`,
                    [link],
                );
                if (check.rows.length > 0)
                    return interaction.editReply(
                        STRINGS.errors.quoteAlreadyExists,
                    );

                const channel = await interaction.client.channels
                    .fetch(channelId)
                    .catch(() => null);
                if (!channel)
                    return interaction.editReply(
                        STRINGS.errors.cannotAccessChannel,
                    );
                const msg = await channel.messages
                    .fetch(messageId)
                    .catch(() => null);
                if (!msg)
                    return interaction.editReply(
                        STRINGS.errors.cannotFindMessage,
                    );

                let replyText = null;
                if (wantReply && msg.reference) {
                    const refMsg = await channel.messages
                        .fetch(msg.reference.messageId)
                        .catch(() => null);
                    if (refMsg) replyText = refMsg.content;
                }

                const res = await db.query(
                    `INSERT INTO ${QUOTES_TABLE} (text, link, reply) VALUES ($1, $2, $3) RETURNING *`,
                    [msg.content, link, replyText],
                );

                const jsonLog = JSON.stringify(res.rows[0], null, 2);
                await sendLog(
                    interaction,
                    STRINGS.messages.logQuotesAdded,
                    `\`\`\`json\n${jsonLog}\n\`\`\``,
                );

                return interaction.editReply(
                    STRINGS.messages.quoteAdded(msg.content),
                );
            }

            if (subcommand === "quotes-remove") {
                const res = await db.query(
                    `DELETE FROM ${QUOTES_TABLE} WHERE link = $1 RETURNING *`,
                    [link],
                );
                if (res.rowCount === 0)
                    return interaction.editReply(STRINGS.errors.quoteNotFound);

                const jsonLog = JSON.stringify(res.rows[0], null, 2);
                await sendLog(
                    interaction,
                    STRINGS.messages.logQuotesDeleted,
                    `\`\`\`json\n${jsonLog}\n\`\`\``,
                );

                return interaction.editReply(STRINGS.messages.quoteDeleted);
            }

            if (subcommand === "quotes-edit") {
                const showReply = interaction.options.getBoolean("show_reply");

                const oldRes = await db.query(
                    `SELECT * FROM ${QUOTES_TABLE} WHERE link = $1`,
                    [link],
                );
                if (oldRes.rows.length === 0)
                    return interaction.editReply(
                        STRINGS.errors.quoteNotFoundErr,
                    );
                const oldRecord = oldRes.rows[0];

                let newReplyContent = null;
                if (showReply) {
                    const channel =
                        await interaction.client.channels.fetch(channelId);
                    const msg = await channel.messages.fetch(messageId);
                    if (!msg.reference)
                        return interaction.editReply(
                            STRINGS.errors.messageHasNoReply,
                        );
                    const ref = await channel.messages.fetch(
                        msg.reference.messageId,
                    );
                    newReplyContent = ref.content;
                }

                await db.query(
                    `UPDATE ${QUOTES_TABLE} SET reply = $1 WHERE link = $2`,
                    [newReplyContent, link],
                );

                const diff = [
                    "{",
                    `  "id": ${oldRecord.id},`,
                    `  "text": "${oldRecord.text.replace(/"/g, '\\"')}",`,
                    `  "link": "${oldRecord.link}",`,
                    `- "reply": ${
                        oldRecord.reply ? `"${oldRecord.reply}"` : "null"
                    }`,
                    `+ "reply": ${
                        newReplyContent ? `"${newReplyContent}"` : "null"
                    }`,
                    "}",
                ].join("\n");

                await sendLog(
                    interaction,
                    STRINGS.messages.logQuotesEdited,
                    `\`\`\`diff\n${diff}\n\`\`\``,
                );
                return interaction.editReply(STRINGS.messages.quoteUpdated);
            }
        }
    },
};

// ---------------------------------------------------------
//  HELPER: BULK ADD
// ---------------------------------------------------------
// Helper: Batch AI Generation
async function generatePropertiesBatch(wordsList, database) {
    if (wordsList.length === 0) return {};

    // Safety: ensure we don't send too many tokens.
    // But words list logic is handled by the caller (chunking).

    const isPaleo = database === "paleo";
    const prompt = isPaleo
        ? `Generate a JSON object where keys are the input words and values are their property objects for these Paleo entities: ${JSON.stringify(wordsList)}.
           ${AI_PROMPTS.PALEO}
           Example:
           {
             "trex": { "type": ["theropod"], ... },
             "triceratops": { ... }
           }`
        : `Generate a JSON object where keys are the input words and values are their property objects for these Jurassic franchise entities: ${JSON.stringify(wordsList)}.
           ${AI_PROMPTS.JURASSIC}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log(`[AI BATCH] Processing ${wordsList.length} items...`);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error(`[AI Parser] No JSON found for batch`);
            return {};
        }

        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error(`[AI Batch Error]:`, e);
        return {};
    }
}

// ---------------------------------------------------------
//  HELPER: BULK ADD
// ---------------------------------------------------------
async function handleBulkAdd(submission, dbChoice, user) {
    await submission.deferReply({ flags: MessageFlags.Ephemeral });
    const rawInput = submission.fields.getTextInputValue("words_input");

    // 1. Clean and deduplicate input
    const allWords = [
        ...new Set(
            rawInput
                .split(/[,\n]+/)
                .map((w) =>
                    w
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, ""),
                )
                .filter((w) => w.length > 0),
        ),
    ];

    if (allWords.length === 0) {
        return submission.editReply(STRINGS.errors.bulkAddNoWords);
    }

    const tableName = getTable(dbChoice);

    // 2. Check which words ALREADY exist in DB
    // We do this in one query to save resources
    let existingWordsSet = new Set();
    try {
        const res = await db.query(
            `SELECT word FROM ${tableName} WHERE word = ANY($1)`,
            [allWords],
        );
        res.rows.forEach((r) => existingWordsSet.add(r.word));
    } catch (err) {
        console.error("Bulk Add Check Error:", err);
        return submission.editReply(STRINGS.errors.bulkAddDbError);
    }

    // 3. Filter out existing words
    const newWords = allWords.filter((w) => !existingWordsSet.has(w));

    if (newWords.length === 0) {
        return submission.editReply(
            STRINGS.messages.bulkAddAllExist(allWords.length),
        );
    }

    const skippedCount = allWords.length - newWords.length;

    let added = [];
    let errors = [];

    // Chunk size 50 is reasonable for robust models like 1.5/2.0
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < newWords.length; i += CHUNK_SIZE) {
        chunks.push(newWords.slice(i, i + CHUNK_SIZE));
    }

    await submission.editReply(
        STRINGS.messages.bulkAddProcessing(
            newWords.length,
            skippedCount,
            chunks.length,
        ),
    );

    for (const [index, chunk] of chunks.entries()) {
        // 4. Generate Batch Properties (One AI call per batch)
        let batchResults = {};
        try {
            batchResults = await generatePropertiesBatch(chunk, dbChoice);
        } catch (aiErr) {
            console.error(`[Batch ${index + 1} AI Fail]`, aiErr);
            // We continue processing, but props will be empty for this batch
        }

        // 5. Process each word in the chunk INDIVIDUALLY
        for (const word of chunk) {
            try {
                // If AI failed to return a key for this word, default to empty
                const props =
                    batchResults[word] ||
                    batchResults[word.replace(/\s/g, "")] ||
                    {};

                // 6. Insert into DB (with Retry)
                let retries = 3;
                while (retries > 0) {
                    try {
                        const res = await db.query(
                            `INSERT INTO ${tableName} (word, properties, added_by) VALUES ($1, $2, $3)
                             ON CONFLICT (word) DO NOTHING RETURNING *`,
                            [word, props, user.id],
                        );

                        // Since we filtered beforehand, specific conflict/race conditions are rare but possible.
                        // If rowCount > 0, we inserted it.
                        if (res.rowCount > 0) {
                            added.push(res.rows[0]);
                            await updateGlobalProperties(dbChoice, props);
                        } else {
                            // Race condition: it was added between our check and now?
                            console.log(
                                `[Bulk Add] Skipped ${word} (Duplicate found during insert)`,
                            );
                        }
                        break; // Success
                    } catch (dbErr) {
                        retries--;
                        if (retries === 0) throw dbErr;
                        console.log(
                            `[DB Retry] Connection failed for ${word}, retrying...`,
                        );
                        await new Promise((r) => setTimeout(r, 2000));
                    }
                }
            } catch (wordErr) {
                console.error(`[Bulk Add Error] Word: ${word}`, wordErr);
                errors.push(`${word} (${wordErr.message})`);
            }
        }

        // Progress update per batch
        await submission.editReply(
            STRINGS.messages.bulkAddBatchProgress(
                index + 1,
                chunks.length,
                added.length,
            ),
        );

        // Small safety delay between batches
        await new Promise((r) => setTimeout(r, 2000));
    }

    if (added.length > 0) {
        // Send Log
        const jsonStr = JSON.stringify(
            added.map((a) => ({ word: a.word, properties: a.properties })),
            null,
            2,
        );
        if (jsonStr.length < 1900) {
            await sendLog(
                submission,
                STRINGS.messages.logBulkAdd(dbChoice),
                `\`\`\`json\n${jsonStr}\n\`\`\``,
            );
        } else {
            const file = new AttachmentBuilder(Buffer.from(jsonStr), {
                name: `bulk.json`,
            });
            const c = await submission.client.channels
                .fetch(LOG_CHANNEL_ID)
                .catch(() => null);
            if (c)
                c.send({
                    content: STRINGS.messages.logBulkAddFile,
                    files: [file],
                });
        }
    }

    return submission.editReply(
        STRINGS.messages.bulkAddDone(added.length, skippedCount, errors.length),
    );
}

async function handleBulkRemove(submission, dbChoice, user) {
    await submission.deferReply({ flags: MessageFlags.Ephemeral });
    const words = submission.fields
        .getTextInputValue("words_input")
        .split(/[,\n]+/)
        .map((w) => w.trim().toLowerCase());
    const tableName = getTable(dbChoice);
    let count = 0;

    for (const word of words) {
        const res = await db.query(`DELETE FROM ${tableName} WHERE word = $1`, [
            word,
        ]);
        count += res.rowCount;
    }

    return submission.editReply(STRINGS.messages.bulkRemoveDone(count));
}
