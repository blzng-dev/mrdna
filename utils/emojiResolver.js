let lastFetchTime = 0;
const FETCH_COOLDOWN_MS = 5000; // 5 seconds throttle

async function getEmojiCollection(client, force = false) {
    const shouldFetch = force || !client.application?.emojis?.cache || client.application.emojis.cache.size === 0;
    if (client.application && shouldFetch) {
        try {
            await client.application.emojis.fetch();
            lastFetchTime = Date.now();
        } catch (_) {}
    }
    return client.application?.emojis?.cache || null;
}

function matchEmoji(client, name) {
    if (!name) return null;
    const lowerName = name.toLowerCase();

    function searchCache(cache) {
        if (!cache) return null;
        if (typeof cache.find === 'function') {
            return cache.find(e => e.name === name) || cache.find(e => e.name?.toLowerCase() === lowerName) || null;
        }
        let caseInsensitiveMatch = null;
        const iterable = typeof cache.values === 'function' ? cache.values() : (Array.isArray(cache) ? cache : []);
        for (const e of iterable) {
            if (e && e.name === name) return e;
            if (e && !caseInsensitiveMatch && e.name?.toLowerCase() === lowerName) {
                caseInsensitiveMatch = e;
            }
        }
        return caseInsensitiveMatch;
    }

    const appFound = searchCache(client.application?.emojis?.cache);
    if (appFound) return appFound;

    const guildFound = searchCache(client.emojis?.cache);
    if (guildFound) return guildFound;

    return null;
}

async function resolveEmojisInText(client, text) {
    if (!text || typeof text !== 'string' || !text.includes(':')) return text;

    await getEmojiCollection(client, false);

    // Check if there are any unmatched emoji names in the text
    const matches = [...text.matchAll(/(?<!<a?):([a-zA-Z0-9_]+):(?!\d+>)/g)];
    const hasUnmatched = matches.some(m => !matchEmoji(client, m[1]));

    // If an emoji is not in cache, automatically fetch the latest emojis from Discord (without restarting!)
    if (hasUnmatched && Date.now() - lastFetchTime > FETCH_COOLDOWN_MS) {
        try {
            await client.application?.emojis?.fetch();
            lastFetchTime = Date.now();
        } catch (_) {}
    }

    return text.replace(/(?<!<a?):([a-zA-Z0-9_]+):(?!\d+>)/g, (match, name) => {
        const found = matchEmoji(client, name);
        if (found) {
            return `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
        }
        return match;
    });
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

async function resolveEmojisInPayload(client, obj, key = null, parent = null) {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        if (key && IGNORED_KEYS.has(key)) return obj;
        if (key === 'value' && parent && parent.label !== undefined) return obj;
        if (key === 'name' && parent && parent.id !== undefined && parent.value === undefined) return obj;

        return await resolveEmojisInText(client, obj);
    }

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = await resolveEmojisInPayload(client, obj[i], null, obj);
        }
        return obj;
    }

    if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
            if (IGNORED_KEYS.has(k)) continue;
            obj[k] = await resolveEmojisInPayload(client, obj[k], k, obj);
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
                await resolveEmojisInPayload(client, options.body);
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
        return { name: customMatch[2], id: customMatch[3], animated: customMatch[1] === 'a' };
    }

    // Pure ID
    if (/^\d+$/.test(str)) {
        return { id: str };
    }

    // Clean :name: -> name
    const cleanName = str.replace(/^:|:$/g, '');

    await getEmojiCollection(client, false);
    let found = matchEmoji(client, cleanName);

    // If not found in cache, pull latest from Discord
    if (!found && Date.now() - lastFetchTime > FETCH_COOLDOWN_MS) {
        try {
            await client.application?.emojis?.fetch();
            lastFetchTime = Date.now();
            found = matchEmoji(client, cleanName);
        } catch (_) {}
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
