const db = require('../db');
const { endGiveaway } = require('../utils/giveawayHelper');

// 24 days max delay for Node.js setTimeout (32-bit signed int max is ~24.8 days)
const MAX_TIMER_DELAY_MS = 24 * 24 * 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

let discordClient = null;
const activeTimers = new Map();
let isSyncing = false;

function cancelGiveawayTimer(giveawayId) {
    if (!giveawayId) return;
    const timer = activeTimers.get(giveawayId);
    if (timer) {
        clearTimeout(timer);
        activeTimers.delete(giveawayId);
    }
}

async function triggerEndGiveaway(giveaway) {
    cancelGiveawayTimer(giveaway.id);
    if (!discordClient) return;

    try {
        await endGiveaway(discordClient, giveaway, { force: false });
    } catch (err) {
        console.error(`[Giveaway Worker] Error ending giveaway ${giveaway.id}:`, err);
    }
}

function scheduleGiveaway(giveaway) {
    if (!giveaway || !giveaway.id) return;
    cancelGiveawayTimer(giveaway.id);

    const endsAtMs = new Date(giveaway.ends_at).getTime();
    const delay = endsAtMs - Date.now();

    if (delay <= 0) {
        triggerEndGiveaway(giveaway);
        return;
    }

    if (delay <= MAX_TIMER_DELAY_MS) {
        const timer = setTimeout(() => {
            activeTimers.delete(giveaway.id);
            triggerEndGiveaway(giveaway);
        }, delay);
        activeTimers.set(giveaway.id, timer);
    }
}

async function syncGiveaways() {
    if (isSyncing || !discordClient) return;
    isSyncing = true;

    try {
        const { rows: active } = await db.query(
            "SELECT * FROM utility.giveaways WHERE status = 'active' ORDER BY ends_at ASC"
        );

        for (const giveaway of active) {
            const endsAtMs = new Date(giveaway.ends_at).getTime();
            const delay = endsAtMs - Date.now();

            if (delay <= 0) {
                await triggerEndGiveaway(giveaway);
            } else if (!activeTimers.has(giveaway.id)) {
                scheduleGiveaway(giveaway);
            }
        }
    } catch (err) {
        console.error('[Giveaway Worker] Sync query error:', err);
    } finally {
        isSyncing = false;
    }
}

function startGiveawayWorker(client) {
    discordClient = client;
    syncGiveaways();

    const interval = setInterval(syncGiveaways, SYNC_INTERVAL_MS);
    console.log('[Giveaway Worker] Background worker initialized (daily sync + in-memory timers).');
    return interval;
}

startGiveawayWorker.scheduleGiveaway = scheduleGiveaway;
startGiveawayWorker.cancelGiveawayTimer = cancelGiveawayTimer;
startGiveawayWorker.syncGiveaways = syncGiveaways;

module.exports = startGiveawayWorker;
