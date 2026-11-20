import { sanitizeAo3Fragment } from '../targets/ao3/render';

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
    /** Optional HTML snippet for custom `template` pieces; `{{selection}}` inserts selected text. */
    templateHtml?: string;
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
        previewSample: 'Aa ↔ En',
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
        previewSample: 'Hey!',
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
        previewSample: '▸ Spoiler',
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

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Turns selected text lines into an AO3-safe `<div class="fx-chat">` bubble thread.
 *
 * - Lines matching `Name: message` assign the first speaker to incoming bubbles (`fx-msg-in`)
 *   and the second speaker to outgoing bubbles (`fx-msg-out`). If 3+ speakers appear, each
 *   bubble keeps a `<span class="fx-msg-sender">Name</span>` prefix.
 * - Lines without `Name:` alternate incoming / outgoing per line.
 * - Empty input produces a friendly 2-message starter thread.
 */
export function buildTextMessageThreadHtml(selectedText: string): string {
    const rawLines = selectedText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!rawLines.length) {
        return (
            '<div class="fx-chat">' +
            '<p class="fx-msg-in">Are you still awake?</p>' +
            '<p class="fx-msg-out">Unfortunately yes.</p>' +
            '</div>'
        );
    }

    const parsed = rawLines.map((line) => {
        const match = /^([^:\n]{1,24}):\s+(.+)$/.exec(line);
        if (!match) return { speaker: null as string | null, text: line };
        return { speaker: match[1].trim(), text: match[2].trim() };
    });

    const speakers: string[] = [];
    for (const entry of parsed) {
        if (entry.speaker && !speakers.includes(entry.speaker)) {
            speakers.push(entry.speaker);
        }
    }

    const hasSpeakers = speakers.length > 0 && parsed.every((p) => p.speaker !== null);
    const outgoingSpeaker = speakers.length >= 2 ? speakers[1] : null;
    const showSenderLabels = hasSpeakers && speakers.length > 2;

    const bubbles = parsed.map((entry, idx) => {
        let isOut: boolean;
        if (hasSpeakers) {
            isOut = outgoingSpeaker !== null ? entry.speaker === outgoingSpeaker : idx % 2 === 1;
        } else {
            isOut = idx % 2 === 1;
        }
        const cls = isOut ? 'fx-msg-out' : 'fx-msg-in';
        const senderHtml =
            showSenderLabels && entry.speaker
                ? `<span class="fx-msg-sender">${escapeHtml(entry.speaker)}</span> `
                : '';
        return `<p class="${cls}">${senderHtml}${escapeHtml(entry.text)}</p>`;
    });

    return `<div class="fx-chat">${bubbles.join('')}</div>`;
}

/**
 * Wraps selected plain lines (or a starter placeholder) into a styled `<details class="fx-spoiler">`.
 */
export function buildSpoilerHtml(selectedText: string, summary = 'Spoiler'): string {
    const lines = selectedText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const body = lines.length
        ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
        : '<p>Hidden text…</p>';
    return `<details class="fx-spoiler" open=""><summary>${escapeHtml(
        summary
    )}</summary>${body}</details>`;
}

const SELECTION_PARAGRAPH_RE = /<p(\s[^>]*)?>\s*\{\{\s*selection(?:\|([^}]*))?\s*\}\}\s*<\/p>/gi;
const SELECTION_TOKEN_RE = /\{\{\s*selection(?:\|([^}]*))?\s*\}\}/gi;

/**
 * Renders a designer-authored HTML template snippet for insertion into the editor, substituting
 * `{{selection}}` or `{{selection|Default text}}` with the author's selected text and sanitizing
 * the result through AO3's HTML allowlist.
 */
export function renderCustomTemplateHtml(
    templateHtml: string,
    selectedText: string,
    fallbackText = 'Your text here…'
): string {
    const cleanTemplate = sanitizeAo3Fragment(templateHtml);
    const trimmed = selectedText.trim();
    const lines = trimmed
        ? selectedText
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
        : [];

    // When a `<p>` contains only `{{selection}}`, split multi-line selections into sibling `<p>`s
    // while keeping any attributes (e.g. class="tweet-body") on each paragraph.
    let rendered = cleanTemplate.replace(
        SELECTION_PARAGRAPH_RE,
        (_match, attrs: string | undefined, inlineFallback: string | undefined) => {
            const openTag = attrs ? `<p${attrs}>` : '<p>';
            if (lines.length) {
                return lines.map((line) => `${openTag}${escapeHtml(line)}</p>`).join('');
            }
            const text = (inlineFallback ?? fallbackText).trim() || fallbackText;
            return `${openTag}${escapeHtml(text)}</p>`;
        }
    );

    // Remaining inline `{{selection}}` placeholders become escaped text with `<br>` for newlines.
    rendered = rendered.replace(
        SELECTION_TOKEN_RE,
        (_match, inlineFallback: string | undefined) => {
            if (lines.length) {
                return lines.map((line) => escapeHtml(line)).join('<br>');
            }
            const text = (inlineFallback ?? fallbackText).trim() || fallbackText;
            return escapeHtml(text);
        }
    );

    return sanitizeAo3Fragment(rendered);
}
