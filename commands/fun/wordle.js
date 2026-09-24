const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../db");
const { getEmojiCollection } = require("../../utils/emojiResolver");

// --- ANTI-SPAM / RAGE QUIT SYSTEM ---
const playerStats = new Map();
const RAGE_LIMIT = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

// Track active games
const activeGames = new Set();

const STRINGS = {
    command: {
        name: "wordle",
        description: "Play Wordle",
        subcommands: {
            jurassic: {
                name: "jurassic",
                description: "Play Jurassic Wordle",
                options: {
                    type: {
                        name: "type",
                        description: "Filter by Type",
                    },
                },
            },
            paleo: {
                name: "paleo",
                description: "Play Paleo Wordle",
            },
        },
    },
    emojis: {
        hazard: ":hazard:",
        slowmode: ":slowmode:",
        cross: ":x_:",
        unknown: ":unknown:",
        checkmark: ":checkmark:",
        clock: ":clock:",
    },
    messages: {
        tooManyFilters: ":hazard: **Too many filters!**\nPlease select only **one** filter (Type, Period, or Diet) for now.",
        alreadyPlaying: ":hazard: You already have a game in progress!",
        cooldownActive: (timestamp) => `:slowmode: **Cooldown Active!** You quit too many games. Try again <t:${timestamp}:R>.`,
        dbEmpty: (mode) => `:x_: The **${mode}** database is empty!`,
        noWordsFound: (filterDesc) => `:x_: No words found with filters: **${filterDesc}**!`,
        dbError: ":x_: Database error.",
        initialStatus: (emptyRow, wordLength, maxChances, timeString) =>
            `${emptyRow}\n-# Length: ${wordLength} | Chances: ${maxChances} | Ends ${timeString}, type 'extend' to increase time, type 'end game' to end`,
        timerExtended: (newEndTime) => `:slowmode: **Timer Extended!** Game ends <t:${newEndTime}:R>.`,
        hintsLocked: (threshold) => `:hazard: Hints are only available in the **last ${threshold} guesses**!`,
        hintLimitReached: ":hazard: You can only use **one hint per turn**!",
        noHintsAvailable: ":unknown: No property information available.",
        hint: (hintText) => `**HINT:** ${hintText}`,
        gameStoppedCooldown: (secretWord) =>
            `:unknown: Game stopped. The word was *${secretWord.toLowerCase()}*.\n:slowmode: You are now on cooldown for 5 minutes for ending too many games without completion.`,
        gameStopped: (secretWord) =>
            `:unknown: Game stopped. The word was *${secretWord.toLowerCase()}*.\n-# Warning: Quitting repeatedly will trigger a cooldown.`,
        invalidWordLength: (wordLength) => `:hazard: Word must be **${wordLength}** letters long!`,
        wordNotInDb: (guess, mode) => `:x_: **${guess.toLowerCase()}** is not in the ${mode} database!`,
        footerPrompt: (remaining, timeString) =>
            `-# ${remaining} guesses left | Ends ${timeString}${remaining <= 3 ? " | Type 'hint' to get a hint" : ""}`,
        gameWon: (rowEmojis, secretWord) => `${rowEmojis}\n:checkmark: Correct! The word was *${secretWord.toLowerCase()}*.`,
        gameOver: (rowEmojis, secretWord, footer) => `${rowEmojis}\n:clock: Game Over. The word was *${secretWord.toLowerCase()}*.\n${footer}`,
        turnResult: (rowEmojis, footer) => `${rowEmojis}\n${footer}`,
        timesUp: (secretWord) => `:slowmode: Time's up! The word was *${secretWord.toLowerCase()}*.`,
    },
};

async function safeReply(originalMessage, content) {
    try {
        return await originalMessage.reply(content);
    } catch (err) {
        if (err.code === 10008 || err.code === 50035) {
            return await originalMessage.channel.send(content).catch(() => { });
        }
        console.error("SafeReply Error:", err);
    }
}

const MULTI_FILTER_ENABLED = false;

