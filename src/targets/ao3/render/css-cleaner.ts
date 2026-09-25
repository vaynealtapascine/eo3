/**
 * Port of otwarchive's `CssCleaner#clean_css_code` (lib/css_cleaner.rb), the validator a skin
 * goes through on save. It is a model validation: one rejected declaration and the skin does not
 * save, so every diagnostic here is a save failure (or a silent change) on AO3.
 *
 * AO3 parses with the `css_parser` gem; this uses css-tree with raw preludes/values and
 * reproduces the gem's observable behaviour: properties lowercased, a duplicate property keeps
 * the last value in the first slot, selector whitespace collapsed, `@media` flattened (query
 * discarded), statement at-rules dropped, other block at-rules rejected.
 */
import { parse, CssNode, Rule, Atrule } from 'css-tree';
import {
    SUPPORTED_CSS_PROPERTIES,
    SUPPORTED_CSS_SHORTHAND_PROPERTIES,
    SUPPORTED_CSS_KEYWORDS,
} from './css-config';
import { rubyStrip as strip } from './ruby-str';
import {
    ALPHA,
    CUSTOM_PROPERTY_NAME,
    NUMBER_OR_RATIO,
    PREFIX,
    URL_FUNCTION,
    VAR_FUNCTION,
    matchesValueList,
} from './css-value';

export type CssDiagnostic =
    /** Nothing parseable at all (`no_valid_css`). */
    | { kind: 'no-valid-css' }
    /** `@font-face` is refused (`font_face`). */
    | { kind: 'font-face' }
    /** A block at-rule other than @media (@keyframes, @supports, …): AO3 sees a bogus selector with no rules and refuses. */
    | { kind: 'unsupported-at-rule'; name: string; prelude: string }
    /** A statement at-rule (@import, @charset, …): AO3's parser drops it without complaint. */
    | { kind: 'dropped-at-rule'; name: string; prelude: string }
    /** Rules inside @media are kept but the query is discarded, so they always apply. */
    | { kind: 'media-flattened'; query: string }
    /** The same property twice in one rule: AO3 keeps only the last value. */
    | { kind: 'duplicate-property'; property: string; selectors: string }
    | { kind: 'banned-property'; property: string; selectors: string }
    | { kind: 'invalid-custom-property-name'; property: string; selectors: string }
    | { kind: 'banned-value'; property: string; value: string; selectors: string }
    /** Every declaration of the rule was rejected (`no_rules_for_selectors`). */
    | { kind: 'no-rules-for-selectors'; selectors: string }
    /** Work Skins may not define custom properties (`work_skin_custom_properties`). */
    | { kind: 'work-skin-custom-property'; property: string; selectors: string }
    /** Work Skins may not use var() (`work_skin_var`). */
    | { kind: 'work-skin-var'; property: string; selectors: string }
    /** `position: fixed` is banned in Work Skins. */
    | { kind: 'work-skin-position-fixed'; selectors: string };

export type CssDiagnosticSink = (diagnostic: CssDiagnostic) => void;

/**
 * `clean_css_code`'s `caller_check`: a per-declaration veto a caller layers on top of the shared
 * rules. Runs after the generic property/value checks pass; return a diagnostic to reject the
 * declaration, or null to keep it.
 */
export type CssCallerCheck = (
    selectors: string,
    property: string,
    value: string
) => CssDiagnostic | null;

export interface CleanCssOptions {
    /**
     * Selector prefix AO3 forces (`"#workskin"` for Work Skins). Default empty: AO3 adds it on
     * save, so an unprefixed export pastes to the same stored result and previews cleanly.
     */
    prefix?: string;
    /** Caller-specific rejections on top of the shared ones (see {@link WORK_SKIN_CALLER_CHECK}). */
    callerCheck?: CssCallerCheck;
    onDiagnostic?: CssDiagnosticSink;
}

// --- Regexes (lib/css_cleaner.rb); the value grammar itself is in ./css-value ---------------

const VAR_FUNCTION_RE = new RegExp(VAR_FUNCTION, 'gi');
const CUSTOM_PROPERTY_RE = new RegExp(`^(${CUSTOM_PROPERTY_NAME})$`, 'i');
// Case-sensitive on purpose: the Ruby runs these against the original (not downcased) value.
const CONTENT_URL_RE = new RegExp(`^${URL_FUNCTION}$`);
const ASPECT_RATIO_RE = new RegExp(
    `^(?:${ALPHA}|(?:[aA][uU][tT][oO]\\s+)?${NUMBER_OR_RATIO}(?:\\s+[aA][uU][tT][oO])?)$`
);
const LEGAL_SHORTHAND_RE = new RegExp(SUPPORTED_CSS_SHORTHAND_PROPERTIES.join('|'));
const LEGAL_PREFIXED_RE = new RegExp(`-${PREFIX}-(?:${SUPPORTED_CSS_PROPERTIES.join('|')})`);
const SUPPORTED_PROPERTY_SET = new Set(SUPPORTED_CSS_PROPERTIES);
const URL_PROPERTIES = new Set([
    'background',
    'background-image',
    'border',
    'border-image',
    'list-style',
    'list-style-image',
]);

