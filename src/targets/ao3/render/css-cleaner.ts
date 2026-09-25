/**
 * Port of otwarchive's `CssCleaner#clean_css_code` (lib/css_cleaner.rb), the validator a skin
 * goes through on save. It is a model validation: one rejected declaration and the skin does not
 * save, so every diagnostic here is a save failure (or a silent change) on AO3.
 *
 * AO3 parses with the `css_parser` gem; this uses css-tree with raw preludes/values and
 * reproduces the gem's observable behaviour: properties lowercased, a duplicate property keeps
 * the last value in the first slot, selector whitespace collapsed, `@media` flattened (query
 * discarded), statement at-rules dropped, other block at-rules rejected. The value regexes are
 * transcribed from the Ruby; note `\s` is a literal space in a double-quoted Ruby string.
 */
import { parse, CssNode, Block, Rule, Atrule, Declaration } from 'css-tree';
import {
    SUPPORTED_CSS_PROPERTIES,
    SUPPORTED_CSS_SHORTHAND_PROPERTIES,
    SUPPORTED_CSS_KEYWORDS,
    SUPPORTED_EXTERNAL_URLS,
    TOP_LEVEL_DOMAINS,
} from './css-config';
import { rubyStrip as strip } from './ruby-str';

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

// --- Regexes (lib/css_cleaner.rb) ----------------------------------------------------------------
// Built as strings and composed the way the Ruby interpolates `.to_s`; each Ruby part is grouped.

const ALPHA = '[a-z\\-]+';
const UNITS = '(?:deg|cm|em|ex|in|mm|pc|pt|px|s|%)';
const NUMBER = '-?\\.?\\d{1,3}\\.?\\d{0,3}';
// Double-quoted in Ruby: `\s` is a literal space here.
const NUMBER_OR_RATIO = `${NUMBER}(?: */ *${NUMBER})?`;
const NUMBER_WITH_UNIT = `${NUMBER} *${UNITS}? *,? *`;
const PAREN_NUMBER = `\\(\\s*(?:${NUMBER_WITH_UNIT})+\\s*\\)`;
const PREFIX = '(?:moz|ms|o|webkit)';
const FUNCTION_NAME = '(?:scalex?y?|translatex?y?|skewx?y?|rotatex?y?|matrix)';
const TRANSFORM_FUNCTION = `${FUNCTION_NAME}${PAREN_NUMBER}`;
const SHAPE_FUNCTION = `rect${PAREN_NUMBER}`;
const RGBA = `rgba?${PAREN_NUMBER}`;
const HSLA = `hsla?${PAREN_NUMBER}`;
const COLOR = `(?:#[0-9a-f]{3,6}|${ALPHA}|${RGBA}|${HSLA})`;
const COLOR_STOP_FUNCTION = `color-stop\\s*\\(${NUMBER_WITH_UNIT}\\s*,?\\s*${COLOR}\\s*\\)`;
const FILTER_NAME =
    '(?:blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)';
const FILTER_FUNCTION = `${FILTER_NAME}${PAREN_NUMBER}`;
const DROP_SHADOW_VALUE = `\\(\\s*(?:${NUMBER_WITH_UNIT}|${COLOR}\\s*)+\\s*\\)`;
const DROP_SHADOW_FUNCTION = `drop-shadow${DROP_SHADOW_VALUE}`;
const CUSTOM_PROPERTY_NAME = '\\-\\-[0-9a-z\\-_]+';
const VAR_FUNCTION = `var\\(\\s*${CUSTOM_PROPERTY_NAME}\\s*\\)`;
const DOMAIN = `https?://\\w[\\w\\-\\.]+\\.(?:${TOP_LEVEL_DOMAINS.join('|')})`;
const DOMAIN_OR_IMAGES = `(?:\\/images|${DOMAIN})`;
const URI = `${DOMAIN_OR_IMAGES}/[\\w\\-\\.\\/]*[\\w\\-]\\.(?:${SUPPORTED_EXTERNAL_URLS.join(
    '|'
)})`;
const URL = `(?:${URI}|"${URI}"|'${URI}')`;
const URL_FUNCTION = `url\\(\\s*${URL}\\s*\\)`;
const VALUE = `(?:${TRANSFORM_FUNCTION}|${URL_FUNCTION}|${COLOR_STOP_FUNCTION}|${COLOR}|${NUMBER_WITH_UNIT}|${ALPHA}|${SHAPE_FUNCTION}|${FILTER_FUNCTION}|${DROP_SHADOW_FUNCTION}|${VAR_FUNCTION})`;

