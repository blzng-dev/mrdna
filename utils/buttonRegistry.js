/**
 * Registry of interactive button actions supported by the bot.
 * Centralized so parser, context menus, and interaction handlers stay unified.
 */
const BUTTON_ACTIONS = [
    {
        id: "ticket_open",
        label: "Open Ticket",
        description: "Opens the ticket creation modal",
    },
];

const BUTTON_STYLES = [
    { label: "Primary (Blurple)", value: "1" },
    { label: "Secondary (Grey)", value: "2" },
    { label: "Success (Green)", value: "3" },
    { label: "Danger (Red)", value: "4" },
];

module.exports = {
    BUTTON_ACTIONS,
    BUTTON_STYLES,
};
