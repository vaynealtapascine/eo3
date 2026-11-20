import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Placeholder } from '@tiptap/extensions';
import { ChapterBreak } from './chapter-break';
import { HoverTranslation } from './hover-translation';
import { Ruby } from './ruby';
import { Ao3Attributes, Details, DetailsSummary, StyledBlock, StyledSpan } from './ao3-attributes';

export interface Eo3ExtensionOptions {
    placeholder?: string;
}

/**
 * Framework-agnostic TipTap / ProseMirror extension set tailored for eo3 & AO3 HTML.
 * Keeps markup clean (no bogus `target="_blank"` or `rel` noise AO3 strips/rewrites) and preserves
 * `class`, `dir`, `<ruby>`, `<details>`, styled `<div>` blocks, `<span class="...">`, hover
 * translations, and `<!-- eo3:split -->` markers.
 */
export function createEo3Extensions(options: Eo3ExtensionOptions = {}): Extensions {
    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3, 4, 5, 6] },
            link: {
                openOnClick: false,
                autolink: true,
                HTMLAttributes: {
                    rel: null,
                    target: null,
                },
            },
        }),
        TextStyle,
        Color,
        BackgroundColor,
        TextAlign.configure({
            types: ['heading', 'paragraph'],
        }),
        Image.configure({
            inline: true,
            allowBase64: false,
        }),
        Subscript,
        Superscript,
        Placeholder.configure({
            placeholder: options.placeholder ?? 'Write here…',
        }),
        ChapterBreak,
        Ruby,
        HoverTranslation,
        StyledSpan,
        StyledBlock,
        Details,
        DetailsSummary,
        Ao3Attributes,
    ];
}