module.exports = {
    data: new SlashCommandBuilder()
        .setName(STRINGS.command.name)
        .setDescription(STRINGS.command.description)
        // --- JURASSIC MODE ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.jurassic.name)
                .setDescription(STRINGS.command.subcommands.jurassic.description)
                .addStringOption((option) =>
                    option
                        .setName(STRINGS.command.subcommands.jurassic.options.type.name)
                        .setDescription(STRINGS.command.subcommands.jurassic.options.type.description)
                        .setAutocomplete(true)
                )
        )
        // --- PALEO MODE ---
        .addSubcommand((sub) =>
            sub
                .setName(STRINGS.command.subcommands.paleo.name)
                .setDescription(STRINGS.command.subcommands.paleo.description)
        ),

    // ---------------------------------------------------------
    //  AUTOCOMPLETE HANDLER
    // ---------------------------------------------------------
    async autocomplete(interaction) {
        const mode = interaction.options.getSubcommand();
        const focusedOption = interaction.options.getFocused(true); // Get full option object
        const focusedValue = focusedOption.value.toLowerCase();
        let filterType = focusedOption.name; // 'type', 'period', 'diet'

        // Special Case: Jurassic 'Type' filter should actually look for 'category' properties
        // (e.g. Human, Creature, Location) instead of 'type' (Theropod, etc)
        if (mode === "jurassic" && filterType === "type") {
            filterType = "category";
        }

        try {
            // Query the properties table for specific types
            const res = await db.query(
                `SELECT property FROM wordle.properties 
                 WHERE database = $1 AND type = $2 
                 ORDER BY property ASC`,
                [mode, filterType]
            );

            const choices = res.rows
                .map((row) => row.property)
                .filter((prop) => prop.toLowerCase().includes(focusedValue))
                .slice(0, 25);

            await interaction.respond(
                choices.map((choice) => ({ name: choice, value: choice }))
            );
        } catch (err) {
            console.error("Autocomplete Error:", err);
            await interaction.respond([]);
        }
    },

    // ---------------------------------------------------------
    //  EXECUTE HANDLER (The Game)
    // ---------------------------------------------------------
    // ---------------------------------------------------------
    //  EXECUTE HANDLER (The Game & Contribution)
    // ---------------------------------------------------------
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // --- GAME LOGIC ---
        const userId = interaction.user.id;
        const mode = subcommand;
        const tableName = mode === "paleo" ? "wordle.paleo" : "wordle.jurassic";
        // ... rest of game logic ...

        const typeFilter = interaction.options.getString("type");
        const periodFilter = interaction.options.getString("period");
        const dietFilter = interaction.options.getString("diet");

        // Count active filters
        const activeFilters = [];
        if (typeFilter) {
            // Jurassic Mode: 'type' filter actually targets 'category' field in JSON
            const key = (mode === "jurassic") ? "category" : "type";
            activeFilters.push({ key: key, val: typeFilter });
        }
        if (periodFilter) activeFilters.push({ key: "period", val: periodFilter });
        if (dietFilter) activeFilters.push({ key: "diet", val: dietFilter });

        // Enforce Single Filter Rule (unless overridden)
        if (!MULTI_FILTER_ENABLED && activeFilters.length > 1) {
            return interaction.reply({
                content: STRINGS.messages.tooManyFilters,
                flags: MessageFlags.Ephemeral,
            });
        }

        // 2. FAST CHECKS
        if (activeGames.has(userId)) {
            return interaction.reply({
                content: STRINGS.messages.alreadyPlaying,
                flags: MessageFlags.Ephemeral,
            });
        }

        const stats = playerStats.get(userId) || {
            quitStreak: 0,
            cooldownUntil: 0,
        };
        if (Date.now() < stats.cooldownUntil) {
            return interaction.reply({
                content: STRINGS.messages.cooldownActive(Math.floor(stats.cooldownUntil / 1000)),
                flags: MessageFlags.Ephemeral,
            });
        }

        // 3. DEFER & SETUP
        await interaction.deferReply();

        activeGames.add(userId);

        const appEmojis =
            (await getEmojiCollection(interaction.client, true)) ||
            interaction.client.application?.emojis?.cache;

        let validWords = new Set();
        let secretData;

        try {
            const allWordsRes = await db.query(
                `SELECT word, properties FROM ${tableName}`
            );

            if (allWordsRes.rows.length === 0) {
                activeGames.delete(userId);
                return interaction.editReply(
                    STRINGS.messages.dbEmpty(mode)
                );
            }

            let secretPool = [];

            allWordsRes.rows.forEach((row) => {
                validWords.add(row.word.toUpperCase());
                const props = row.properties || {};

                // Filter Check
                let pass = true;
                for (const filter of activeFilters) {
                    const propValues = props[filter.key]; // e.g. ["Theropod"]
                    if (!propValues || !Array.isArray(propValues)) {
                        pass = false;
                        break;
                    }
                    // Case-insensitive check
                    const hasMatch = propValues.some(v => v.toLowerCase() === filter.val.toLowerCase());
                    if (!hasMatch) {
                        pass = false;
                        break;
                    }
                }

                if (pass) {
                    secretPool.push(row);
                }
            });

            if (secretPool.length === 0) {
                activeGames.delete(userId);
                const filterDesc = activeFilters.map(f => `${f.key}: ${f.val}`).join(", ");
                return interaction.editReply(
                    STRINGS.messages.noWordsFound(filterDesc)
                );
            }

            const randomEntry =
                secretPool[Math.floor(Math.random() * secretPool.length)];

            // Prepare hints from properties
            const hintList = Object.values(randomEntry.properties || {}).flat().filter(v => typeof v === 'string');

            secretData = {
                word: randomEntry.word.toUpperCase(),
                hints: hintList,
            };
        } catch (err) {
            console.error(err);
            activeGames.delete(userId);
            return interaction.editReply(
                STRINGS.messages.dbError
            );
        }

        const secretWord = secretData.word;
        const wordLength = secretWord.length;
        let maxChances = 6;
        if (wordLength >= 12) maxChances = 8;
        else if (wordLength >= 8) maxChances = 7;

        let guesses = [];
        let usedHints = new Set();
        let turnHintUsed = false; // Tracks if a hint was used THIS turn

        let isGameOver = false;

        const gameDuration = 600_000;
        const gameEndTime = Math.floor((Date.now() + gameDuration) / 1000);
        const timeString = `<t:${gameEndTime}:R>`;

        const emptyRow = "⬜".repeat(wordLength);

        // Initial embed has no footer hint text because hints only unlock in last 3 guesses
        await interaction.editReply({
            content: STRINGS.messages.initialStatus(emptyRow, wordLength, maxChances, timeString),
        });

        const collector = interaction.channel.createMessageCollector({
            filter: (m) => m.author.id === userId,
            time: gameDuration,
        });

        collector.on("collect", async (message) => {
            if (isGameOver) return;
            const content = message.content.trim().toUpperCase();

            // --- EXTEND COMMAND ---
            if (content === "EXTEND") {
                collector.resetTimer(); // Resets to original 10 mins (600,000ms) from NOW
                const newEndTime = Math.floor((Date.now() + 600_000) / 1000);
                await safeReply(
                    message,
                    STRINGS.messages.timerExtended(newEndTime)
                );
                return;
            }

            // --- HINT COMMAND ---
            if (content === "HINT") {
                const remaining = maxChances - guesses.length;

                // 1. Check if hints are unlocked
                // Paleo: Unlocked at 5 chances left (allowing up to 5 hints if needed)
                // Jurassic: Unlocked at 3 chances left
                const hintUnlockThreshold = mode === "paleo" ? 5 : 3;

                if (remaining > hintUnlockThreshold) {
                    const warning = await safeReply(
                        message,
                        STRINGS.messages.hintsLocked(hintUnlockThreshold)
                    );
                    setTimeout(() => warning.delete().catch(() => { }), 4000);
                    return;
                }

                // 2. Check if already used a hint this turn
                if (turnHintUsed) {
                    const warning = await safeReply(
                        message,
                        STRINGS.messages.hintLimitReached
                    );
                    setTimeout(() => warning.delete().catch(() => { }), 3000);
                    return;
                }

                // 3. Generate Hint
                let availableHints = secretData.hints;
                if (!availableHints || availableHints.length === 0) {
                    await safeReply(message, STRINGS.messages.noHintsAvailable);
                    return;
                }

                // Filter out already used hints
                let freshHints = availableHints.filter(h => !usedHints.has(h));
                let hintText;

                // Logic: Prioritize fresh hints.
                // If NO fresh hints left, and the TOTAL pool of hints is small (< 3), 
                // we allow repeating hints so the user isn't stuck.
                // If total pool is large, we might just say "No more hints". 
                // But per user request: "if there are less than 3 properties... u can repeat hints"

                if (freshHints.length > 0) {
                    // Pick a fresh one
                    hintText = freshHints[Math.floor(Math.random() * freshHints.length)];
                } else {
                    // No fresh hints. 
                    // If total hints are limited (< 3), we recycle.
                    if (availableHints.length < 3) {
                        hintText = availableHints[Math.floor(Math.random() * availableHints.length)];
                    } else {
                        // If we have plenty of hints but used them all? (Unlikely in 3 guesses but possible if spammed)
                        // Just recycle anyway to be helpful.
                        hintText = availableHints[Math.floor(Math.random() * availableHints.length)];
                    }
                }

                usedHints.add(hintText);
                turnHintUsed = true; // Mark as utilized for this turn

                await safeReply(message, STRINGS.messages.hint(hintText));
                return;
            }

            // --- END GAME COMMAND ---
            if (content === "END GAME") {
                isGameOver = true;
                stats.quitStreak += 1;
                if (stats.quitStreak >= RAGE_LIMIT) {
                    stats.cooldownUntil = Date.now() + COOLDOWN_MS;
                    stats.quitStreak = 0;
                    playerStats.set(userId, stats);
                    await safeReply(
                        message,
                        STRINGS.messages.gameStoppedCooldown(secretWord)
                    );
                } else {
                    playerStats.set(userId, stats);
                    await safeReply(
                        message,
                        STRINGS.messages.gameStopped(secretWord)
                    );
                }
                collector.stop();
                return;
            }

            // --- GUESS VALIDATION ---
            if (content.length !== wordLength) {
                const warning = await safeReply(
                    message,
                    STRINGS.messages.invalidWordLength(wordLength)
                );
                if (warning)
                    setTimeout(() => warning.delete().catch(() => { }), 3000);
                return;
            }
            if (!/^[A-Z0-9\s-]+$/.test(content)) return;

            if (!validWords.has(content)) {
                const warning = await safeReply(
                    message,
                    STRINGS.messages.wordNotInDb(content, mode)
                );
                if (warning)
                    setTimeout(() => warning.delete().catch(() => { }), 3000);
                return;
            }

            // --- GAMEPLAY ---
            guesses.push(content);
            turnHintUsed = false; // Reset hint usage for the new turn

            const currentTurn = guesses.length;
            const remaining = maxChances - currentTurn;
            const rowEmojis = generateCustomRow(content, secretWord, appEmojis);
            const footer = STRINGS.messages.footerPrompt(remaining, timeString);

            if (content === secretWord) {
                isGameOver = true;
                stats.quitStreak = 0;
                playerStats.set(userId, stats);
                await safeReply(
                    message,
                    STRINGS.messages.gameWon(rowEmojis, secretWord)
                );
                collector.stop();
                return;
            }

            if (currentTurn >= maxChances) {
                isGameOver = true;
                stats.quitStreak = 0;
                playerStats.set(userId, stats);
                await safeReply(
                    message,
                    STRINGS.messages.gameOver(rowEmojis, secretWord, footer)
                );
                collector.stop();
                return;
            }

            await safeReply(message, STRINGS.messages.turnResult(rowEmojis, footer));
        });

        collector.on("end", (collected, reason) => {
            activeGames.delete(userId);
            if (reason === "time" && !isGameOver) {
                interaction.followUp(
                    STRINGS.messages.timesUp(secretWord)
                );
            }
        });
    },
};

