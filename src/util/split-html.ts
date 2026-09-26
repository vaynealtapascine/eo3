/**
 * Splits HTML in two at a top-level block boundary, as late as `fits` allows for the first piece.
 * Never splits inside a block: if the content is wrapped in a single element (a styled `<div>`
 * around the whole chapter), the split happens among that wrapper's children and the wrapper is
 * closed in the first piece and reopened, with the same attributes, in the second. Returns null
 * when there is no boundary to split at, or the first block alone doesn't fit.
 */
export function splitHtml(
    html: string,
    fits: (html: string) => boolean
): { first: string; second: string } | null {
    const template = document.createElement('template');
    template.innerHTML = html;

    // Descend through lone wrappers: an element that is the only non-blank child of its parent.
    const wrappers: Element[] = [];
    let container: ParentNode = template.content;
    for (;;) {
        const significant = [...container.childNodes].filter(
            (node) => !(node.nodeType === Node.TEXT_NODE && !node.textContent!.trim())
        );
        if (significant.length !== 1 || !(significant[0] instanceof Element)) break;
        wrappers.push(significant[0]);
        container = significant[0];
    }

    const blocks = [...container.childNodes];
    const serialize = (nodes: ChildNode[]) => {
        let inner = nodes.map(nodeHtml).join('');
        for (const wrapper of [...wrappers].reverse()) inner = withInnerHtml(wrapper, inner);
        return inner.trim();
    };

    // Candidate boundaries: after each block that isn't blank text, leaving something behind.
    const cuts: number[] = [];
    for (let i = 1; i < blocks.length; i++) {
        const before = blocks[i - 1];
        if (before.nodeType === Node.TEXT_NODE && !before.textContent!.trim()) continue;
        if (blocks.slice(i).some((n) => n.nodeType !== Node.TEXT_NODE || n.textContent!.trim())) {
            cuts.push(i);
        }
    }

    // The rendered size grows with the prefix, so binary-search the last cut that fits.
    let lo = 0;
    let hi = cuts.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fits(serialize(blocks.slice(0, cuts[mid])))) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (best === -1) return null;
    const cut = cuts[best];
    return { first: serialize(blocks.slice(0, cut)), second: serialize(blocks.slice(cut)) };
}

/** A non-rendered chapter boundary an author can place in an HTML source module. */
export const SPLIT_MARKER = '<!-- eo3:split -->';

/** Split at the first explicit marker, including when it is inside a wrapper. */
export function splitHtmlAtMarker(html: string): { first: string; second: string } | null {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
    let marker: Comment | null = null;
    while (walker.nextNode()) {
        const comment = walker.currentNode as Comment;
        if (comment.data.trim() === 'eo3:split') {
            marker = comment;
            break;
        }
    }
    if (!marker) return null;

    const before = document.createRange();
    before.setStart(template.content, 0);
    before.setEndBefore(marker);
    const after = document.createRange();
    after.setStartAfter(marker);
    after.setEnd(template.content, template.content.childNodes.length);
    const serialize = (fragment: DocumentFragment) => {
        const holder = document.createElement('div');
        holder.append(fragment);
        return holder.innerHTML.trim();
    };
    const firstFragment = before.cloneContents();
    const secondFragment = after.cloneContents();
    const hasContent = (fragment: DocumentFragment) =>
        !!fragment.textContent?.trim() ||
        !!fragment.querySelector('img, svg, video, audio, iframe, hr, br, table');
    if (!hasContent(firstFragment) || !hasContent(secondFragment)) return null;
    return { first: serialize(firstFragment), second: serialize(secondFragment) };
}

function nodeHtml(node: ChildNode): string {
    if (node instanceof Element) return node.outerHTML;
    const holder = document.createElement('div');
    holder.append(node.cloneNode(true));
    return holder.innerHTML;
}

function withInnerHtml(wrapper: Element, inner: string): string {
    const shell = wrapper.cloneNode(false) as Element;
    shell.innerHTML = inner;
    return shell.outerHTML;
}
