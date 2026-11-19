import { Extension, mergeAttributes, Node } from '@tiptap/core';

export type TextDirection = 'ltr' | 'rtl' | null;

const CLASS_AND_DIR_TYPES = [
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'listItem',
    'horizontalRule',
    'styledBlock',
    'details',
    'textStyle',
];

const DIRECTION_TYPES = [
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'styledBlock',
];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        ao3Attributes: {
            /** Sets or clears `dir` (`ltr` / `rtl`) on the active block elements. */
            setTextDirection: (dir: TextDirection) => ReturnType;
        };
    }
}

/**
 * Preserves AO3-allowed `class` and `dir` attributes across rich-text round-trips (essential for
 * Work Skin styles, CSS pieces, and RTL/LTR writing), and exposes a direction command.
 */
export const Ao3Attributes = Extension.create({
    name: 'ao3Attributes',

    addGlobalAttributes() {
        return [
            {
                types: CLASS_AND_DIR_TYPES,
                attributes: {
                    class: {
                        default: null,
                        parseHTML: (element) => element.getAttribute('class') || null,
                        renderHTML: (attributes) =>
                            attributes.class ? { class: attributes.class } : {},
                    },
                    dir: {
                        default: null,
                        parseHTML: (element) => {
                            const dir = element.getAttribute('dir')?.toLowerCase();
                            return dir === 'ltr' || dir === 'rtl' ? dir : null;
                        },
                        renderHTML: (attributes) => (attributes.dir ? { dir: attributes.dir } : {}),
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            setTextDirection:
                (dir) =>
                ({ commands }) =>
                    DIRECTION_TYPES.some((type) => commands.updateAttributes(type, { dir })),
        };
    },
});

/**
 * Preserves styled or classed `<div class="..." style="...">` block containers (used by Work Skins,
 * imported AO3 chapters, and upcoming CSS-piece wrappers). Plain unstyled `<div>` elements are not
 * matched so pasted HTML normalizes cleanly into paragraphs.
 */
export const StyledBlock = Node.create({
    name: 'styledBlock',
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes() {
        return {
            style: {
                default: null,
                parseHTML: (element) => element.getAttribute('style') || null,
                renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div',
                getAttrs: (element) => {
                    if (!(element instanceof HTMLElement)) return false;
                    if (element.hasAttribute('data-eo3-split')) return false;
                    if (
                        !element.getAttribute('class') &&
                        !element.getAttribute('style') &&
                        !element.getAttribute('dir')
                    ) {
                        return false;
                    }
                    return {};
                },
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes), 0];
    },
});

/** Preserves AO3-allowed `<details>` collapsible containers. */
export const Details = Node.create({
    name: 'details',
    group: 'block',
    content: 'detailsSummary block+',
    defining: true,

    addAttributes() {
        return {
            open: {
                default: null,
                parseHTML: (element) => (element.hasAttribute('open') ? '' : null),
                renderHTML: (attributes) => (attributes.open !== null ? { open: '' } : {}),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'details' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['details', mergeAttributes(HTMLAttributes), 0];
    },
});

/** Heading element inside `<details>`. */
export const DetailsSummary = Node.create({
    name: 'detailsSummary',
    content: 'inline*',
    defining: true,

    parseHTML() {
        return [{ tag: 'summary' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['summary', mergeAttributes(HTMLAttributes), 0];
    },
});