// Ruby `^`/`$` are line anchors, hence the `m` flag. The value is downcased before this check,
// so a global `i` is equivalent to the Ruby's per-part case flags.
const VALUE_LIST_RE = new RegExp(`^(?:${VALUE},?\\s*)+$`, 'im');
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

/** `strip_value`: downcase, remove `!important`, strip. */
function stripValue(value: string): string {
    return strip(value.toLowerCase().replace(/!important/g, ''));
}

/** Like `str.split(delim)`, but a `delim` occurrence inside parentheses doesn't split. */
function splitTopLevel(str: string, delim: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === delim && depth === 0) {
            parts.push(str.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(str.slice(start));
    return parts;
}

/**
 * `value_stripped.match?(/^(VALUE,?\s*)+$/i)`, made safe against the regex's catastrophic
 * backtracking (the Ruby side rescues `Regexp::TimeoutError` and treats the value as invalid).
 * Splitting at top-level commas is equivalent for this grammar — a VALUE never spans one — and
 * bounds the backtracking per chunk; absurd digit runs are rejected outright.
 */
function matchesValueList(stripped: string): boolean {
    if (/\d{21,}/.test(stripped)) return false;
    // The `,?\s*` tail of each VALUE absorbs the whitespace after a comma, so a chunk's leading
    // whitespace (left behind by the split, which drops the comma itself) is never part of what
    // the anchored regex has to match.
    return splitTopLevel(stripped, ',')
        .map((chunk) => chunk.replace(/^\s+/, ''))
        .every((chunk) => isBlank(chunk) || VALUE_LIST_RE.test(chunk));
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

/** `tokenize_and_sanitize_css_value`: a port of the StringScanner loop, token by token. */
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
        let inParen = /\($/.test(token) ? 1 : 0;
        while (inParen > 0) {
            const next = scanUntil(PAREN);
            if (next === null) return ''; // mismatched parens
            token += next;
            if (/\($/.test(token)) inParen += 1;
            if (/\)$/.test(token)) inParen -= 1;
        }
        const separator = /(\s|,)$/.exec(token)?.[0] ?? '';
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
    const m = /^([a-z\-]+)\((.*)\)/.exec(value);
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
        .every((name) => /^(?:'?[a-z0-9\- ]+'?|"?[a-z0-9\- ]+"?)$/.test(name.trim()));
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
 * css_parser splits a rule's body at every `;` that isn't inside parentheses — including inside
 * quoted strings — so `content: "a;b"` reaches the validator as `"a` (and is then rejected).
 */
function truncateAtBareSemicolon(value: string): string {
    return splitTopLevel(value, ';')[0];
}

/**
 * css_parser's RuleSet: properties lowercased; declarations with an empty value are dropped at
 * parse time; a repeated property keeps the last value in the first slot.
 */
function collectDeclarations(block: Block, selectors: string, emit: CssDiagnosticSink): Decl[] {
    const decls = new Map<string, Decl>();
    block.children.forEach((child: CssNode) => {
        if (child.type !== 'Declaration') return;
        const d = child as Declaration;
        const property = d.property.trim().toLowerCase();
        const value = d.value.type === 'Raw' ? strip(truncateAtBareSemicolon(d.value.value)) : '';
        if (isBlank(property) || isBlank(value)) return;
        if (decls.has(property)) emit({ kind: 'duplicate-property', property, selectors });
        decls.set(property, { property, value, important: !!d.important });
    });
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
    prefix: string,
    callerCheck: CssCallerCheck | undefined,
    emit: CssDiagnosticSink
): string | null {
    if (rule.prelude.type !== 'Raw') return null;
    const selectors = cleanSelectors(rule.prelude.value, prefix);
    const selectorsLabel = selectors.join(', ');
    const decls = collectDeclarations(rule.block, selectorsLabel, emit);
    if (decls.length === 0) {
        // `.a{}` never becomes a rule set; `.a{color:}` does (its only declaration is dropped
        // for the empty value), and then fails for having no rules.
        if (rule.block.children.toArray().length === 0) return null;
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
    const stripped = cssCode.replace(/\/\*[\s\S]*?\*\//g, '');

    let ast: CssNode;
    try {
        ast = parse(stripped, {
            parseValue: false,
            parseRulePrelude: false,
            parseAtrulePrelude: false,
        });
    } catch {
        emit({ kind: 'no-valid-css' });
        return '';
    }

    let cleanCss = '';
    let ruleSetsSeen = 0;

    const visit = (node: CssNode): void => {
        if (node.type === 'Rule') {
            const cleaned = cleanRule(node, prefix, options.callerCheck, emit);
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
