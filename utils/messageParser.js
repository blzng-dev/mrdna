function parseTextAndSeparators(rawText, allMediaItems, usedIndices) {
    const lines = rawText.split(/\r?\n/);
    const components = [];
    let currentTextLines = [];

    function flushText() {
        const text = currentTextLines.join('\n').trim();
        if (text.length > 0) {
            components.push({
                type: 10,
                content: text
            });
        }
        currentTextLines = [];
    }

    for (const line of lines) {
        const trimmed = line.trim();
        const sepMatch = trimmed.match(/^(\d+)?---(true|false)?$/);
        const mediaMatch = trimmed.match(/^-media(?:\[(.*?)\])?$/);

        if (sepMatch) {
            flushText();
            const sizeStr = sepMatch[1];
            const divStr = sepMatch[2];
            const spacing = sizeStr ? parseInt(sizeStr, 10) : 1;
            const divider = divStr === 'false' ? false : true;
            components.push({
                type: 14,
                divider: divider,
                spacing: spacing
            });
        } else if (mediaMatch) {
            flushText();
            if (allMediaItems && allMediaItems.length > 0) {
                let galleryItems = [];
                if (mediaMatch[1]) {
                    const matches = [...mediaMatch[1].matchAll(/(\d+)(?:\s*:\s*"([^"]*)")?/g)];
                    for (const m of matches) {
                        const idx = parseInt(m[1], 10) - 1;
                        const alt = m[2];
                        if (!isNaN(idx) && allMediaItems[idx] && !usedIndices.has(idx)) {
                            const itemCopy = JSON.parse(JSON.stringify(allMediaItems[idx]));
                            if (alt) {
                                if (!itemCopy.media) itemCopy.media = {};
                                itemCopy.media.description = alt;
                            }
                            galleryItems.push(itemCopy);
                            usedIndices.add(idx);
                        }
                    }
                } else {
                    for (let i = 0; i < allMediaItems.length; i++) {
                        if (!usedIndices.has(i)) {
                            galleryItems.push(JSON.parse(JSON.stringify(allMediaItems[i])));
                            usedIndices.add(i);
                        }
                    }
                }
                if (galleryItems.length > 0) {
                    components.push({
                        type: 12,
                        items: galleryItems.slice(0, 10)
                    });
                }
            }
        } else {
            currentTextLines.push(line);
        }
    }
    flushText();
    return components;
}

function parseComponents(rawText, allMediaItems) {
    const usedIndices = new Set();
    const components = [];
    const lines = rawText.split(/\r?\n/);

    let insideContainer = false;
    let containerHeader = '';
    let containerLines = [];
    let outsideLines = [];

    function flushOutside() {
        if (outsideLines.length > 0) {
            const text = outsideLines.join('\n');
            if (text.trim().length > 0) {
                components.push(...parseTextAndSeparators(text, allMediaItems, usedIndices));
            }
            outsideLines = [];
        }
    }

    function flushContainer() {
        if (containerLines.length > 0) {
            const text = containerLines.join('\n');
            const innerComponents = parseTextAndSeparators(text, allMediaItems, usedIndices);
            if (innerComponents.length > 0) {
                const container = {
                    type: 17,
                    components: innerComponents
                };
                if (containerHeader) {
                    const hexMatch = containerHeader.match(/#?([0-9a-fA-F]{6})/);
                    if (hexMatch) {
                        container.accent_color = parseInt(hexMatch[1], 16);
                    }
                    if (/\bspoiler\b/i.test(containerHeader)) {
                        container.spoiler = true;
                    }
                }
                components.push(container);
            }
            containerLines = [];
            containerHeader = '';
        }
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!insideContainer && trimmed.startsWith('c---')) {
            flushOutside();
            insideContainer = true;
            containerHeader = trimmed.slice(4).trim();
            containerLines = [];
        } else if (insideContainer && (trimmed === '/c---' || trimmed === 'c---')) {
            flushContainer();
            insideContainer = false;
        } else if (insideContainer) {
            containerLines.push(line);
        } else {
            outsideLines.push(line);
        }
    }

    if (insideContainer) {
        flushContainer();
    } else {
        flushOutside();
    }

    if (allMediaItems && allMediaItems.length > 0) {
        const remainingItems = [];
        for (let i = 0; i < allMediaItems.length; i++) {
            if (!usedIndices.has(i)) {
                remainingItems.push(JSON.parse(JSON.stringify(allMediaItems[i])));
                usedIndices.add(i);
            }
        }
        if (remainingItems.length > 0) {
            components.push({
                type: 12,
                items: remainingItems.slice(0, 10)
            });
        }
    }

    return components;
}

function reconstructText(components) {
    let globalImageCounter = 0;

    function formatTextAndSeparators(comps) {
        let res = '';
        for (const comp of comps) {
            if (comp.type === 10) {
                res += (res.length > 0 && !res.endsWith('\n') ? '\n' : '') + comp.content;
            } else if (comp.type === 14) {
                const spacing = comp.spacing !== undefined ? comp.spacing : 1;
                const divider = comp.divider !== undefined ? comp.divider : true;
                const spacingStr = spacing !== 1 ? spacing.toString() : '';
                const divStrFinal = divider === false ? 'false' : '';
                res += '\n' + spacingStr + '---' + divStrFinal + '\n';
            } else if (comp.type === 12 && comp.items) {
                const indices = [];
                for (let i = 0; i < comp.items.length; i++) {
                    globalImageCounter++;
                    if (comp.items[i].media && comp.items[i].media.description) {
                        indices.push(`${globalImageCounter}:"${comp.items[i].media.description}"`);
                    } else {
                        indices.push(globalImageCounter);
                    }
                }
                res += (res.length > 0 && !res.endsWith('\n') ? '\n' : '') + `-media[${indices.join(', ')}]\n`;
            }
        }
        return res;
    }

    let text = '';
    for (const comp of components) {
        if (comp.type === 10) {
            text += (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + comp.content;
        } else if (comp.type === 14) {
            const spacing = comp.spacing !== undefined ? comp.spacing : 1;
            const divider = comp.divider !== undefined ? comp.divider : true;
            const spacingStr = spacing !== 1 ? spacing.toString() : '';
            const divStrFinal = divider === false ? 'false' : '';
            text += '\n' + spacingStr + '---' + divStrFinal + '\n';
        } else if (comp.type === 12 && comp.items) {
            const indices = [];
            for (let i = 0; i < comp.items.length; i++) {
                globalImageCounter++;
                if (comp.items[i].media && comp.items[i].media.description) {
                    indices.push(`${globalImageCounter}:"${comp.items[i].media.description}"`);
                } else {
                    indices.push(globalImageCounter);
                }
            }
            text += (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + `-media[${indices.join(', ')}]\n`;
        } else if (comp.type === 17 && comp.components) {
            let header = 'c---';
            if (comp.accent_color !== undefined && comp.accent_color !== null) {
                header += '#' + comp.accent_color.toString(16).padStart(6, '0').toUpperCase();
            }
            if (comp.spoiler) {
                header += (header.length > 4 ? ' ' : '') + 'spoiler';
            }
            const innerText = formatTextAndSeparators(comp.components);
            text += (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + header + '\n' + innerText.trim() + '\n/c---\n';
        }
    }
    return text.trim();
}

function collectAllMediaItems(components) {
    if (!components) return [];
    let list = [];
    for (const comp of components) {
        if (comp.type === 12 && comp.items) {
            list.push(...comp.items);
        } else if (comp.type === 17 && comp.components) {
            list.push(...collectAllMediaItems(comp.components));
        }
    }
    return list;
}

function countGalleriesAndItems(components) {
    let galleryCount = 0;
    let totalItems = 0;
    const galleryInfo = [];

    function traverse(comps) {
        if (!comps) return;
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                galleryCount++;
                totalItems += comp.items.length;
                galleryInfo.push({
                    galleryNumber: galleryCount,
                    itemCount: comp.items.length
                });
            } else if (comp.type === 17 && comp.components) {
                traverse(comp.components);
            }
        }
    }

    traverse(components);
    return { galleryCount, totalItems, galleryInfo };
}

function insertMediaIntoComponents(components, targetChoice, positionChoice, newMediaItems) {
    let currentGalleryIndex = 0;

    function insertIntoArray(existing, newItems, pos) {
        if (pos === 'start' || pos === '1') {
            return [...newItems, ...existing].slice(0, 10);
        }
        if (pos === 'end' || isNaN(Number(pos))) {
            return [...existing, ...newItems].slice(0, 10);
        }
        const insertIdx = Math.min(Math.max(0, Number(pos) - 1), existing.length);
        return [...existing.slice(0, insertIdx), ...newItems, ...existing.slice(insertIdx)].slice(0, 10);
    }

    function traverse(comps) {
        const result = [];
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                currentGalleryIndex++;
                if (targetChoice === `${currentGalleryIndex}`) {
                    const mergedItems = insertIntoArray(comp.items, newMediaItems, positionChoice);
                    result.push({
                        ...comp,
                        items: mergedItems
                    });
                } else {
                    result.push(comp);
                }
            } else if (comp.type === 17 && comp.components) {
                result.push({
                    ...comp,
                    components: traverse(comp.components)
                });
            } else {
                result.push(comp);
            }
        }
        return result;
    }

    if (targetChoice === 'new') {
        const updated = traverse(components);
        const newGallery = {
            type: 12,
            items: newMediaItems.slice(0, 10)
        };
        if (positionChoice === 'start' || positionChoice === '1') {
            updated.unshift(newGallery);
        } else if (positionChoice === 'end' || isNaN(Number(positionChoice))) {
            updated.push(newGallery);
        } else {
            const insertIdx = Math.min(Math.max(0, Number(positionChoice) - 1), updated.length);
            updated.splice(insertIdx, 0, newGallery);
        }
        return updated;
    }

    return traverse(components);
}

