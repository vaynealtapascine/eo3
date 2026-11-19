import { Node } from '@tiptap/core';

export interface RubyAttrs {
    base: string;
    ruby: string;
    useRp: boolean;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        ruby: {
            /** Inserts or replaces a `<ruby>` annotation at the current selection. */
            setRuby: (attrs: RubyAttrs) => ReturnType;
            /** Unwraps a selected `<ruby>` node back to its plain base text. */
            unsetRuby: () => ReturnType;
        };
    }
}

/**
 * AO3-compatible `<ruby>` inline atomic node (e.g. furigana). Being an atomic inline node makes
 * nested `<ruby>` elements structurally impossible in the document schema.
 */
export const Ruby = Node.create({
    name: 'ruby',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            base: { default: '', renderHTML: () => ({}) },
            ruby: { default: '', renderHTML: () => ({}) },
            useRp: { default: true, renderHTML: () => ({}) },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'ruby',
                getAttrs: (element) => {
                    if (!(element instanceof HTMLElement)) return false;
                    const rt = element.querySelector('rt');
                    const ruby = rt?.textContent ?? '';
                    const clone = element.cloneNode(true) as HTMLElement;
                    clone.querySelectorAll('rt, rp').forEach((child) => child.remove());
                    const base = clone.textContent?.trim() ?? '';
                    if (!base && !ruby) return false;
                    return {
                        base,
                        ruby,
                        useRp: element.querySelector('rp') !== null,
                    };
                },
            },
        ];
    },

    renderHTML({ node }) {
        const base = String(node.attrs.base ?? '');
        const ruby = String(node.attrs.ruby ?? '');
        const useRp = node.attrs.useRp !== false;
        if (useRp) {
            return ['ruby', {}, base, ['rp', {}, '('], ['rt', {}, ruby], ['rp', {}, ')']];
        }
        return ['ruby', {}, base, ['rt', {}, ruby]];
    },

    addCommands() {
        return {
            setRuby:
                (attrs) =>
                ({ commands }) => {
                    const base = attrs.base.trim();
                    const ruby = attrs.ruby.trim();
                    if (!base || !ruby) return false;
                    return commands.insertContent({
                        type: this.name,
                        attrs: { base, ruby, useRp: attrs.useRp },
                    });
                },
            unsetRuby:
                () =>
                ({ state, commands }) => {
                    const { selection } = state;
                    const selected =
                        'node' in selection &&
                        selection.node &&
                        (selection.node as { type?: { name?: string }; attrs?: RubyAttrs }).type
                            ?.name === this.name
                            ? (selection.node as { attrs: RubyAttrs })
                            : null;
                    if (!selected) return false;
                    return commands.insertContent(selected.attrs.base || '');
                },
        };
    },
});
