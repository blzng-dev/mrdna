async function getEmojiCollection(client) {
    if (client.application && (!client.application.emojis.cache || client.application.emojis.cache.size === 0)) {
        try {
            await client.application.emojis.fetch();
        } catch (_) {}
    }
    return client.application?.emojis?.cache || null;
}

async function resolveEmojisInText(client, text) {
    if (!text || !text.includes(':')) return text;

    const appEmojis = await getEmojiCollection(client);

    return text.replace(/(?<!<a?):([a-zA-Z0-9_]+):(?!\d+>)/g, (match, name) => {
        if (appEmojis && appEmojis.size > 0) {
            const found = appEmojis.find(e => e.name === name) || appEmojis.find(e => e.name.toLowerCase() === name.toLowerCase());
            if (found) {
                return `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
            }
        }
        if (client.emojis && client.emojis.cache.size > 0) {
            const found = client.emojis.cache.find(e => e.name === name) || client.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
            if (found) {
                return `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
            }
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

    const appEmojis = await getEmojiCollection(client);
    if (appEmojis && appEmojis.size > 0) {
        const found = appEmojis.find(e => e.name === cleanName) || appEmojis.find(e => e.name.toLowerCase() === cleanName.toLowerCase());
        if (found) {
            return { name: found.name, id: found.id, animated: found.animated };
        }
    }

    if (client.emojis && client.emojis.cache.size > 0) {
        const found = client.emojis.cache.find(e => e.name === cleanName) || client.emojis.cache.find(e => e.name.toLowerCase() === cleanName.toLowerCase());
        if (found) {
            return { name: found.name, id: found.id, animated: found.animated };
        }
    }

    // Fallback: Unicode name or raw string
    return { name: cleanName };
}

module.exports = {
    resolveEmojisInText,
    findEmojiByNameOrId,
    getEmojiCollection
};
