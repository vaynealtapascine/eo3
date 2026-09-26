import type { CssDiagnostic } from './render';

export interface ErrProps {
    isFirstOfType: boolean;
}

function tagNameOf(node: Element): string {
    if (node instanceof HTMLElement || node instanceof SVGElement)
        return node.tagName.toLowerCase();
    return '???';
}

const Sel = ({ selectors }: { selectors?: string }) =>
    selectors ? (
        <>
            {' '}
            in <code>{selectors}</code>
        </>
    ) : null;

/**
 * Everything AO3 will change about the post on submission, as surfaced by the faithful pipeline
 * in ./render: the HTML sanitizer's removals (`strip-*`), and the Work Skin validator's
 * rejections (`css-*`, one entry per {@link CssDiagnostic} kind — AO3 refuses to save a skin
 * with any of those, except the ones marked as silent changes).
 */
export const ERRORS = {
    'strip-element'({
        node,
        removedContents,
        isFirstOfType,
    }: { node: Element; removedContents: boolean } & ErrProps) {
        return (
            <div>
                {removedContents ? (
                    <>Element and its contents will be removed: &lt;{tagNameOf(node)}&gt;</>
                ) : (
                    <>Tag will be removed (its contents are kept): &lt;{tagNameOf(node)}&gt;</>
                )}
                {isFirstOfType && (
                    <div className="quick-help">
                        AO3 only allows a fixed set of elements. Unknown tags are unwrapped;
                        scripts, styles, SVG, MathML and iframes from unknown hosts are deleted
                        along with everything inside them.
                    </div>
                )}
            </div>
        );
    },
    'strip-attribute'({ node, attr, isFirstOfType }: { node: Element; attr: string } & ErrProps) {
        return (
            <div>
                Attribute will be removed: <code>{attr}</code> on &lt;{tagNameOf(node)}&gt;
                {isFirstOfType && (
                    <div className="quick-help">
                        AO3 only allows a fixed set of attributes on each element; the rest are
                        stripped. (Inline <code>style</code> is handled for you — it’s lifted into
                        the Work Skin automatically, so it won’t show up here.)
                    </div>
                )}
            </div>
        );
    },
    'class-collision'({ className, styles }: { className: string; styles: [string, string] }) {
        return (
            <div>
                Two different inline styles got the same class name <code>{className}</code>. One
                was renamed, so its name may change later. Changing either style slightly avoids
                this:
                <ul>
                    <li>
                        <code>{styles[0]}</code>
                    </li>
                    <li>
                        <code>{styles[1]}</code>
                    </li>
                </ul>
            </div>
        );
    },
    'cross-part-css-conflict'({ selector, parts }: { selector: string; parts: number[] }) {
        return (
            <div>
                Styles for <code>{selector}</code> differ across chapters {parts.join(', ')}. Check
                the Work Skin before posting those chapters.
            </div>
        );
    },
    'img-load-failed'({ url, isFirstOfType }: { url: string } & ErrProps) {
        return (
            <div>
                Could not load image resource:{' '}
                <code>
                    {url.substring(0, 100)}
                    {url.length > 100 ? '…' : ''}
                </code>
                {isFirstOfType && (
                    <div className="quick-help">
                        Check your URL maybe…
                        <br />
                        To include an image in a post, upload it to an image host and copy the image
                        address. AO3 only accepts http(s) image URLs.
                    </div>
                )}
            </div>
        );
    },

    // --- Work Skin validator ------------------------------------------------------------------

    'css-no-valid-css'() {
        return <div>Workskin: no valid CSS found. AO3 will refuse to save this skin.</div>;
    },
    'css-font-face'() {
        return (
            <div>
                Workskin: <code>@font-face</code> is not allowed in Work Skins.
            </div>
        );
    },
    'css-unsupported-at-rule'({
        name,
        prelude,
        isFirstOfType,
    }: { name: string; prelude: string } & ErrProps) {
        return (
            <div>
                Workskin:{' '}
                <code>
                    @{name} {prelude}
                </code>{' '}
                will be rejected.
                {isFirstOfType && (
                    <div className="quick-help">
                        AO3’s CSS parser only understands plain rules and <code>@media</code>{' '}
                        blocks; anything else (<code>@keyframes</code>, <code>@supports</code>, …)
                        makes the skin fail validation.
                    </div>
                )}
            </div>
        );
    },
    'css-dropped-at-rule'({ name, prelude }: { name: string; prelude: string }) {
        return (
            <div>
                Workskin:{' '}
                <code>
                    @{name} {prelude}
                </code>{' '}
                will be silently dropped.
            </div>
        );
    },
    'css-media-flattened'({ query, isFirstOfType }: { query: string } & ErrProps) {
        return (
            <div>
                Workskin: <code>@media {query}</code> will be flattened — its rules always apply.
                {isFirstOfType && (
                    <div className="quick-help">
                        AO3 keeps the rules inside a media query but throws the query away, so
                        responsive CSS behaves as if it were unconditional.
                    </div>
                )}
            </div>
        );
    },
    'css-duplicate-property'({ property, selectors }: { property: string; selectors: string }) {
        return (
            <div>
                Workskin: <code>{property}</code> is declared more than once
                <Sel selectors={selectors} />; AO3 keeps only the last value (so fallbacks are
                lost).
            </div>
        );
    },
    'css-banned-property'({
        property,
        selectors,
        isFirstOfType,
    }: { property: string; selectors: string } & ErrProps) {
        return (
            <div>
                Workskin: property <code>{property}</code> is not allowed
                <Sel selectors={selectors} />.
                {isFirstOfType && (
                    <div className="quick-help">
                        AO3 allows a fixed list of CSS properties (see its “Skins” help page). The
                        list is old: <code>gap</code>, <code>inset</code>, <code>animation</code>,{' '}
                        <code>object-fit</code>, <code>pointer-events</code> and the like are
                        missing.
                    </div>
                )}
            </div>
        );
    },
    'css-invalid-custom-property-name'({
        property,
        selectors,
    }: {
        property: string;
        selectors: string;
    }) {
        return (
            <div>
                Workskin: <code>{property}</code> is not a valid custom property name
                <Sel selectors={selectors} />.
            </div>
        );
    },
    'css-banned-value'({
        property,
        value,
        selectors,
        isFirstOfType,
    }: { property: string; value: string; selectors: string } & ErrProps) {
        return (
            <div>
                Workskin: value <code>{value}</code> is not allowed for <code>{property}</code>
                <Sel selectors={selectors} />.
                {isFirstOfType && (
                    <div className="quick-help">
                        AO3 only accepts keywords, numbers with units, hex / rgb() / hsl() colors,
                        transforms, filters, gradients, and <code>url()</code>s of .jpg/.png/.gif
                        images on http(s) hosts. Things like <code>calc()</code>,{' '}
                        <code>oklch()</code>, <code>data:</code> URLs, or a <code>/</code> inside a{' '}
                        <code>font</code> or <code>background</code> shorthand are rejected.
                    </div>
                )}
            </div>
        );
    },
    'css-no-rules-for-selectors'({ selectors }: { selectors: string }) {
        return (
            <div>
                Workskin: every declaration was rejected
                <Sel selectors={selectors} />, so the whole rule is dropped.
            </div>
        );
    },
    'css-work-skin-custom-property'({
        property,
        selectors,
        isFirstOfType,
    }: { property: string; selectors: string } & ErrProps) {
        return (
            <div>
                Workskin: custom property <code>{property}</code> will be rejected
                <Sel selectors={selectors} />.
                {isFirstOfType && (
                    <div className="quick-help">
                        Work Skins may not define CSS custom properties (variables).
                    </div>
                )}
            </div>
        );
    },
    'css-work-skin-var'({ property, selectors }: { property: string; selectors: string }) {
        return (
            <div>
                Workskin: <code>var()</code> in <code>{property}</code> will be rejected
                <Sel selectors={selectors} />. Work Skins may not use CSS variables.
            </div>
        );
    },
    'css-work-skin-position-fixed'({ selectors }: { selectors: string }) {
        return (
            <div>
                Workskin: <code>position: fixed</code> will be rejected
                <Sel selectors={selectors} />.
            </div>
        );
    },
};

