/**
 * The Sanitize transformers `HtmlCleaner#sanitize_value` attaches to a work's `content` field,
 * in the Ruby's order: sanitizer_config.rb's two, then `OtwSanitize::EmbedSanitizer` (iframe
 * path only; the legacy Flash embed/object path is not ported), `OtwSanitize::MediaSanitizer`,
 * and `OtwSanitize::UserClassSanitizer`. The embed/media ones re-clean their node under a
 * stricter config and allowlist it; the class scrubber still runs on it afterwards.
 */
import {
    ARCHIVE,
    CSS_ALLOWED,
    DEFAULT_APP_URL,
    SanitizeConfig,
    Transformer,
    makeSanitizeConfig,
} from './archive-config';
import { words } from './ruby-str';
import { cleanNode, Ao3DiagnosticSink } from './sanitize';

/** On <details>, a present boolean `open` becomes `open="open"`. */
const openAttributeTransformer: Transformer = (node) => {
    if (node.tagName.toLowerCase() === 'details' && node.hasAttribute('open')) {
        node.setAttribute('open', 'open');
    }
};

/** On <img>, a relative `src` is resolved against APP_URL. */
const relativeImagePathTransformer: Transformer = (node) => {
    if (node.tagName.toLowerCase() !== 'img') return;
    const src = node.getAttribute('src');
    if (!src) return;
    try {
        node.setAttribute('src', new URL(src, DEFAULT_APP_URL).href);
    } catch {
        // unparseable; the protocol check in ./sanitize drops it
    }
};

// Same regex as the Ruby: a letter, then at least one more word char or dash.
const VALID_USER_CLASS = /^[a-zA-Z][\w-]+$/;

/** Scrub `class` down to valid names (runs on every element, allowlisted or not). */
const userClassTransformer: Transformer = (node) => {
    const cls = node.getAttribute('class');
    if (cls === null) return;
    node.setAttribute(
        'class',
        cls
            .split(' ')
            .filter((c) => VALID_USER_CLASS.test(c))
            .join(' ')
    );
};

const EMBED_ALLOWLIST: ReadonlyArray<[source: string, pattern: RegExp]> = [
    ['4shared', /^4shared\.com\/web\/embed/],
    ['audiocom', /^audio\.com\/embed\/audio\//],
    ['archiveorg', /^archive\.org\/embed\//],
    ['bilibili', /^(player\.)?bilibili\.com\//],
    ['criticalcommons', /^criticalcommons\.org\//],
    ['podfic', /^podfic\.com\//],
    ['soundcloud', /^(w\.)?soundcloud\.com\//],
    ['spotify', /^(open\.)?spotify\.com\//],
    ['viddersnet', /^vidders\.net\//],
    ['viddertube', /^viddertube\.com\//],
    ['vimeo', /^(player\.)?vimeo\.com\//],
    ['youtube', /^youtube(-nocookie)?\.com\//],
];

const EMBED_SUPPORTS_HTTPS = new Set(
    words(
        '4shared audiocom archiveorg bilibili eighttracks podfic soundcloud spotify viddersnet viddertube vimeo youtube'
    )
);

const EMBED_IFRAME_CONFIG = makeSanitizeConfig({
    elements: new Set(words('embed iframe')),
    attributesByTag: {
        embed: words('allowfullscreen height src type width'),
        iframe: words('allowfullscreen frameborder height src title class type width'),
    },
});

/** Keeps <iframe>s from allowlisted media hosts, forced to https where supported, with a fixed attribute set. */
function embedTransformer(onDiagnostic?: Ao3DiagnosticSink): Transformer {
    return (node, env) => {
        if (env.isAllowlisted || node.tagName.toLowerCase() !== 'iframe') return;
        const src = node.getAttribute('src');
        if (!src) return;
        // standardize_url: drop the protocol and www. so the patterns match on the host.
        const host = src.replace(/^(?:https?:)?\/\/(?:www\.)?/i, '');
        const source = EMBED_ALLOWLIST.find(([, pattern]) => pattern.test(host))?.[0];
        if (!source) return;

        if (EMBED_SUPPORTS_HTTPS.has(source))
            node.setAttribute('src', src.replace(/http:/g, 'https:'));
        cleanNode(node, EMBED_IFRAME_CONFIG, onDiagnostic);
        return { allowlist: [node] };
    };
}

const MEDIA_ELEMENTS = new Set(words('audio video source track'));

// Sanitize::Config.merge(ARCHIVE, ALLOWLIST_CONFIG): hashes deep-merge, arrays are replaced.
const MEDIA_CONFIG: SanitizeConfig = makeSanitizeConfig({
    elements: new Set([...MEDIA_ELEMENTS, ...ARCHIVE.elements]),
    allAttributes: ARCHIVE.allAttributes,
    attributesByTag: {
        ...ARCHIVE.attributesByTag,
        audio: words('class controls crossorigin dir loop muted preload src title'),
        video: words(
            'class controls crossorigin dir height loop muted playsinline poster preload src title width'
        ),
        source: words('src type'),
        track: words('default kind label src srclang'),
    },
    addAttributes: {
        ...ARCHIVE.addAttributes,
        audio: { controls: 'controls', crossorigin: 'anonymous', preload: 'metadata' },
        video: {
            controls: 'controls',
            playsinline: 'playsinline',
            crossorigin: 'anonymous',
            preload: 'metadata',
        },
    },
    protocols: {
        ...ARCHIVE.protocols,
        audio: { src: ['http', 'https'] },
        video: { poster: ['http', 'https'], src: ['http', 'https'] },
        source: { src: ['http', 'https'] },
        track: { src: ['http', 'https'] },
    },
    removeContents: ARCHIVE.removeContents,
});

/**
 * Keeps <audio>/<video>/<source>/<track>, re-cleaned under the media allowlist with `controls`
 * etc. forced on. Only the node itself is allowlisted: the outer pass revisits the children and
 * this transformer matches them again, so they are cleaned twice — redundant, harmless, and what
 * the Ruby does. (`BANNED_MULTIMEDIA_SRCS` is empty on the live archive, so no host check.)
 */
function mediaTransformer(onDiagnostic?: Ao3DiagnosticSink): Transformer {
    return (node, env) => {
        if (env.isAllowlisted || !MEDIA_ELEMENTS.has(node.tagName.toLowerCase())) return;
        cleanNode(node, MEDIA_CONFIG, onDiagnostic);
        // Sanitize emits boolean attributes as attribute=""; AO3 tidies them to attribute="attribute".
        for (const attr of ['default', 'loop', 'muted']) {
            if (node.hasAttribute(attr)) node.setAttribute(attr, attr);
        }
        return { allowlist: [node] };
    };
}

/** The config `sanitize_value` uses for `content`: CSS_ALLOWED plus every transformer above. */
export function buildContentConfig(onDiagnostic?: Ao3DiagnosticSink): SanitizeConfig {
    return {
        ...CSS_ALLOWED,
        transformers: [
            openAttributeTransformer,
            relativeImagePathTransformer,
            embedTransformer(onDiagnostic),
            mediaTransformer(onDiagnostic),
            userClassTransformer,
        ],
    };
}
