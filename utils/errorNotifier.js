const { WebhookClient } = require("discord.js");

const rawUrls = process.env.ERROR_WEBHOOK_URLS || process.env.ERROR_WEBHOOK_URL || "";
const webhookUrls = rawUrls
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

const webhookClients = [];
for (const url of webhookUrls) {
    try {
        webhookClients.push(new WebhookClient({ url }));
    } catch (err) {
        console.error(`Failed to initialize error webhook for ${url}:`, err);
    }
}

// Rate limit identical errors within 10 seconds
const recentErrors = new Map();

async function notifyError(error, context = "Process Error") {
    console.error(`[${context}]`, error);
    if (webhookClients.length === 0) return;

    try {
        const errorKey = `${context}:${error?.message || error}`;
        const now = Date.now();
        const lastSeen = recentErrors.get(errorKey);
        if (lastSeen && now - lastSeen < 10000) {
            return;
        }
        recentErrors.set(errorKey, now);

        // Clean up cache
        if (recentErrors.size > 100) {
            for (const [k, time] of recentErrors.entries()) {
                if (now - time > 60000) recentErrors.delete(k);
            }
        }

        const stack = error?.stack || String(error);
        const header = `### [ERROR] ${context}\n-# <t:${Math.floor(now / 1000)}:R> <t:${Math.floor(now / 1000)}:t>`;
        const maxCodeLen = 2000 - header.length - 25;
        const trimmedStack = stack.length > maxCodeLen ? stack.substring(0, maxCodeLen) + "\n..." : stack;

        const payload = {
            content: `${header}\n\`\`\`javascript\n${trimmedStack}\n\`\`\``,
            allowedMentions: { parse: [] },
        };

        await Promise.allSettled(webhookClients.map((client) => client.send(payload)));
    } catch (err) {
        console.error("Error sending notification to webhooks:", err);
    }
}

module.exports = {
    notifyError,
};
