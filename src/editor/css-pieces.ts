import { renderStyleTemplate, type StyleField } from './style-template';

export type CssPieceKind = 'inline' | 'block' | 'template';

export interface CssPiece {
    id: string;
    label: string;
    description: string;
    kind: CssPieceKind;
    /** Primary CSS class applied to the span, div, or details wrapper. */
    className: string;
    /** Extra helper classes defined by this piece's stylesheet (for deduplication). */
    extraClasses?: readonly string[];
    /** Short preview text shown in the Style picker swatch. */
    previewSample: string;
    /** AO3-safe Work Skin CSS (no `#workskin` prefix needed; eo3 scopes it on export & canvas). */
    css: string;
    /**
     * HTML for `template` pieces, or for an inline piece inserted as one unit (like Translate on
     * hover). The template language is in `style-template.ts`.
     */
    templateHtml?: string;
    /** What applying the piece asks for (`{{key}}` in the template). */
    fields?: readonly StyleField[];
    /** Optional HTML rendered inside the swatch preview instead of auto-generated sample markup. */
    previewHtml?: string;
    /** Optional extra CSS used only for rendering the miniature swatch preview. */
    previewCss?: string;
    /** Optional creator credit for imported / community styles. */
    author?: string;
    /** Optional pack name for imported style packs. */
    pack?: string;
    /** True for user-imported or user-created styles stored in the browser library. */
    custom?: boolean;
}