function removeMediaFromComponents(components, selectedIndices) {
    let globalIndex = 0;
    const selectedSet = new Set(selectedIndices);

    function processItems(items) {
        const remaining = [];
        for (const item of items) {
            globalIndex++;
            if (!selectedSet.has(globalIndex)) {
                remaining.push(item);
            }
        }
        return remaining;
    }

    function traverse(comps) {
        const result = [];
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                const filtered = processItems(comp.items);
                if (filtered.length > 0) {
                    result.push({ ...comp, items: filtered });
                }
            } else if (comp.type === 17 && comp.components) {
                const inner = traverse(comp.components);
                if (inner.length > 0) {
                    result.push({ ...comp, components: inner });
                }
            } else {
                result.push(comp);
            }
        }
        return result;
    }

    return traverse(components);
}

function replaceMediaInComponents(components, selectedIndices, newMediaItems) {
    let globalIndex = 0;
    let replacementIndex = 0;
    const selectedSet = new Set(selectedIndices);

    function processItems(items) {
        const newItems = [];
        for (const item of items) {
            globalIndex++;
            if (selectedSet.has(globalIndex)) {
                if (replacementIndex < newMediaItems.length) {
                    newItems.push(newMediaItems[replacementIndex]);
                    replacementIndex++;
                }
            } else {
                newItems.push(item);
            }
        }
        return newItems;
    }

    function traverse(comps) {
        const result = [];
        for (const comp of comps) {
            if (comp.type === 12 && comp.items) {
                const processed = processItems(comp.items);
                if (processed.length > 0) {
                    result.push({ ...comp, items: processed });
                }
            } else if (comp.type === 17 && comp.components) {
                const inner = traverse(comp.components);
                if (inner.length > 0) {
                    result.push({ ...comp, components: inner });
                }
            } else {
                result.push(comp);
            }
        }
        return result;
    }

    let updated = traverse(components);

    if (replacementIndex < newMediaItems.length) {
        const extras = newMediaItems.slice(replacementIndex);
        let attached = false;
        for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].type === 12) {
                updated[i].items.push(...extras);
                attached = true;
                break;
            }
        }
        if (!attached) {
            updated.push({ type: 12, items: extras });
        }
    }

    return updated;
}

module.exports = {
    parseComponents,
    parseTextAndSeparators,
    reconstructText,
    collectAllMediaItems,
    countGalleriesAndItems,
    insertMediaIntoComponents,
    removeMediaFromComponents,
    replaceMediaInComponents
};
