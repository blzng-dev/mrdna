let lastFetchTime = 0;
let fetchPromise = null;
const FETCH_COOLDOWN_MS = 3000; // 3 seconds throttle for on-demand fetch
const CACHE_TTL_MS = 15000; // 15 seconds TTL for periodic refresh

async function syncApplicationEmojis(client, force = false) {
    if (!client || !client.application?.emojis) {
        return client?.application?.emojis?.cache || null;
    }

    const now = Date.now();
    const cache = client.application.emojis.cache;
    const isCacheEmpty = !cache || cache.size === 0;
    const isTtlExpired = (now - lastFetchTime) > CACHE_TTL_MS;

    if (!force && !isCacheEmpty && !isTtlExpired) {
        return cache;
    }

    if (!force && !isCacheEmpty && (now - lastFetchTime) < FETCH_COOLDOWN_MS) {
        return cache;
    }

    if (fetchPromise) {
        return fetchPromise;
    }

    fetchPromise = (async () => {
        try {
            const freshEmojis = await client.application.emojis.fetch();
            if (client.application.emojis.cache && freshEmojis) {
                // Prune any emojis in cache that no longer exist on Discord
                for (const cachedId of Array.from(client.application.emojis.cache.keys())) {
                    if (!freshEmojis.has(cachedId)) {
                        client.application.emojis.cache.delete(cachedId);
                    }
                }
            }
            lastFetchTime = Date.now();
        } catch (err) {
            console.error('[EmojiResolver] Failed to sync application emojis:', err);
        } finally {
            fetchPromise = null;
        }
        return client.application.emojis.cache || null;
    })();

    return fetchPromise;
}

async function getEmojiCollection(client, force = false) {
    return await syncApplicationEmojis(client, force);
}

function matchEmoji(client, name) {
    if (!name) return null;
    const lowerName = name.toLowerCase();

    function searchCache(cache) {
        if (!cache) return null;

        let exactMatch = null;
        let caseInsensitiveMatch = null;

        const iterable = typeof cache.values === 'function' ? cache.values() : (Array.isArray(cache) ? cache : []);
        for (const e of iterable) {
            if (!e) continue;
            if (e.name === name) {
                // If multiple exact matches exist, prefer the newer one (larger snowflake ID)
                if (!exactMatch || (e.id && exactMatch.id && BigInt(e.id) > BigInt(exactMatch.id))) {
                    exactMatch = e;
                }
            } else if (e.name?.toLowerCase() === lowerName) {
                if (!caseInsensitiveMatch || (e.id && caseInsensitiveMatch.id && BigInt(e.id) > BigInt(caseInsensitiveMatch.id))) {
                    caseInsensitiveMatch = e;
                }
            }
        }
        return exactMatch || caseInsensitiveMatch || null;
    }

    const appFound = searchCache(client.application?.emojis?.cache);
    if (appFound) return appFound;

    const guildFound = searchCache(client.emojis?.cache);
    if (guildFound) return guildFound;

    return null;
}

async function resolveEmojisInText(client, text, forceSync = false) {
    if (!text || typeof text !== 'string' || !text.includes(':')) return text;

    await syncApplicationEmojis(client, forceSync);

    // 1. Check if there are any unmatched emoji names: :name:
    const colonMatches = [...text.matchAll(/(?<!<a?):([a-zA-Z0-9_]+):(?!\d+>)/g)];
    const hasUnmatched = colonMatches.some(m => !matchEmoji(client, m[1]));

    if (hasUnmatched && (Date.now() - lastFetchTime > FETCH_COOLDOWN_MS)) {
        await syncApplicationEmojis(client, true);
    }

    // 2. Repair any stale or deleted <:name:id> / <a:name:id> application emoji references
    let updatedText = text.replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (match, anim, name, id) => {
        // If the ID is still valid in application or guild cache, leave it untouched
        if (client.application?.emojis?.cache?.has(id) || client.emojis?.cache?.has(id)) {
            return match;
        }
        // If the ID was deleted but an active emoji with that name exists, update to the active ID
        const found = matchEmoji(client, name);
        if (found && found.id !== id) {
            return `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
        }
        return match;
    });

    // 3. Resolve :name: to full <:name:id> or <a:name:id>
    updatedText = updatedText.replace(/(?<!<a?):([a-zA-Z0-9_]+):(?!\d+>)/g, (match, name) => {
        const found = matchEmoji(client, name);
        if (found) {
            return `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
        }
        return match;
    });

    return updatedText;
}

const IGNORED_KEYS = new Set([
    'custom_id',
    'customId',
    'id',
    'token',
    'nonce',
    'url',
    'icon_url',
    'proxy_url',
    'avatar_url',
    'banner_url',
    'webhook_id',
    'emoji'
]);

