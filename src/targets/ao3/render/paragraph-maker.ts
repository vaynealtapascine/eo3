/**
 * Port of otwarchive's `lib/paragraph_maker.rb`: single newline → `<br>`, blank line → new
 * `<p>`, 3+ newlines → an extra `<p>&nbsp;</p>`, block tags pulled out of paragraphs, stray
 * inline content wrapped. Nokogiri → DOM: `children` → `childNodes` (text nodes included), live
 * NodeLists snapshotted with `Array.from` before mutating, `dup(0)` → `cloneNode(false)`.
 */
import { ARCHIVE_REMOVE_CONTENTS } from './archive-config';
import { rubyLstrip, rubyRstrip } from './ruby-str';

// Tags the sanitizer removes wholesale (element + contents): ARCHIVE[:remove_contents].
const REMOVED_INVALID_TAGS = [...ARCHIVE_REMOVE_CONTENTS];

// Inline tags the sanitizer strips but whose contents should be wrapped in paragraphs.
const INLINE_INVALID_TAGS = ['button', 'input', 'label', 'map', 'select', 'textarea'];

// Block tags the sanitizer strips; nearby whitespace should be stripped.
const BLOCK_INVALID_TAGS = ['fieldset', 'form'];

// Tags whose content we don't descend into.
const TAG_NAMES_TO_SKIP = new Set([
    ...'a abbr acronym address audio dl embed figure h1 h2 h3 h4 h5 h6 hr img ol object p pre source summary table track video ul'.split(
        ' '
    ),
    ...INLINE_INVALID_TAGS,
    ...REMOVED_INVALID_TAGS,
]);

// Tags that need to go inside p tags.
const TAG_NAMES_TO_WRAP = new Set([
    ...'a abbr acronym b big br cite code del dfn em i img ins kbd q rp rt ruby s samp small span strike strong sub sup tt u var'.split(
        ' '
    ),
    ...INLINE_INVALID_TAGS,
]);

// Tags that can't be inside p tags.
const TAG_NAMES_TO_UNWRAP = new Set(
    'audio details dl figure h1 h2 h3 h4 h5 h6 hr ol p pre source summary table track ul video'.split(
        ' '
    )
);

// Tags before/after which we don't convert linebreaks into br's and p's.
const TAG_NAMES_STRIP_WHITESPACE = new Set([
    ...'audio blockquote br center details dl div figure figcaption h1 h2 h3 h4 h5 h6 hr ol p pre source summary table track ul video'.split(
        ' '
    ),
    ...BLOCK_INVALID_TAGS,
    ...REMOVED_INVALID_TAGS,
]);

/** Nokogiri `node.name`: lowercase tag for elements, `#text` etc. for other node kinds. */
function nameOf(node: Node | null | undefined): string | undefined {
    if (!node) return undefined;
    if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).tagName.toLowerCase();
    return node.nodeName.toLowerCase();
}

function isTextNode(node: Node): node is Text {
    return node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE;
}

/**
 * Depth-first walk yielding each node, but not descending into TAG_NAMES_TO_SKIP nodes. Children
 * are snapshotted before recursing so callbacks can mutate the tree (matching Nokogiri NodeSet).
 */
function traverse(node: Node, fn: (node: Node) => void): void {
    fn(node);
    if (node.nodeType === Node.ELEMENT_NODE && TAG_NAMES_TO_SKIP.has(nameOf(node)!)) return;
    for (const child of Array.from(node.childNodes)) traverse(child, fn);
}

/** Whether the node has a `<p>` ancestor (at any depth). */
function inParagraph(node: Node): boolean {
    const parent = node.parentNode;
    if (!parent) return false;
    if (nameOf(parent) === 'p') return true;
    return inParagraph(parent);
}

// --- Step 1 -------------------------------------------------------------------------------------

function stripWhitespace(root: Element): void {
    traverse(root, (node) => {
        if (!isTextNode(node)) return;

        const prevName = node.previousSibling
            ? nameOf(node.previousSibling)
            : nameOf(node.parentNode);
        if (prevName && TAG_NAMES_STRIP_WHITESPACE.has(prevName)) {
            node.nodeValue = rubyLstrip(node.nodeValue ?? '');
        }

        const nextName = node.nextSibling ? nameOf(node.nextSibling) : nameOf(node.parentNode);
        if (nextName && TAG_NAMES_STRIP_WHITESPACE.has(nextName)) {
            node.nodeValue = rubyRstrip(node.nodeValue ?? '');
        }

        if ((node.nodeValue ?? '') === '') (node as ChildNode).remove();
    });
}

// --- Step 2 -------------------------------------------------------------------------------------

// Runs of whitespace containing at least one newline; consecutive newlines collapse into one
// delimiter whose newline count drives the 1 / 2 / 3+ behaviour.
const NEWLINE_SPLIT = /([ \t\r\n\f\v]*\n[ \t\r\n\f\v]*)/;