function generateCustomRow(guess, secret, appEmojis) {
    let secretArr = secret.split("");
    let guessArr = guess.split("");
    let statusArr = Array(secret.length).fill("dark");

    for (let i = 0; i < secret.length; i++) {
        if (guessArr[i] === secretArr[i]) {
            statusArr[i] = "green";
            secretArr[i] = null;
            guessArr[i] = null;
        }
    }
    for (let i = 0; i < secret.length; i++) {
        if (guessArr[i] !== null) {
            const foundIndex = secretArr.indexOf(guessArr[i]);
            if (foundIndex !== -1) {
                statusArr[i] = "yellow";
                secretArr[foundIndex] = null;
            }
        }
    }
    return guess
        .split("")
        .map((char, i) => {
            const status = statusArr[i];
            const emojiName = `${status}_${char.toLowerCase()}`;
            // Handle spaces/numbers in custom emojis? 
            // If char is space, just return space? 
            if (char === ' ') return '  ';

            const customEmoji = appEmojis.find((e) => e.name === emojiName);

            if (customEmoji) {
                return customEmoji.toString();
            } else {
                const block =
                    status === "green"
                        ? "🟩"
                        : status === "yellow"
                            ? "🟨"
                            : "⬛";
                return `**${char}**${block}`;
            }
        })
        .join("");
}