// --- Property checks ----------------------------------------------------------------------------

function isLegalProperty(property: string): boolean {
    return SUPPORTED_PROPERTY_SET.has(property) || LEGAL_PREFIXED_RE.test(property);
}
function isLegalShorthandProperty(property: string): boolean {
    return LEGAL_SHORTHAND_RE.test(property);
}
function isCustomProperty(property: string): boolean {
    return CUSTOM_PROPERTY_RE.test(property);
}
function isAllowedProperty(property: string): boolean {
    return (
        isLegalProperty(property) ||
        isLegalShorthandProperty(property) ||
        isCustomProperty(property)
    );
}

// --- Value checks -------------------------------------------------------------------------------

/** ActiveSupport `blank?` for strings. */
const isBlank = (s: string | null | undefined): boolean => !s || /^\s*$/.test(s);

const IMPORTANT_IN_VALUE_RE = /\s*!important\b\s*/i;

/** css_parser ignores a `}` with no open block; css-tree would fold it into the next selector. */
function dropStrayClosingBraces(css: string): string {
    let depth = 0;
    let quote: string | null = null;
    let out = '';
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (quote) {
            if (c === '\\') out += c + (css[++i] ?? '');
            else {
                if (c === quote) quote = null;
                out += c;
            }
            continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === '{') depth++;
        else if (c === '}') {
            if (depth === 0) continue;
            depth--;
        }
        out += c;
    }
    return out;
}

/** `strip_value`: downcase, remove `!important`, strip. */
function stripValue(value: string): string {
    return strip(value.toLowerCase().replace(/!important/g, ''));
}

/** `sanitize_css_value`: the value must be a (comma-separated) list of recognised value forms, or a bare supported keyword. */
function sanitizeCssValue(value: string): string {
    const stripped = stripValue(value);
    if (matchesValueList(stripped)) {
        // Downcase var() functions to match the css_parser gem's downcasing of property names.
        return value.replace(VAR_FUNCTION_RE, (m) => m.toLowerCase());
    }
    if (stripped.split(',').every((sub) => SUPPORTED_CSS_KEYWORDS.includes(sub.trim())))
        return value;
    return '';
}

/**
 * `tokenize_and_sanitize_css_value`: a port of the StringScanner loop, token by token.
 * Ruby's `^`/`$` are line anchors, hence the `m` flags here and below.
 */
