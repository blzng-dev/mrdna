const helpers = require("./helpers");
const logging = require("./logging");
const cards = require("./cards");
const preview = require("./preview");
const forumActions = require("./forumActions");
const channelActions = require("./channelActions");

// Combine STRINGS from all modules for backwards compatibility
const STRINGS = {
    ...logging.STRINGS,
    ...cards.STRINGS,
    ...preview.STRINGS,
    ...forumActions.STRINGS,
    ...channelActions.STRINGS,
};

module.exports = {
    // Strings
    STRINGS,

    // Helpers
    ...helpers,

    // Logging
    ...logging,

    // Cards / UI Builders
    ...cards,

    // Preview Flow
    ...preview,

    // Forum Thread Actions
    ...forumActions,

    // Private Channel Actions
    ...channelActions,
};