export const CSS_PIECES: readonly CssPiece[] = [
    // ── Inline pieces ────────────────────────────────────────────────────────
    {
        id: 'redacted',
        label: 'Redacted',
        description: 'Black censor bar that reveals on hover',
        kind: 'inline',
        className: 'fx-redacted',
        previewSample: 'classified',
        css: `.fx-redacted {
  background-color: #1a1a1a;
  color: #1a1a1a;
  padding: 0 0.25em;
  border-radius: 0.15em;
  transition: color 0.15s ease;
}
.fx-redacted:hover {
  color: #f5f5f5;
}`,
    },
    {
        id: 'translate',
        label: 'Translate on hover',
        description: 'Shows a translation tooltip on hover or tap',
        kind: 'inline',
        className: 'fx-translate',
        extraClasses: ['fx-translate-tip', 'fx-translate-paren'],
        previewSample: 'Bonjour',
        // An inline template: inserted as one unit that can be edited again.
        templateHtml:
            '<span class="fx-translate">{{selection}}<span class="fx-translate-tip">' +
            '{{#if parens}}<span class="fx-translate-paren"> (</span>{{/if}}{{translation}}' +
            '{{#if parens}}<span class="fx-translate-paren">)</span>{{/if}}</span></span>',
        fields: [
            {
                key: 'selection',
                label: 'Original text',
                placeholder: 'e.g. Je t’aime',
                required: true,
            },
            {
                key: 'translation',
                label: 'Translation (shown on hover)',
                placeholder: 'e.g. I love you',
                required: true,
            },
            {
                key: 'parens',
                label: 'Show (translation) fallback when styles are off',
                type: 'toggle',
                default: true,
            },
        ],
        css: `.fx-translate {
  position: relative;
  border-bottom: 1px dotted currentColor;
  cursor: pointer;
}
.fx-translate .fx-translate-tip {
  visibility: hidden;
  opacity: 0;
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 20em;
  margin-bottom: 0.35em;
  padding: 0.3em 0.65em;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.35em;
  background-color: #222222;
  color: #f8f8f8;
  font-size: 0.85em;
  font-style: normal;
  font-weight: normal;
  line-height: 1.35;
  text-align: center;
  text-indent: 0;
  text-decoration: none;
  white-space: normal;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  z-index: 10;
  transition: opacity 0.15s ease;
}
.fx-translate .fx-translate-paren {
  display: none;
}
.fx-translate:hover .fx-translate-tip,
.fx-translate:focus .fx-translate-tip,
.fx-translate:active .fx-translate-tip {
  visibility: visible;
  opacity: 1;
}`,
    },
    {
        id: 'smallcaps',
        label: 'Small caps',
        description: 'Formal or solemn small-caps emphasis',
        kind: 'inline',
        className: 'fx-smallcaps',
        previewSample: 'Small Caps',
        css: `.fx-smallcaps {
  font-variant: small-caps;
  letter-spacing: 0.06em;
}`,
    },
    {
        id: 'whisper',
        label: 'Whisper',
        description: 'Smaller, softer voice',
        kind: 'inline',
        className: 'fx-whisper',
        previewSample: 'quietly…',
        css: `.fx-whisper {
  font-size: 0.85em;
  opacity: 0.75;
  letter-spacing: 0.02em;
}`,
    },
    {
        id: 'highlight',
        label: 'Highlighter',
        description: 'Warm marker highlight behind text',
        kind: 'inline',
        className: 'fx-highlight',
        previewSample: 'important',
        css: `.fx-highlight {
  background-color: #fff3a1;
  color: #222222;
  padding: 0.04em 0.25em;
  border-radius: 0.2em;
}`,
    },
    {
        id: 'pill',
        label: 'Tag pill',
        description: 'Compact rounded label or status badge',
        kind: 'inline',
        className: 'fx-pill',
        previewSample: 'TAG',
        css: `.fx-pill {
  display: inline-block;
  padding: 0.05em 0.5em;
  border: 1px solid #888888;
  border-radius: 1em;
  font-size: 0.84em;
  letter-spacing: 0.03em;
}`,
    },

    // ── Block pieces ─────────────────────────────────────────────────────────
    {
        id: 'callout',
        label: 'Callout box',
        description: 'Accent-bordered note or author highlight',
        kind: 'block',
        className: 'fx-callout',
        previewSample: 'Note',
        css: `.fx-callout {
  border-left: 4px solid #990000;
  background-color: rgba(153, 0, 0, 0.07);
  padding: 0.75em 1em;
  margin: 1em 0;
  border-radius: 0 0.35em 0.35em 0;
}
.fx-callout p:last-child {
  margin-bottom: 0;
}`,
    },
    {
        id: 'letter',
        label: 'Letter / parchment',
        description: 'Warm serif note card with soft border',
        kind: 'block',
        className: 'fx-letter',
        previewSample: 'Dear…',
        css: `.fx-letter {
  background-color: #fbf7ee;
  color: #2b241d;
  border: 1px solid #dfd3bd;
  padding: 1.1em 1.4em;
  margin: 1em auto;
  max-width: 34em;
  font-family: Georgia, serif;
  line-height: 1.65;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.fx-letter p:last-child {
  margin-bottom: 0;
}`,
    },
    {
        id: 'terminal',
        label: 'Terminal / system',
        description: 'Dark monospace console or HUD readout',
        kind: 'block',
        className: 'fx-terminal',
        previewSample: '> _',
        css: `.fx-terminal {
  background-color: #14181f;
  color: #d8f3dc;
  border: 1px solid #2d3a4b;
  border-radius: 0.4em;
  padding: 0.85em 1.1em;
  margin: 1em 0;
  font-family: monospace;
  font-size: 0.92em;
  line-height: 1.5;
}
.fx-terminal p:last-child {
  margin-bottom: 0;
}`,
    },
    {
        id: 'epigraph',
        label: 'Epigraph',
        description: 'Centered italic quote between subtle rules',
        kind: 'block',
        className: 'fx-epigraph',
        previewSample: '“Quote”',
        css: `.fx-epigraph {
  margin: 1.2em auto;
  max-width: 30em;
  padding: 0.75em 1.1em;
  border-top: 1px solid #b5b5b5;
  border-bottom: 1px solid #b5b5b5;
  font-style: italic;
  text-align: center;
}
.fx-epigraph p:last-child {
  margin-bottom: 0;
}`,
    },
    {
        id: 'journal',
        label: 'Journal entry',
        description: 'Paper card with margin rule',
        kind: 'block',
        className: 'fx-journal',
        previewSample: 'Day 1',
        css: `.fx-journal {
  background-color: #fdfcf7;
  color: #2a2a2a;
  border: 1px solid #e2dcc8;
  border-left: 4px solid #c99789;
  padding: 0.9em 1.2em;
  margin: 1em 0;
  font-family: Georgia, serif;
  line-height: 1.65;
}
.fx-journal p:last-child {
  margin-bottom: 0;
}`,
    },

    // ── Selection templates ──────────────────────────────────────────────────
    {
        id: 'chat',
        label: 'Text messages',
        description: 'Turns lines (or Name: lines) into chat bubbles',
        kind: 'template',
        className: 'fx-chat',
        extraClasses: ['fx-msg-in', 'fx-msg-out', 'fx-msg-sender'],
        previewSample: 'Alex: Hey!\nSam: Hi!',
        // One bubble per selected line; `Name:` lines alternate by speaker.
        templateHtml:
            '<div class="fx-chat">{{#lines|Are you still awake?\nUnfortunately yes.}}' +
            '<p class="{{alt:fx-msg-in|fx-msg-out}}">' +
            '{{#if many-speakers}}<span class="fx-msg-sender">{{speaker}}</span> {{/if}}' +
            '{{text}}</p>{{/lines}}</div>',
        css: `.fx-chat {
  max-width: 26em;
  margin: 1em auto;
  padding: 0.85em;
  border: 1px solid #d0d4dc;
  border-radius: 0.9em;
  background-color: #f4f5f7;
  color: #1c1e21;
  font-family: sans-serif;
  font-size: 0.94em;
  overflow: hidden;
}
.fx-chat .fx-msg-in,
.fx-chat .fx-msg-out {
  display: block;
  clear: both;
  max-width: 78%;
  margin: 0 0 0.45em;
  padding: 0.45em 0.8em;
  border-radius: 1em;
  line-height: 1.35;
}
.fx-chat .fx-msg-in {
  float: left;
  background-color: #e4e6eb;
  color: #1c1e21;
  border-bottom-left-radius: 0.25em;
}
.fx-chat .fx-msg-out {
  float: right;
  background-color: #0b84ff;
  color: #ffffff;
  border-bottom-right-radius: 0.25em;
}
.fx-chat .fx-msg-sender {
  font-weight: bold;
  font-size: 0.82em;
  display: block;
  margin-bottom: 0.15em;
  opacity: 0.8;
}
.fx-chat p:last-child {
  margin-bottom: 0;
}`,
    },
    {
        id: 'spoiler',
        label: 'Collapsible spoiler',
        description: 'Expandable <details> drawer for spoilers or notes',
        kind: 'template',
        className: 'fx-spoiler',
        previewSample: 'Hidden text…',
        templateHtml:
            '<details class="fx-spoiler" open=""><summary>{{summary|Spoiler}}</summary>' +
            '<p>{{selection|Hidden text…}}</p></details>',
        fields: [{ key: 'summary', label: 'Summary (always shown)', default: 'Spoiler' }],
        css: `.fx-spoiler {
  margin: 1em 0;
  padding: 0.6em 0.9em;
  border: 1px solid #b8b8b8;
  border-radius: 0.45em;
  background-color: rgba(128, 128, 128, 0.08);
}
.fx-spoiler summary {
  font-weight: bold;
  cursor: pointer;
}
.fx-spoiler p:last-child {
  margin-bottom: 0;
}`,
    },
];