async function resolveEmojisInPayload(client, obj, key = null, parent = null, forceSync = false) {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        if (key && IGNORED_KEYS.has(key)) return obj;
        if (key === 'value' && parent && parent.label !== undefined) return obj;
        if (key === 'name' && parent && parent.id !== undefined && parent.value === undefined) return obj;

        return await resolveEmojisInText(client, obj, forceSync);
    }

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = await resolveEmojisInPayload(client, obj[i], null, obj, forceSync);
        }
        return obj;
    }

    if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
            if (IGNORED_KEYS.has(k)) continue;
            obj[k] = await resolveEmojisInPayload(client, obj[k], k, obj, forceSync);
        }
        return obj;
    }

    return obj;
}

function isMessageRoute(route) {
    if (!route || typeof route !== 'string') return false;
    return (
        route.includes('/messages') ||
        route.includes('/callback') ||
        route.includes('/webhooks/') ||
        route.includes('/threads')
    );
}

function attachEmojiResolver(client) {
    if (!client || !client.rest || client._emojiResolverAttached) return;
    client._emojiResolverAttached = true;

    const originalRequest = client.rest.request.bind(client.rest);
    client.rest.request = async function (options) {
        if (options && options.body && isMessageRoute(options.fullRoute)) {
            try {
                const method = (options.method || 'GET').toUpperCase();
                const isEdit = method === 'PATCH';
                await resolveEmojisInPayload(client, options.body, null, null, isEdit);
            } catch (err) {
                console.error('Error resolving emojis in REST payload:', err);
            }
        }
        return originalRequest(options);
    };
}

async function findEmojiByNameOrId(client, input) {
    if (!input) return null;
    const str = input.trim();

    // Custom format <:name:id> or <a:name:id>
    const customMatch = str.match(/<(a?):([^:]+):(\d+)>/);
    if (customMatch) {
        const id = customMatch[3];
        const name = customMatch[2];
        await syncApplicationEmojis(client, false);
        if (client.application?.emojis?.cache?.has(id) || client.emojis?.cache?.has(id)) {
            return { name, id, animated: customMatch[1] === 'a' };
        }
        const refreshed = matchEmoji(client, name);
        if (refreshed) {
            return { name: refreshed.name, id: refreshed.id, animated: refreshed.animated };
        }
        return { name, id, animated: customMatch[1] === 'a' };
    }

    // Pure ID
    if (/^\d+$/.test(str)) {
        return { id: str };
    }

    // Clean :name: -> name
    const cleanName = str.replace(/^:|:$/g, '');

    await syncApplicationEmojis(client, false);
    let found = matchEmoji(client, cleanName);

    // If not found in cache, pull latest from Discord
    if (!found) {
        await syncApplicationEmojis(client, true);
        found = matchEmoji(client, cleanName);
    }

    if (found) {
        return { name: found.name, id: found.id, animated: found.animated };
    }

    // Fallback: Unicode name or raw string
    return { name: cleanName };
}

function wrapInteraction(interaction) {
    if (!interaction || interaction._emojisWrapped) return interaction;
    interaction._emojisWrapped = true;

    const client = interaction.client;

    if (typeof interaction.reply === 'function') {
        const origReply = interaction.reply.bind(interaction);
        interaction.reply = async function (options) {
            const formatted = await resolveEmojisInPayload(client, options);
            return origReply(formatted);
        };
    }

    if (typeof interaction.editReply === 'function') {
        const origEdit = interaction.editReply.bind(interaction);
        interaction.editReply = async function (options) {
            const formatted = await resolveEmojisInPayload(client, options);
            return origEdit(formatted);
        };
    }

    if (typeof interaction.followUp === 'function') {
        const origFollowUp = interaction.followUp.bind(interaction);
        interaction.followUp = async function (options) {
            const formatted = await resolveEmojisInPayload(client, options);
            return origFollowUp(formatted);
        };
    }

    if (typeof interaction.update === 'function') {
        const origUpdate = interaction.update.bind(interaction);
        interaction.update = async function (options) {
            const formatted = await resolveEmojisInPayload(client, options);
            return origUpdate(formatted);
        };
    }

    return interaction;
}

module.exports = {
    resolveEmojisInText,
    resolveEmojisInPayload,
    resolveEmojisInObject: resolveEmojisInPayload,
    formatEmojisInString: resolveEmojisInText,
    formatPayload: resolveEmojisInPayload,
    wrapInteraction,
    attachEmojiResolver,
    findEmojiByNameOrId,
    getEmojiCollection
};
