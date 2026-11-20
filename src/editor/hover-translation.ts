import { Node } from '@tiptap/core';

export interface HoverTranslationAttrs {
    original: string;
    translation: string;
    includeParens: boolean;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        hoverTranslation: {
            /** Inserts or replaces a translate-on-hover span at the current selection. */
            setHoverTranslation: (attrs: HoverTranslationAttrs) => ReturnType;
            /** Unwraps a selected translate-on-hover node back to its plain original text. */
            unsetHoverTranslation: () => ReturnType;
        };
    }
}

/**
 * AO3-compatible inline translate-on-hover node:
 * `<span class="fx-translate">Original<span class="fx-translate-tip"><span class="fx-translate-paren"> (</span>Translation<span class="fx-translate-paren">)</span></span></span>`.
 *
 * Being an atomic inline node lets ProseMirror round-trip nested classed spans cleanly without
 * flattening them, while degrading gracefully to `Original (Translation)` in EPUBs, screen readers,
 * and when Creator's Style is turned off on AO3.
 */
export const HoverTranslation = Node.create({
    name: 'hoverTranslation',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    priority: 1000,

    addAttributes() {
        return {
            original: { default: '', renderHTML: () => ({}) },
            translation: { default: '', renderHTML: () => ({}) },
            includeParens: { default: true, renderHTML: () => ({}) },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span.fx-translate',
                priority: 1000,
                getAttrs: (element) => {
                    if (!(element instanceof HTMLElement)) return false;
                    const tip = element.querySelector('.fx-translate-tip');
                    if (!tip) return false;

                    const includeParens = tip.querySelector('.fx-translate-paren') !== null;
                    const tipClone = tip.cloneNode(true) as HTMLElement;
                    tipClone.querySelectorAll('.fx-translate-paren').forEach((el) => el.remove());
                    const translation = tipClone.textContent?.trim() ?? '';

                    const origClone = element.cloneNode(true) as HTMLElement;
                    origClone.querySelectorAll('.fx-translate-tip').forEach((el) => el.remove());
                    const original = origClone.textContent?.trim() ?? '';

                    if (!original && !translation) return false;
                    return { original, translation, includeParens };
                },
            },
        ];
    },

    renderHTML({ node }) {
        const original = String(node.attrs.original ?? '');
        const translation = String(node.attrs.translation ?? '');
        const includeParens = node.attrs.includeParens !== false;

        if (includeParens) {
            return [
                'span',
                { class: 'fx-translate' },
                original,
                [
                    'span',
                    { class: 'fx-translate-tip' },
                    ['span', { class: 'fx-translate-paren' }, ' ('],
                    translation,
                    ['span', { class: 'fx-translate-paren' }, ')'],
                ],
            ];
        }

        return [
            'span',
            { class: 'fx-translate' },
            original,
            ['span', { class: 'fx-translate-tip' }, translation],
        ];
    },

    addCommands() {
        return {
            setHoverTranslation:
                (attrs) =>
                ({ commands }) => {
                    const original = attrs.original.trim();
                    const translation = attrs.translation.trim();
                    if (!original || !translation) return false;
                    return commands.insertContent({
                        type: this.name,
                        attrs: {
                            original,
                            translation,
                            includeParens: attrs.includeParens !== false,
                        },
                    });
                },
            unsetHoverTranslation:
                () =>
                ({ state, commands }) => {
                    const { selection } = state;
                    const selected =
                        'node' in selection &&
                        selection.node &&
                        (
                            selection.node as {
                                type?: { name?: string };
                                attrs?: HoverTranslationAttrs;
                            }
                        ).type?.name === this.name
                            ? (selection.node as { attrs: HoverTranslationAttrs })
                            : null;
                    if (!selected) return false;
                    return commands.insertContent(selected.attrs.original || '');
                },
        };
    },
});
