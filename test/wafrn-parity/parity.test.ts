/**
 * Checks eo3's wafrn target against wafrn's actual sanitizer: the real `sanitize-html` (at the
 * version wafrn locks) run with the config extracted from wafrn's frontend
 * (src/targets/wafrn/sanitizer-config.json, refreshed by `npm run test:wafrn-update`).
 * Only the sanitizing is compared; wafrn's display-time extras (blanked images, link targets,
 * mentions, emoji) aren't part of the stored post.
 */
import { describe, expect, it } from 'vitest';
import sanitizeHtml from 'sanitize-html';
import sanitizeHtmlPackage from 'sanitize-html/package.json';
import config from '../../src/targets/wafrn/sanitizer-config.json';
import wafrn from '../../src/targets/wafrn';

function wafrnSanitize(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: config.allowedTags,
        allowedAttributes: config.allowedAttributes,
        allowedStyles: {
            '*': Object.fromEntries(config.allowedStyles.map((p) => [p, [/.*/]])),
        },
        allowVulnerableTags: config.allowVulnerableTags,
    });
}

/** Parse and re-serialize, with style attributes in one canonical spelling. */
function normalize(html: string): string {
    const root = document.createElement('div');
    root.innerHTML = html;
    for (const node of root.querySelectorAll('[style]')) {
        const decls = node
            .getAttribute('style')!
            .split(';')
            .map((d) => d.trim().replace(/\s*:\s*/, ':'))
            .filter(Boolean);
        node.setAttribute('style', decls.join(';'));
    }
    return root.innerHTML;
}

const CASES: Record<string, string> = {
    'plain paragraphs': '<p>one</p><p>two <b>bold</b> <i>italic</i></p>',
    'allowed oddities': '<marquee behavior="alternate">hi</marquee><font>f</font><mark>m</mark>',
    'details and ruby': '<details><summary>s</summary>body</details><ruby>漢<rt>kan</rt></ruby>',
    'unknown tags unwrap': '<section><article>text</article></section><blink>b</blink>',
    'script removed with contents': 'a<script>alert(1)</script>b',
    'style block kept': '<style>.x { color: red; }</style><p class="x">styled</p>',
    'classes kept everywhere': '<div class="a b"><span class="c">t</span></div>',
    'event handlers dropped': '<p onclick="x()" id="i" data-x="1">p</p>',
    'allowed inline styles': '<span style="color: red; font-weight: bold">t</span>',
    'disallowed inline styles dropped': '<span style="color: red; position: fixed">t</span>',
    'hr keeps style': '<hr style="border-color: blue">',
    'link attributes': '<a href="https://example.com" title="t" target="_self" rel="x">l</a>',
    'javascript links dropped': '<a href="javascript:alert(1)">bad</a>',
    'mailto and relative links': '<a href="mailto:a@b.c">m</a><a href="/blog/x">r</a>',
    'images keep src': '<img src="https://example.com/a.png" alt="a" width="10" onerror="x()">',
    tables: '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
    'marquee attributes': '<marquee direction="up" scrolldelay="5" onstart="x()">m</marquee>',
};

describe(`wafrn sanitizer (wafrn@${config.commit.slice(0, 7)}, sanitize-html ${
    config.sanitizeHtmlVersion
})`, () => {
    it('runs the sanitize-html version wafrn locks', () => {
        expect(sanitizeHtmlPackage.version).toBe(config.sanitizeHtmlVersion);
    });

    for (const [name, html] of Object.entries(CASES)) {
        it(name, () => {
            const ours = wafrn.renderFallback(html, {} as never, () => {});
            expect(normalize(ours)).toBe(normalize(wafrnSanitize(html)));
        });
    }
});
