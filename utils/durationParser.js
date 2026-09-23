/**
 * Parses human-readable duration strings into milliseconds.
 * Supports units: s (seconds), m (minutes), h (hours), d (days), w (weeks).
 * Examples: '10s', '15m', '2h', '3d', '1w', '1d 12h', '1d2h30m'
 */
function parseDuration(input) {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim();
    if (!trimmed) return null;

    const regex = /(\d+)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|d(?:ays?)?|w(?:eeks?)?)/gi;
    let match;
    let totalMs = 0;
    let matchCount = 0;

    // Ensure entire string is consumed by valid units and whitespace
    let lastIndex = 0;
    while ((match = regex.exec(trimmed)) !== null) {
        // Check for non-whitespace junk between matches
        const between = trimmed.slice(lastIndex, match.index).trim();
        if (between.length > 0) return null;

        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        if (isNaN(value) || value <= 0) return null;

        if (unit.startsWith('s')) {
            totalMs += value * 1000;
        } else if (unit.startsWith('m')) {
            totalMs += value * 60 * 1000;
        } else if (unit.startsWith('h')) {
            totalMs += value * 60 * 60 * 1000;
        } else if (unit.startsWith('d')) {
            totalMs += value * 24 * 60 * 60 * 1000;
        } else if (unit.startsWith('w')) {
            totalMs += value * 7 * 24 * 60 * 60 * 1000;
        } else {
            return null;
        }

        lastIndex = regex.lastIndex;
        matchCount++;
    }

    // Check for trailing non-whitespace junk
    if (matchCount === 0 || trimmed.slice(lastIndex).trim().length > 0) {
        return null;
    }

    return totalMs;
}

module.exports = {
    parseDuration,
};