export const BUILTIN_PIECE_CLASSES: ReadonlySet<string> = new Set(
    CSS_PIECES.flatMap((piece) => [piece.className, ...(piece.extraClasses ?? [])])
);

export function findPieceById(
    id: string,
    extraPieces: readonly CssPiece[] = []
): CssPiece | undefined {
    return (
        CSS_PIECES.find((piece) => piece.id === id) ?? extraPieces.find((piece) => piece.id === id)
    );
}

export function findPieceByClass(
    className: string | null | undefined,
    extraPieces: readonly CssPiece[] = []
): CssPiece | undefined {
    if (!className) return undefined;
    const tokens = className.trim().split(/\s+/);
    return (
        CSS_PIECES.find((piece) => tokens.includes(piece.className)) ??
        extraPieces.find((piece) => piece.className && tokens.includes(piece.className))
    );
}

export function pieceMarker(id: string): string {
    return `/* eo3:piece:${id} */`;
}

export function hasPieceCss(css: string, piece: CssPiece): boolean {
    if (!css) return false;
    if (css.includes(pieceMarker(piece.id))) return true;
    if (!piece.className) return false;
    const escaped = piece.className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\.${escaped}(?![\\w-])`).test(css);
}

export function formatPieceCssBlock(piece: CssPiece): string {
    return `${pieceMarker(piece.id)}\n${piece.css.trim()}`;
}

/** Text messages from selected lines: the built-in `chat` template. */
export function buildTextMessageThreadHtml(selectedText: string): string {
    const chat = findPieceById('chat')!;
    return renderStyleTemplate(chat.templateHtml!, { selection: selectedText });
}

/** A collapsible spoiler from selected lines: the built-in `spoiler` template. */
export function buildSpoilerHtml(selectedText: string, summary = 'Spoiler'): string {
    const spoiler = findPieceById('spoiler')!;
    return renderStyleTemplate(spoiler.templateHtml!, {
        selection: selectedText,
        fields: spoiler.fields,
        values: { summary },
    });
}

/** Whether applying a piece inserts template HTML (block templates and inline templates). */
export function isTemplatePiece(piece: Pick<CssPiece, 'kind' | 'templateHtml'>): boolean {
    return piece.kind === 'template' || (piece.kind === 'inline' && !!piece.templateHtml?.trim());
}

/**
 * Renders a template snippet for insertion, substituting `{{selection}}` (and field tags) and
 * sanitizing the result through AO3's HTML allowlist. See `style-template.ts`.
 */
export function renderCustomTemplateHtml(
    templateHtml: string,
    selectedText: string,
    fallbackText = 'Your text here…',
    fields?: readonly StyleField[],
    values?: Record<string, string | boolean>
): string {
    return renderStyleTemplate(templateHtml, {
        selection: selectedText,
        fallback: fallbackText,
        fields,
        values,
    });
}
