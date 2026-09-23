const db = require('../db');
const { endGiveaway } = require('../utils/giveawayHelper');

module.exports = (client) => {
    let isPolling = false;

    async function checkExpiredGiveaways() {
        if (isPolling) return;
        isPolling = true;

        try {
            const { rows: expired } = await db.query(
                "SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= NOW() ORDER BY ends_at ASC"
            );

            for (const giveaway of expired) {
                try {
                    await endGiveaway(client, giveaway);
                } catch (err) {
                    console.error(`[Giveaway Worker] Error drawing giveaway ${giveaway.id}:`, err);
                }
            }
        } catch (err) {
            console.error('[Giveaway Worker] Polling query error:', err);
        } finally {
            isPolling = false;
        }
    }

    // Run check immediately on bot start to catch any that expired while offline
    checkExpiredGiveaways();

    // Check every 15 seconds
    const interval = setInterval(checkExpiredGiveaways, 15 * 1000);

    console.log('[Giveaway Worker] Background worker initialized (polling every 15s).');

    return interval;
};
