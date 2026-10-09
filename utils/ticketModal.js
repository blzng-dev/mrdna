const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    UserSelectMenuBuilder,
    FileUploadBuilder,
} = require("discord.js");

const STRINGS = {
    modal: {
        id: "ticket_creation_modal",
        title: "Create Support Ticket",
        subject: {
            id: "ticket_subject",
            label: "Subject",
            description: "What is this ticket for?",
            placeholder: "E.g., Report issue, Host event / giveaway, Support",
            maxLength: 100,
            required: false,
        },
        body: {
            id: "ticket_body",
            label: "Body",
            description:
                "Provide all information the staff will need to assist you",
            placeholder: "Include any relevant information, links, or context",
            minLength: 10,
            maxLength: 2000,
            required: true,
        },
        involvedUsers: {
            id: "ticket_users",
            label: "Involved Users",
            description: "Tag other users involved (if any)",
            placeholder: "Select users",
            minValues: 0,
            maxValues: 10,
            required: false,
        },
        attachments: {
            id: "ticket_files",
            label: "Attachments",
            description:
                "Upload screenshots, images and other attachments (if any)",
            minValues: 0,
            maxValues: 10,
            required: false,
        },
    },
};

function buildTicketModal() {
    const modal = new ModalBuilder()
        .setCustomId(STRINGS.modal.id)
        .setTitle(STRINGS.modal.title);

    // 1. Subject (Short text)
    const subjectInput = new TextInputBuilder()
        .setCustomId(STRINGS.modal.subject.id)
        .setStyle(TextInputStyle.Short)
        .setRequired(STRINGS.modal.subject.required)
        .setMaxLength(STRINGS.modal.subject.maxLength);

    if (
        STRINGS.modal.subject.placeholder &&
        STRINGS.modal.subject.placeholder.trim()
    ) {
        subjectInput.setPlaceholder(STRINGS.modal.subject.placeholder.trim());
    }

    const subjectLabel = new LabelBuilder();
    if (STRINGS.modal.subject.label && STRINGS.modal.subject.label.trim()) {
        subjectLabel.setLabel(STRINGS.modal.subject.label.trim());
    }
    if (
        STRINGS.modal.subject.description &&
        STRINGS.modal.subject.description.trim()
    ) {
        subjectLabel.setDescription(STRINGS.modal.subject.description.trim());
    }
    subjectLabel.setTextInputComponent(subjectInput);

    // 2. Body (Paragraph text)
    const bodyInput = new TextInputBuilder()
        .setCustomId(STRINGS.modal.body.id)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(STRINGS.modal.body.required)
        .setMinLength(STRINGS.modal.body.minLength)
        .setMaxLength(STRINGS.modal.body.maxLength);

    if (
        STRINGS.modal.body.placeholder &&
        STRINGS.modal.body.placeholder.trim()
    ) {
        bodyInput.setPlaceholder(STRINGS.modal.body.placeholder.trim());
    }

    const bodyLabel = new LabelBuilder();
    if (STRINGS.modal.body.label && STRINGS.modal.body.label.trim()) {
        bodyLabel.setLabel(STRINGS.modal.body.label.trim());
    }
    if (
        STRINGS.modal.body.description &&
        STRINGS.modal.body.description.trim()
    ) {
        bodyLabel.setDescription(STRINGS.modal.body.description.trim());
    }
    bodyLabel.setTextInputComponent(bodyInput);

    // 3. Involved Users (User select menu)
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId(STRINGS.modal.involvedUsers.id)
        .setRequired(STRINGS.modal.involvedUsers.required)
        .setMinValues(STRINGS.modal.involvedUsers.minValues)
        .setMaxValues(STRINGS.modal.involvedUsers.maxValues);

    if (
        STRINGS.modal.involvedUsers.placeholder &&
        STRINGS.modal.involvedUsers.placeholder.trim()
    ) {
        userSelect.setPlaceholder(
            STRINGS.modal.involvedUsers.placeholder.trim(),
        );
    }

    const usersLabel = new LabelBuilder();
    if (
        STRINGS.modal.involvedUsers.label &&
        STRINGS.modal.involvedUsers.label.trim()
    ) {
        usersLabel.setLabel(STRINGS.modal.involvedUsers.label.trim());
    }
    if (
        STRINGS.modal.involvedUsers.description &&
        STRINGS.modal.involvedUsers.description.trim()
    ) {
        usersLabel.setDescription(
            STRINGS.modal.involvedUsers.description.trim(),
        );
    }
    usersLabel.setUserSelectMenuComponent(userSelect);

    // 4. Attachments (File upload)
    const fileUpload = new FileUploadBuilder()
        .setCustomId(STRINGS.modal.attachments.id)
        .setRequired(STRINGS.modal.attachments.required)
        .setMinValues(STRINGS.modal.attachments.minValues)
        .setMaxValues(STRINGS.modal.attachments.maxValues);

    const filesLabel = new LabelBuilder();
    if (
        STRINGS.modal.attachments.label &&
        STRINGS.modal.attachments.label.trim()
    ) {
        filesLabel.setLabel(STRINGS.modal.attachments.label.trim());
    }
    if (
        STRINGS.modal.attachments.description &&
        STRINGS.modal.attachments.description.trim()
    ) {
        filesLabel.setDescription(STRINGS.modal.attachments.description.trim());
    }
    filesLabel.setFileUploadComponent(fileUpload);

    modal.addComponents(subjectLabel, bodyLabel, usersLabel, filesLabel);
    return modal;
}

module.exports = {
    STRINGS,
    TICKET_MODAL_ID: STRINGS.modal.id,
    buildTicketModal,
};
