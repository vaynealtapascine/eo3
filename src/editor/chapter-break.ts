import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        chapterBreak: {
            /** Inserts a visible chapter-break divider that serializes as `<!-- eo3:split -->`. */
            insertChapterBreak: () => ReturnType;
        };
    }
}

/**
 * Visible chapter-break divider representing `<!-- eo3:split -->` inside the rich text editor.
 * `htmlToEditorContent` / `editorContentToHtml` convert between the HTML comment and
 * `<div data-eo3-split=""></div>` at the boundary so existing splitting code stays unchanged.
 */
export const ChapterBreak = Node.create({
    name: 'chapterBreak',
    priority: 1000,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    parseHTML() {
        return [{ tag: 'div[data-eo3-split]' }];
    },

    renderHTML() {
        return ['div', { 'data-eo3-split': '' }];
    },

    addCommands() {
        return {
            insertChapterBreak:
                () =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name }),
        };
    },
});
