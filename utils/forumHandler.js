const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');

const forumDrafts = new Map();

// Clean up expired drafts every minute (TTL: 15 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, d] of forumDrafts.entries()) {
        if (now - d.createdAt > 15 * 60 * 1000) {
            forumDrafts.delete(id);
        }
    }
}, 60 * 1000);

function buildForumSetupPayload(draft, forumChannel) {
    const rows = [];

    // Tag selector row (if forum channel has configured tags)
    if (forumChannel.availableTags && forumChannel.availableTags.length > 0) {
        const tagOptions = forumChannel.availableTags.slice(0, 25).map(tag => {
            const opt = new StringSelectMenuOptionBuilder()
                .setLabel(tag.name.substring(0, 100))
                .setValue(tag.id)
                .setDefault(draft.tags.includes(tag.id));
            if (tag.emoji) {
                if (tag.emoji.id) {
                    opt.setEmoji(tag.emoji.id);
                } else if (tag.emoji.name) {
                    opt.setEmoji(tag.emoji.name);
                }
            }
            return opt;
        });

        const tagSelect = new StringSelectMenuBuilder()
            .setCustomId(`forum_tag_${draft.id}`)
            .setPlaceholder('Select tags')
            .setMinValues(0)
            .setMaxValues(Math.min(5, tagOptions.length))
            .addOptions(tagOptions);

        rows.push(new ActionRowBuilder().addComponents(tagSelect));
    }

    // Action buttons row
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`forum_title_btn_${draft.id}`)
            .setLabel(draft.title ? 'Edit Title' : 'Set Title')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`forum_confirm_${draft.id}`)
            .setLabel('Confirm & Post')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`forum_cancel_${draft.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );
    rows.push(btnRow);

    return {
        content: `Post Title: ${draft.title || ''}`,
        embeds: [],
        components: rows
    };
}

function createForumDraft({ id, userId, targetChannel, components, files, allowedMentions, defaultTitle, oldMessageId, oldChannelId }) {
    const draft = {
        id,
        userId,
        channelId: targetChannel.id,
        title: defaultTitle || '',
        tags: [],
        components,
        files: files || [],
        allowedMentions: allowedMentions || { parse: [] },
        oldMessageId: oldMessageId || null,
        oldChannelId: oldChannelId || null,
        createdAt: Date.now()
    };
    forumDrafts.set(id, draft);
    return buildForumSetupPayload(draft, targetChannel);
}

async function handleForumButton(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('forum_title_btn_')) {
        const draftId = customId.replace('forum_title_btn_', '');
        const draft = forumDrafts.get(draftId);
        if (!draft) {
            return interaction.reply({
                content: 'This draft has expired or is no longer valid.',
                flags: MessageFlags.Ephemeral
            });
        }

        const titleInput = new TextInputBuilder()
            .setCustomId('forum_post_title')
            .setLabel('Post Title')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setValue(draft.title || '')
            .setPlaceholder('Enter a title for the forum post');

        const modal = new ModalBuilder()
            .setCustomId(`forum_title_modal_${draftId}`)
            .setTitle('Set Forum Post Title')
            .addComponents(new ActionRowBuilder().addComponents(titleInput));

        return interaction.showModal(modal);
    }

    if (customId.startsWith('forum_confirm_')) {
        const draftId = customId.replace('forum_confirm_', '');
        const draft = forumDrafts.get(draftId);
        if (!draft) {
            return interaction.reply({
                content: 'This draft has expired or is no longer valid.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!draft.title || !draft.title.trim()) {
            return interaction.reply({
                content: 'Please click "Set Title" and enter a post title before publishing.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferUpdate();

        try {
            const forumChannel = await interaction.client.channels.fetch(draft.channelId);
            const thread = await forumChannel.threads.create({
                name: draft.title.trim().substring(0, 100),
                appliedTags: draft.tags && draft.tags.length > 0 ? draft.tags : undefined,
                message: {
                    components: draft.components,
                    files: draft.files,
                    flags: MessageFlags.IsComponentsV2 || (1 << 15),
                    allowedMentions: draft.allowedMentions
                }
            });

            // If this was moving an existing message, delete the old message
            if (draft.oldMessageId && draft.oldChannelId) {
                try {
                    const oldChannel = await interaction.client.channels.fetch(draft.oldChannelId);
                    const oldMsg = await oldChannel.messages.fetch(draft.oldMessageId);
                    await oldMsg.delete();
                } catch (delErr) {
                    console.warn('Failed to delete old message during move to forum:', delErr);
                }
            }

            forumDrafts.delete(draftId);

            await interaction.editReply({
                embeds: [],
                components: [],
                content: `Forum post "${draft.title}" created in <#${forumChannel.id}>: ${thread.url}`
            });
        } catch (error) {
            console.error(error);
            await interaction.followUp({
                content: `Failed to create forum post: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    if (customId.startsWith('forum_cancel_')) {
        const draftId = customId.replace('forum_cancel_', '');
        forumDrafts.delete(draftId);
        await interaction.update({
            embeds: [],
            components: [],
            content: 'Forum post creation cancelled.'
        });
        return;
    }
}

async function handleForumTagSelect(interaction) {
    const draftId = interaction.customId.replace('forum_tag_', '');
    const draft = forumDrafts.get(draftId);
    if (!draft) {
        return interaction.reply({
            content: 'This draft has expired or is no longer valid.',
            flags: MessageFlags.Ephemeral
        });
    }

    draft.tags = interaction.values || [];
    const forumChannel = await interaction.client.channels.fetch(draft.channelId);
    const payload = buildForumSetupPayload(draft, forumChannel);
    await interaction.update(payload);
}

async function handleForumTitleModal(interaction) {
    const draftId = interaction.customId.replace('forum_title_modal_', '');
    const draft = forumDrafts.get(draftId);
    if (!draft) {
        return interaction.reply({
            content: 'This draft has expired or is no longer valid.',
            flags: MessageFlags.Ephemeral
        });
    }

    let title = '';
    try {
        title = interaction.fields.getTextInputValue('forum_post_title');
    } catch {
        const tf = interaction.fields?.fields?.get('forum_post_title');
        title = tf?.value || '';
    }

    draft.title = title.trim();
    const forumChannel = await interaction.client.channels.fetch(draft.channelId);
    const payload = buildForumSetupPayload(draft, forumChannel);
    await interaction.update(payload);
}

module.exports = {
    createForumDraft,
    handleForumButton,
    handleForumTagSelect,
    handleForumTitleModal
};