// Every CssDiagnostic kind must have a `css-<kind>` renderer above (export.ts maps them 1:1).
const _cssDiagnosticsCovered: Record<`css-${CssDiagnostic['kind']}`, unknown> = ERRORS;
void _cssDiagnosticsCovered;

export const AO3_APPROX_MAX_PAYLOAD_SIZE = 500000;
export function getExportWarnings(input: string): string[] {
    const doc = new DOMParser().parseFromString(
        ['<!doctype html><html><head></head><body>', input, '</body></html>'].join(''),
        'text/html'
    );

    const exportWarnings: string[] = [];

    if (input.length >= AO3_APPROX_MAX_PAYLOAD_SIZE) {
        exportWarnings.push('this is probably too large to post');
    }

    // Only http(s) src survives the sanitizer, so a loopback host is the one broken URL left to catch.
    for (const node of doc.querySelectorAll('[src]')) {
        try {
            const { hostname } = new URL(node.getAttribute('src')!);
            if (/^localhost(\b|$)/i.test(hostname) || /^127\.0\.0/.test(hostname)) {
                exportWarnings.push(
                    `a <${node.tagName.toLowerCase()}> src has a localhost URL source. it will stop working for other people`
                );
            }
        } catch {}
    }

    return exportWarnings;
}

function findUrlsInBackgroundImage(value: string): string[] {
    const urls: string[] = [];
    let rest = value;
    for (;;) {
        const m = rest.match(
            /url\((?:(?:'((?:[^\\']|\\')+?)')|(?:"((?:[^\\"]|\\")+?)")|([^)]+?))\)/i
        );
        if (!m) break;
        urls.push(m[1] || m[2] || m[3]);
        rest = rest.slice(m.index! + m[0].length);
    }
    return urls;
}

export function handleAsyncErrors(
    prose: HTMLElement,
    pushAsyncError: (id: keyof typeof ERRORS, props: { [k: string]: any }) => void
) {
    for (const img of prose.querySelectorAll('img')) {
        img.onerror = () => {
            pushAsyncError('img-load-failed', { url: img.getAttribute('src') || '???' });
        };
    }

    // Inline styles are lifted into workskin classes, so read computed background images.
    for (const el of [prose, ...prose.querySelectorAll('*')]) {
        const backgroundImage = getComputedStyle(el).backgroundImage;
        if (!backgroundImage || backgroundImage === 'none') continue;
        for (const url of findUrlsInBackgroundImage(backgroundImage)) {
            const image = new Image();
            image.src = url;
            image.onerror = () => {
                pushAsyncError('img-load-failed', { url });
            };
        }
    }
}