function tokenizeAndSanitizeCssValue(value: string): string {
    let cleanval = '';
    let pos = 0;
    const SEP = /\s+|,|\(/g;
    const PAREN = /\(|\)/g;

    const scanUntil = (re: RegExp): string | null => {
        re.lastIndex = pos;
        const m = re.exec(value);
        if (!m) return null;
        const token = value.slice(pos, m.index + m[0].length);
        pos = m.index + m[0].length;
        return token;
    };

    for (;;) {
        SEP.lastIndex = pos;
        if (!SEP.test(value)) break;
        let token = scanUntil(SEP)!;
        if (isBlank(token) || token === ',') {
            cleanval += token;
            continue;
        }
        let inParen = /\($/m.test(token) ? 1 : 0;
        while (inParen > 0) {
            const next = scanUntil(PAREN);
            if (next === null) return ''; // mismatched parens
            token += next;
            if (/\($/m.test(token)) inParen += 1;
            if (/\)$/m.test(token)) inParen -= 1;
        }
        const separator = /(\s|,)$/m.exec(token)?.[0] ?? '';
        token = strip(token).replace(/,$/, '');
        const cleantoken = sanitizeCssToken(token);
        if (isBlank(cleantoken)) return '';
        cleanval += cleantoken + separator;
    }

    const rest = value.slice(pos);
    if (!isBlank(rest)) {
        const cleantoken = sanitizeCssToken(rest);
        if (isBlank(cleantoken)) return '';
        cleanval += cleantoken;
    }
    return cleanval;
}

function sanitizeCssToken(token: string): string {
    return /gradient/.test(token) ? sanitizeCssGradient(token) : sanitizeCssValue(token);
}

/** `sanitize_css_gradient`: `fn(interior)` where fn contains "gradient" and the interior tokenizes cleanly. */
function sanitizeCssGradient(value: string): string {
    const m = /^([a-z\-]+)\((.*)\)/m.exec(value);
    if (m) {
        const [, fn, interior] = m;
        const cleaned = tokenizeAndSanitizeCssValue(interior);
        if (/gradient/.test(fn) && !isBlank(cleaned)) return `${fn}(${cleaned})`;
    }
    return '';
}

/** `sanitize_css_content`: a single fully-quoted string, an image url(), or `none`. */
function sanitizeCssContent(value: string): string {
    if (/^'[^']*'$/.test(value)) return value;
    if (/^"[^"]*"$/.test(value)) return value;
    if (CONTENT_URL_RE.test(value)) return value;
    if (value === 'none') return value;
    return '';
}

/** `sanitize_css_font`: every comma-separated family is alphanumerics/dashes/spaces, optionally quoted. */
function sanitizeCssFont(value: string): string {
    const ok = stripValue(value)
        .split(',')
        .every((name) => /^(?:'?[a-z0-9\- ]+'?|"?[a-z0-9\- ]+"?)$/m.test(strip(name)));
    return ok ? value : '';
}

/** `sanitize_css_declaration_value`. Returns '' when the value is rejected. */
function sanitizeCssDeclarationValue(property: string, value: string): string {
    let clean = '';
    if (property === 'font-family') {
        if (!isBlank(sanitizeCssFont(value))) clean = value; // preserve the original capitalization
    } else if (property === 'aspect-ratio') {
        if (ASPECT_RATIO_RE.test(value)) clean = value;
    } else if (property === 'content') {
        clean = /\bvar\b/i.test(value) ? '' : sanitizeCssContent(value);
    } else if (
        /\burl\b/i.test(value) &&
        (!SUPPORTED_CSS_KEYWORDS.includes('url') || !URL_PROPERTIES.has(property))
    ) {
        clean = '';
    } else if (isLegalShorthandProperty(property) || isCustomProperty(property)) {
        clean = tokenizeAndSanitizeCssValue(value);
    } else if (isLegalProperty(property)) {
        clean = sanitizeCssValue(value);
    }
    return strip(clean);
}

// --- Rule processing (clean_css_code + WorkSkin#clean_css's caller_check) -------------------------

interface Decl {
    property: string;
    value: string;
    important: boolean;
}

/**
 * css_parser's `RuleSet#parse_declarations!` + `Declarations#[]=` on a rule's raw body. The body
 * is split at every `;`, even inside strings (`content: "a;b"` becomes `"a`); a segment with a `(`
 * and no later `)` is joined to the next, and one still open at the end is dropped. Properties
 * are lowercased, `!important` is sliced out of the value, and a repeated property keeps its
 * first slot, taking the new value unless only the old one was important.
 */
function parseDeclarations(body: string, selectors: string, emit: CssDiagnosticSink): Decl[] {
    const decls = new Map<string, Decl>();
    const segments = body.split(';');
    while (segments.length && segments[segments.length - 1] === '') segments.pop(); // Ruby's split

    let continuation: string | null = null;
    for (const segment of segments) {
        const decs: string = continuation === null ? segment : `${continuation};${segment}`;
        const lparen = decs.indexOf('(');
        if (lparen !== -1 && decs.indexOf(')', lparen) === -1) {
            continuation = decs;
            continue;
        }
        // As in the Ruby, the `next`s below leave `continuation` set.
        const colon = decs.indexOf(':');
        if (colon === -1) continue;
        const property = strip(decs.slice(0, colon)).toLowerCase();
        let value = strip(decs.slice(colon + 1));
        if (!property || !value || value.toLowerCase() === '!important') continue;

        const important = IMPORTANT_IN_VALUE_RE.test(value);
        value = strip(value.replace(IMPORTANT_IN_VALUE_RE, ''));
        const current = decls.get(property);
        if (current) emit({ kind: 'duplicate-property', property, selectors });
        if (value && !(current?.important && !important)) {
            decls.set(property, { property, value, important });
        }
        continuation = null;
    }
    return [...decls.values()];
}

/** css_parser selector normalisation + the Ruby's `&gt;` fix-up and prefixing. */
function cleanSelectors(prelude: string, prefix: string): string[] {
    return prelude
        .split(',')
        .map((sel) => sel.replace(/\s+/g, ' ').replace(/&gt;/g, '>').trim())
        .filter((sel) => sel !== '')
        .map((sel) => (!prefix || sel.startsWith(prefix) ? sel : `${prefix} ${sel}`));
}

/** `WorkSkin#clean_css`'s check: no custom properties, no var(), no position: fixed. */
export const WORK_SKIN_CALLER_CHECK: CssCallerCheck = (selectors, property, value) => {
    if (/^--/.test(property)) return { kind: 'work-skin-custom-property', property, selectors };
    if (/\bvar\b/i.test(value)) return { kind: 'work-skin-var', property, selectors };
    // Case-sensitive on the raw value, as the Ruby is: `position: Fixed` gets through there too.
    if (property === 'position' && value === 'fixed')
        return { kind: 'work-skin-position-fixed', selectors };
    return null;
};

/** Returns the cleaned rule text, or null if css_parser would have dropped the rule set at parse time (no declarations). */
function cleanRule(
    rule: Rule,
    css: string,
    prefix: string,
    callerCheck: CssCallerCheck | undefined,
    emit: CssDiagnosticSink
): string | null {
    if (rule.prelude.type !== 'Raw') return null;
    const selectors = cleanSelectors(rule.prelude.value, prefix);
    const selectorsLabel = selectors.join(', ');
    const { start, end } = rule.block.loc!;
    const body = strip(css.slice(start.offset + 1, end.offset).replace(/\}\s*$/, ''));
    // `.a{}` never becomes a rule set; `.a{color:}` does, and then fails for having no rules.
    if (!body) return null;
    const decls = parseDeclarations(body, selectorsLabel, emit);
    if (decls.length === 0) {
        emit({ kind: 'no-rules-for-selectors', selectors: selectorsLabel });
        return '';
    }

    let cleanDeclarations = '';
    for (const { property, value, important } of decls) {
        if (!isAllowedProperty(property)) {
            if (/^--/.test(property)) {
                emit({ kind: 'invalid-custom-property-name', property, selectors: selectorsLabel });
            } else {
                emit({ kind: 'banned-property', property, selectors: selectorsLabel });
            }
            continue;
        }
        const cleanval = sanitizeCssDeclarationValue(property, value);
        if (isBlank(cleanval)) {
            emit({ kind: 'banned-value', property, value, selectors: selectorsLabel });
            continue;
        }
        const veto = callerCheck?.(selectorsLabel, property, value);
        if (veto) {
            emit(veto);
            continue;
        }
        cleanDeclarations += `  ${property}: ${cleanval}${important ? ' !important' : ''};\n`;
    }

    if (isBlank(cleanDeclarations)) {
        emit({ kind: 'no-rules-for-selectors', selectors: selectorsLabel });
        return '';
    }
    return `${selectors.join(',\n')} {\n${cleanDeclarations}}\n\n`;
}

/**
 * Clean CSS the way AO3 does when saving a Work Skin: {@link cleanCssCode} with
 * {@link WORK_SKIN_CALLER_CHECK}.
 */
export function cleanWorkskinCss(
    cssCode: string,
    options: Omit<CleanCssOptions, 'callerCheck'> = {}
): string {
    if (isBlank(cssCode)) return cssCode; // `return if self.css.blank?`
    return cleanCssCode(cssCode, { ...options, callerCheck: WORK_SKIN_CALLER_CHECK });
}

/**
 * `CssCleaner#clean_css_code`: the shared skin validator. Returns the CSS AO3 would store
 * (formatted as the archive formats it); every rejection or silent change is reported to
 * `onDiagnostic`. A plain site skin runs this with no `callerCheck`; a Work Skin adds
 * {@link WORK_SKIN_CALLER_CHECK}.
 */
export function cleanCssCode(cssCode: string, options: CleanCssOptions = {}): string {
    const prefix = options.prefix ?? '';
    const emit: CssDiagnosticSink = options.onDiagnostic ?? (() => {});

    if (!/\w/.test(cssCode)) return ''; // only spaces of various kinds

    // css_parser strips comments before parsing.
    const stripped = dropStrayClosingBraces(cssCode.replace(/\/\*[\s\S]*?\*\//g, ''));

    let ast: CssNode;
    try {
        ast = parse(stripped, {
            parseValue: false,
            parseRulePrelude: false,
            parseAtrulePrelude: false,
            positions: true,
        });
    } catch {
        emit({ kind: 'no-valid-css' });
        return '';
    }

    let cleanCss = '';
    let ruleSetsSeen = 0;

    const visit = (node: CssNode): void => {
        if (node.type === 'Rule') {
            const cleaned = cleanRule(node, stripped, prefix, options.callerCheck, emit);
            if (cleaned !== null) {
                ruleSetsSeen++;
                cleanCss += cleaned;
            }
            return;
        }
        if (node.type !== 'Atrule') return;
        const at = node as Atrule;
        const name = at.name.toLowerCase();
        const prelude = at.prelude?.type === 'Raw' ? at.prelude.value.trim() : '';
        if (!at.block) {
            emit({ kind: 'dropped-at-rule', name, prelude });
            return;
        }
        if (name === 'media') {
            emit({ kind: 'media-flattened', query: prelude });
            at.block.children.forEach(visit);
            return;
        }
        ruleSetsSeen++; // css_parser turns these into a declaration-less rule set named after the at-rule
        if (name === 'font-face') emit({ kind: 'font-face' });
        else emit({ kind: 'unsupported-at-rule', name, prelude });
    };

    if (ast.type === 'StyleSheet') ast.children.forEach(visit);

    if (ruleSetsSeen === 0) emit({ kind: 'no-valid-css' });
    return cleanCss;
}
