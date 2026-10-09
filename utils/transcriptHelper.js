const { AttachmentBuilder } = require("discord.js");
const { ZipArchive } = require("archiver");
const path = require("path");

const STRINGS = {
    noContent: "[No Content]",
};

/**
 * Fetches all messages from a channel, compiles a formatted text transcript,
 * and packages all channel attachments into a ZIP file.
 */
async function generateChannelTranscript(channel) {
    let allMessages = [];
    let lastId = null;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options).catch(() => null);
        if (!messages || messages.size === 0) break;

        allMessages.push(...messages.values());
        lastId = messages.last().id;

        if (messages.size < 100) break;
    }

    allMessages.reverse();

    // Track attachments with numbering: 1, 2, 3...
    let attachmentCounter = 0;
    const allAttachmentsToDownload = [];
    // Map messageId -> array of attachment info
    const messageAttachmentsMap = new Map();

    for (const m of allMessages) {
        if (m.attachments && m.attachments.size > 0) {
            const list = [];
            for (const att of m.attachments.values()) {
                attachmentCounter++;
                const originalName = att.name || "attachment";
                const ext = path.extname(originalName);
                const baseName = path.basename(originalName, ext);
                const zipFilename = `${attachmentCounter}_${baseName}${ext}`;

                const attRecord = {
                    index: attachmentCounter,
                    originalName,
                    zipFilename,
                    url: att.url,
                    size: att.size || 0,
                };
                list.push(attRecord);
                allAttachmentsToDownload.push(attRecord);
            }
            messageAttachmentsMap.set(m.id, list);
        }
    }

    function formatMessageContent(m) {
        const parts = [];
        if (m.content) parts.push(m.content);

        if (m.components) {
            for (const c of m.components) {
                if (c.type === 10 && c.content) {
                    parts.push(c.content);
                } else if (c.components) {
                    for (const sub of c.components) {
                        if (sub.type === 10 && sub.content) parts.push(sub.content);
                    }
                }
            }
        }

        const msgAtts = messageAttachmentsMap.get(m.id);
        if (msgAtts && msgAtts.length > 0) {
            const indices = msgAtts.map((a) => a.index).join(",");
            parts.push(`attachment[${indices}]`);
        }

        return parts.length > 0 ? parts.join(" ") : STRINGS.noContent;
    }

    const participantMap = new Map();
    for (const m of allMessages) {
        if (!m.author || m.author.bot) continue;
        if (!participantMap.has(m.author.id)) {
            const member = m.member || channel.guild?.members?.cache?.get(m.author.id);
            const displayName = member?.nickname || member?.displayName || m.author.globalName || m.author.username;
            participantMap.set(m.author.id, {
                id: m.author.id,
                username: m.author.username,
                name: displayName,
                displayName,
            });
        }
    }

    const lines = allMessages.map((m) => {
        const epoch = Math.floor(m.createdTimestamp / 1000);
        const username = m.author ? m.author.username : "Unknown";
        return `${epoch} ${username}: ${formatMessageContent(m)}`;
    });

    const transcriptText = lines.join("\n");
    const buffer = Buffer.from(transcriptText, "utf-8");
    const filename = `transcript-${channel.name}-${Date.now()}.txt`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });

    // Download attachments and create ZIP buffer if any attachments exist
    let zipBuffer = null;
    let zipFilename = null;
    let zipAttachment = null;

    if (allAttachmentsToDownload.length > 0) {
        try {
            zipBuffer = await createAttachmentsZip(allAttachmentsToDownload);
            if (zipBuffer) {
                zipFilename = `attachments-${channel.name}-${Date.now()}.zip`;
                zipAttachment = new AttachmentBuilder(zipBuffer, { name: zipFilename });
            }
        } catch (err) {
            console.error("[transcriptHelper] Failed to create attachments ZIP:", err);
        }
    }

    return {
        attachment,
        buffer,
        filename,
        zipAttachment,
        zipBuffer,
        zipFilename,
        attachmentCount: allAttachmentsToDownload.length,
        participants: Array.from(participantMap.values()),
    };
}

/**
 * Downloads each attachment and packages them into an in-memory ZIP buffer.
 */
async function createAttachmentsZip(attachmentsList) {
    return new Promise(async (resolve, reject) => {
        const archive = new ZipArchive({ zlib: { level: 9 } });
        const buffers = [];

        archive.on("data", (chunk) => buffers.push(chunk));
        archive.on("end", () => resolve(Buffer.concat(buffers)));
        archive.on("error", (err) => reject(err));

        for (const item of attachmentsList) {
            try {
                const res = await fetch(item.url);
                if (!res.ok) {
                    console.warn(`[transcriptHelper] Failed to download attachment ${item.url}: HTTP ${res.status}`);
                    continue;
                }
                const arrayBuffer = await res.arrayBuffer();
                const fileBuf = Buffer.from(arrayBuffer);
                archive.append(fileBuf, { name: item.zipFilename });
            } catch (err) {
                console.error(`[transcriptHelper] Error downloading attachment ${item.url}:`, err);
            }
        }

        archive.finalize();
    });
}

module.exports = {
    generateChannelTranscript,
};

