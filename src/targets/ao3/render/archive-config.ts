/**
 * otwarchive's Sanitize config (`sanitizer_config.rb`: `ARCHIVE` / `CSS_ALLOWED`) plus the gem
 * defaults it inherits. Pure data; ./transformers attaches the transformers.
 */
import { words } from './ruby-str';

export interface TransformerEnv {
    /** An earlier transformer already allowlisted this node (`env[:is_allowlisted]`). */
    isAllowlisted: boolean;
}

/** Returning `{ allowlist }` exempts those nodes from the element/attribute cleaning (`node_allowlist`). */
export type TransformerResult = void | { allowlist: Element[] };

/** Runs on every element before it is cleaned; may mutate it. */
export type Transformer = (node: Element, env: TransformerEnv) => TransformerResult;

export interface SanitizeConfig {
    /** Allowlisted element names; anything else is unwrapped (children kept, tag dropped). */
    elements: ReadonlySet<string>;
    /** Attributes allowed on every element. */
    allAttributes: readonly string[];
    /** Additional attributes allowed per element name. */
    attributesByTag: Readonly<Record<string, readonly string[]>>;
    /** Attributes force-added to matching elements (e.g. rel=nofollow on links). */
    addAttributes: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** Allowed URL protocols per element/attribute; `"relative"` permits scheme-less URLs. */
    protocols: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
    /** Elements removed together with their contents. */
    removeContents: ReadonlySet<string>;
    /** Elements that, when unwrapped, get a space inserted before/after to preserve readability. */
    whitespaceElements: ReadonlySet<string>;
    transformers: readonly Transformer[];
}

/** AO3's `ArchiveConfig.APP_URL` — the base relative image `src` values are resolved against. */
export const DEFAULT_APP_URL = 'https://archiveofourown.org/';

// --- Sanitize gem defaults (lib/sanitize/config/default.rb) that AO3 inherits -------------------

/** `Sanitize::Config::DEFAULT[:remove_contents]` (ARCHIVE restates the same list). */
export const SANITIZE_DEFAULT_REMOVE_CONTENTS: ReadonlySet<string> = new Set(
    words('iframe math noembed noframes noscript plaintext script style svg xmp')
);

/** `Sanitize::Config::DEFAULT[:whitespace_elements]`: unwrapping one of these inserts a space either side. */
export const SANITIZE_DEFAULT_WHITESPACE_ELEMENTS: ReadonlySet<string> = new Set(
    words(
        'address article aside blockquote br dd div dl dt footer h1 h2 h3 h4 h5 h6 header hgroup ' +
            'hr li nav ol p pre section ul'
    )
);

/** `Config.merge(DEFAULT, partial)`. */
export function makeSanitizeConfig(partial: Partial<SanitizeConfig>): SanitizeConfig {
    return {
        elements: partial.elements ?? new Set(),
        allAttributes: partial.allAttributes ?? [],
        attributesByTag: partial.attributesByTag ?? {},
        addAttributes: partial.addAttributes ?? {},
        protocols: partial.protocols ?? {},
        removeContents: partial.removeContents ?? SANITIZE_DEFAULT_REMOVE_CONTENTS,
        whitespaceElements: partial.whitespaceElements ?? SANITIZE_DEFAULT_WHITESPACE_ELEMENTS,
        transformers: partial.transformers ?? [],
    };
}

// --- Sanitize::Config::ARCHIVE ------------------------------------------------------------------

export const ARCHIVE_ELEMENTS: ReadonlySet<string> = new Set(
    words(
        'a abbr acronym address b big blockquote br caption center cite code col colgroup details ' +
            'figcaption figure dd del dfn div dl dt em h1 h2 h3 h4 h5 h6 hr i img ins kbd li ol p ' +
            'pre q rp rt ruby s samp small span strike strong sub summary sup table tbody td tfoot ' +
            'th thead tr tt u ul var'
    )
);

export const ARCHIVE_ALL_ATTRIBUTES: readonly string[] = words('align dir lang title');

export const ARCHIVE_ATTRIBUTES_BY_TAG: Readonly<Record<string, readonly string[]>> = {
    a: words('href name'),
    blockquote: words('cite'),
    col: words('span width'),
    colgroup: words('span width'),
    details: words('open'),
    hr: words('align width'),
    img: words('align alt border height src width'),
    ol: words('start type'),
    q: words('cite'),
    table: words('border summary width'),
    td: words('abbr axis colspan height rowspan width'),
    th: words('abbr axis colspan height rowspan scope width'),
    ul: words('type'),
};

export const ARCHIVE_ADD_ATTRIBUTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    a: { rel: 'nofollow' },
};

export const ARCHIVE_PROTOCOLS: Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
> = {
    a: { href: ['ftp', 'http', 'https', 'mailto', 'relative'] },
    blockquote: { cite: ['http', 'https', 'relative'] },
    img: { src: ['http', 'https'] },
    q: { cite: ['http', 'https', 'relative'] },
};

export const ARCHIVE_REMOVE_CONTENTS: ReadonlySet<string> = SANITIZE_DEFAULT_REMOVE_CONTENTS;

/** `Sanitize::Config::ARCHIVE` without transformers (those are attached per field in ./transformers). */
export const ARCHIVE: SanitizeConfig = makeSanitizeConfig({
    elements: ARCHIVE_ELEMENTS,
    allAttributes: ARCHIVE_ALL_ATTRIBUTES,
    attributesByTag: ARCHIVE_ATTRIBUTES_BY_TAG,
    addAttributes: ARCHIVE_ADD_ATTRIBUTES,
    protocols: ARCHIVE_PROTOCOLS,
    removeContents: ARCHIVE_REMOVE_CONTENTS,
});

/** `Sanitize::Config::CSS_ALLOWED` = ARCHIVE + `class` allowed everywhere (scrubbed by a transformer). */
export const CSS_ALLOWED: SanitizeConfig = {
    ...ARCHIVE,
    allAttributes: [...ARCHIVE_ALL_ATTRIBUTES, 'class'],
};
