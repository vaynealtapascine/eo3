/**
 * The CSS value grammar from otwarchive's lib/css_cleaner.rb. The regex pieces are transcribed
 * from the Ruby; note `\s` is a literal space in a double-quoted Ruby string (hence ` *`).
 *
 * `VALUE_REGEX` itself isn't run as one regex: it is ambiguous (`1px` is one number-with-unit or
 * a number plus the word `px`), and JS backtracking explores every split of a near-miss like
 * `rotate(1px 1px … x` — exponential — where Ruby's memoizing engine stays polynomial. So the
 * grammar is rebuilt below from memoized combinators that return every end position, which
 * decides the same language in polynomial time.
 */
import { SUPPORTED_EXTERNAL_URLS, TOP_LEVEL_DOMAINS } from './css-config';

export const ALPHA = '[a-z\\-]+';
export const NUMBER = '-?\\.?\\d{1,3}\\.?\\d{0,3}';
export const NUMBER_OR_RATIO = `${NUMBER}(?: */ *${NUMBER})?`;
export const PREFIX = '(?:moz|ms|o|webkit)';
export const CUSTOM_PROPERTY_NAME = '\\-\\-[0-9a-z\\-_]+';
export const VAR_FUNCTION = `var\\(\\s*${CUSTOM_PROPERTY_NAME}\\s*\\)`;
const UNITS = '(?:deg|cm|em|ex|in|mm|pc|pt|px|s|%)';
const FUNCTION_NAME = '(?:scalex?y?|translatex?y?|skewx?y?|rotatex?y?|matrix)';
const FILTER_NAME =
    '(?:blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)';
const DOMAIN = `https?://\\w[\\w\\-\\.]+\\.(?:${TOP_LEVEL_DOMAINS.join('|')})`;
const DOMAIN_OR_IMAGES = `(?:\\/images|${DOMAIN})`;
const URI = `${DOMAIN_OR_IMAGES}/[\\w\\-\\.\\/]*[\\w\\-]\\.(?:${SUPPORTED_EXTERNAL_URLS.join(
    '|'
)})`;
const URL = `(?:${URI}|"${URI}"|'${URI}')`;
export const URL_FUNCTION = `url\\(\\s*${URL}\\s*\\)`;

// --- Memoized combinators: each node maps a start position to every position it can end at ---

type Node = (s: string, i: number, memo: Map<number, number[]>) => number[];
let nodeCount = 0;

function node(ends: (s: string, i: number, memo: Map<number, number[]>) => Iterable<number>): Node {
    const id = nodeCount++;
    return (s, i, memo) => {
        const key = id * (s.length + 1) + i;
        let found = memo.get(key);
        if (!found) memo.set(key, (found = [...new Set(ends(s, i, memo))]));
        return found;
    };
}

/** A regex whose match at a position is unique (literals, names, delimited functions). */
function lit(source: string): Node {
    const re = new RegExp(source, 'iy');
    return node((s, i) => {
        re.lastIndex = i;
        return re.test(s) ? [re.lastIndex] : [];
    });
}

/** `[class]{min,max}`: every run length in range. */
function run(cls: string, min: number, max = Infinity): Node {
    const re = new RegExp(cls, 'i');
    return node(function* (s, i) {
        let k = i;
        while (k - i < max && k < s.length && re.test(s[k])) k++;
        for (let end = i + min; end <= k; end++) yield end;
    });
}

function seq(...parts: Node[]): Node {
    return node((s, i, memo) =>
        parts.reduce<number[]>((starts, part) => starts.flatMap((p) => part(s, p, memo)), [i])
    );
}

function alt(...options: Node[]): Node {
    return node((s, i, memo) => options.flatMap((o) => o(s, i, memo)));
}

const opt = (part: Node) =>
    alt(
        part,
        node((_, i) => [i])
    );

/** `(?:part)+`; `part` must consume at least one character. */
function many(part: Node): Node {
    return node((s, i, memo) => {
        const seen = new Set<number>();
        const stack = [...part(s, i, memo)];
        while (stack.length) {
            const end = stack.pop()!;
            if (seen.has(end)) continue;
            seen.add(end);
            stack.push(...part(s, end, memo));
        }
        return seen;
    });
}

// --- The grammar -------------------------------------------------------------------------------

const spaces = run(' ', 0);
const ws = run('\\s', 0);
const number = seq(
    opt(lit('-')),
    opt(lit('\\.')),
    run('\\d', 1, 3),
    opt(lit('\\.')),
    run('\\d', 0, 3)
);
const numberWithUnit = seq(number, spaces, opt(lit(UNITS)), spaces, opt(lit(',')), spaces);
const parenNumber = seq(lit('\\('), ws, many(numberWithUnit), ws, lit('\\)'));
const color = alt(
    seq(lit('#'), run('[0-9a-f]', 3, 6)),
    run('[a-z\\-]', 1),
    seq(lit('rgba?'), parenNumber),
    seq(lit('hsla?'), parenNumber)
);
const value = alt(
    seq(lit(FUNCTION_NAME), parenNumber),
    lit(URL_FUNCTION),
    seq(lit('color-stop\\s*\\('), numberWithUnit, ws, opt(lit(',')), ws, color, ws, lit('\\)')),
    color,
    numberWithUnit,
    seq(lit('rect'), parenNumber),
    seq(lit(FILTER_NAME), parenNumber),
    seq(lit('drop-shadow\\('), ws, many(alt(numberWithUnit, seq(color, ws))), ws, lit('\\)')),
    lit(VAR_FUNCTION)
);
const valueList = many(seq(value, opt(lit(',')), ws));

/**
 * `value_stripped.match?(/^(VALUE,?\s*)+$/i)` on an already-downcased value. Ruby's `^`/`$` are
 * line anchors, so the run of items may start at any line start and end at any line end.
 */
export function matchesValueList(s: string): boolean {
    const memo = new Map<number, number[]>();
    const starts = [0];
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') starts.push(i + 1);
    return starts.some((start) =>
        valueList(s, start, memo).some((end) => end === s.length || s[end] === '\n')
    );
}
