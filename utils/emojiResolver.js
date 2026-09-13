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
    const appEmojis = client.application?.emojis?.cache;
    if (appEmojis && appEmojis.size > 0) {
        const found = appEmojis.find(e => e.name === name) || appEmojis.find(e => e.name.toLowerCase() === name.toLowerCase());
        if (found) return found;
    }
    if (client.emojis && client.emojis.cache.size > 0) {
        const found = client.emojis.cache.find(e => e.name === name) || client.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
        if (found) return found;
    }
    return null;
}

async function resolveEmojisInText(client, text) {
    if (!text || !text.includes(':')) return text;

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

module.exports = {
    resolveEmojisInText,
    findEmojiByNameOrId,
    getEmojiCollection
};