function splitTextAtNewlines(root: Element): void {
    traverse(root, (node) => {
        if (!isTextNode(node)) return;
        const text = node.nodeValue ?? '';
        const pieces = text.split(NEWLINE_SPLIT);
        if (pieces.length <= 1) return;

        const doc = node.ownerDocument!;
        const insertBefore = (n: Node) => node.parentNode!.insertBefore(n, node);

        for (const piece of pieces) {
            if (piece === '') continue;
            const newlines = (piece.match(/\n/g) || []).length;
            if (newlines === 0) {
                insertBefore(doc.createTextNode(piece));
            } else if (newlines === 1) {
                insertBefore(doc.createElement('br'));
                insertBefore(doc.createTextNode('\n'));
            } else if (newlines === 2) {
                insertBefore(doc.createElement('split'));
            } else {
                const split = doc.createElement('split');
                split.setAttribute('long', '');
                insertBefore(split);
            }
        }

        (node as ChildNode).remove();
    });
}

// --- Step 3 -------------------------------------------------------------------------------------

function mergeBrTags(root: Element): void {
    traverse(root, (node) => {
        if (
            nameOf(node) !== 'br' ||
            nameOf(node.nextSibling) === 'br' ||
            nameOf(node.previousSibling) !== 'br'
        ) {
            return;
        }

        let breakCount = 1;
        while (nameOf(node.previousSibling) === 'br') {
            (node.previousSibling as ChildNode).remove();
            breakCount += 1;
        }

        const split = node.ownerDocument!.createElement('split');
        if (breakCount > 2) split.setAttribute('long', '');
        (node as ChildNode).replaceWith(split);
    });
}

// --- Step 4 -------------------------------------------------------------------------------------

/** Group consecutive items by a key (like Ruby Enumerable#chunk). */
function chunkBy<T>(items: T[], key: (item: T) => boolean): Array<[boolean, T[]]> {
    const chunks: Array<[boolean, T[]]> = [];
    for (const item of items) {
        const k = key(item);
        const last = chunks[chunks.length - 1];
        if (last && last[0] === k) last[1].push(item);
        else chunks.push([k, [item]]);
    }
    return chunks;
}

function wrapAll(root: Node): void {
    const rootName = nameOf(root);
    if ((rootName && TAG_NAMES_TO_SKIP.has(rootName)) || inParagraph(root) || rootName === 'p') {
        return;
    }

    const chunks = chunkBy(Array.from(root.childNodes), (node) => {
        if (isTextNode(node)) return true;
        const n = nameOf(node);
        return !!n && TAG_NAMES_TO_WRAP.has(n);
    });

    for (const [shouldWrap, children] of chunks) {
        if (shouldWrap) {
            const paragraph = root.ownerDocument!.createElement('p');
            children[0].parentNode!.insertBefore(paragraph, children[0]);
            for (const node of children) paragraph.appendChild(node);
        } else {
            for (const node of children) wrapAll(node);
        }
    }
}

// --- Step 5 -------------------------------------------------------------------------------------

/**
 * "Split" a node's parent at that node: the node moves up one level, its parent is cloned, and the
 * siblings are divided left/right of the node between the two parent copies.
 */
function splitParent(node: Node): void {
    const parent = node.parentNode as Element;
    const grandparent = parent.parentNode!;

    if (node.previousSibling === null) {
        grandparent.insertBefore(node, parent);
        return;
    }
    if (node.nextSibling === null) {
        grandparent.insertBefore(node, parent.nextSibling);
        return;
    }

    // Shallow clone keeps attributes (Nokogiri dup(0)); no need to copy them by hand.
    const newParent = parent.cloneNode(false);
    grandparent.insertBefore(newParent, parent.nextSibling);
    while (node.nextSibling !== null) newParent.appendChild(node.nextSibling);
    grandparent.insertBefore(node, parent.nextSibling);
}

function extractFromParagraph(node: Node): void {
    while (inParagraph(node)) splitParent(node);
}

function unwrapAll(root: Element): void {
    traverse(root, (node) => {
        const n = nameOf(node);
        if (n && TAG_NAMES_TO_UNWRAP.has(n)) extractFromParagraph(node);
    });
}

// --- Step 6 -------------------------------------------------------------------------------------

function replaceSplits(root: Element): void {
    for (const node of Array.from(root.querySelectorAll('split'))) {
        extractFromParagraph(node);

        const doc = node.ownerDocument!;
        if (node.hasAttribute('long')) {
            const p = doc.createElement('p');
            p.appendChild(doc.createTextNode(' '));
            node.replaceWith(doc.createTextNode('\n'), p, doc.createTextNode('\n'));
        } else {
            node.replaceWith(doc.createTextNode('\n'));
        }
    }
}

// --- Step 7 -------------------------------------------------------------------------------------

function deleteEmptyParagraphs(root: Element): void {
    traverse(root, (node) => {
        if (nameOf(node) === 'p' && node.childNodes.length === 0) (node as ChildNode).remove();
    });
}

// ------------------------------------------------------------------------------------------------

/** Runs the full 7-step ParagraphMaker pipeline over `root` in place (mirrors `process`). */
export function processParagraphs(root: Element): void {
    stripWhitespace(root);
    splitTextAtNewlines(root);
    mergeBrTags(root);
    wrapAll(root);
    unwrapAll(root);
    replaceSplits(root);
    deleteEmptyParagraphs(root);
}
