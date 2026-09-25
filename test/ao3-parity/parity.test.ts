/**
 * Checks the AO3 port in src/targets/ao3/render against AO3's own Ruby code. expected.json is
 * produced by generate.rb from otwarchive's sources; regenerate it with `npm run test:ao3-update`.
 */
import { describe, expect, it } from 'vitest';
import { renderAo3Content, cleanWorkskinCss, CssDiagnostic } from '../../src/targets/ao3/render';
import cases from './cases.json';
import expected from './expected.json';

type Raises = { raises: string };
type CssExpected = { css: string; errors: string[] } | Raises;

/** Intentional differences from AO3, by case name, with the reason. */
const KNOWN_DIVERGENCES: { html: Record<string, string>; css: Record<string, string> } = {
    html: {},
    css: {
        'font-face':
            'eo3 drops @font-face; AO3 emits a broken selector-less block (and refuses the skin either way).',
    },
};

// The Work Skin error keys (config/locales) each diagnostic corresponds to; null = silent change.
const RUBY_ERROR_KEY: Record<CssDiagnostic['kind'], string | null> = {
    'no-valid-css': 'no_valid_css',
    'font-face': 'font_face',
    'unsupported-at-rule': 'no_rules_for_selectors',
    'dropped-at-rule': null,
    'media-flattened': null,
    'duplicate-property': null,
    'banned-property': 'banned_property',
    'invalid-custom-property-name': 'invalid_custom_property_name',
    'banned-value': 'banned_value_for_property',
    'no-rules-for-selectors': 'no_rules_for_selectors',
    'work-skin-custom-property': 'work_skin_custom_properties',
    'work-skin-var': 'work_skin_var',
    'work-skin-position-fixed': 'work_skin_banned_value_for_property',
};

/** eo3 lifts inline `style` into `eo3-*` classes where AO3 just drops it; undo that to compare. */
function withoutLiftedClasses(html: string): string {
    return html.replace(/ class="([^"]*)"/g, (_, value: string) => {
        const kept = value.split(' ').filter((c) => !/^eo3-[0-9a-z]+$/.test(c));
        return kept.length ? ` class="${kept.join(' ')}"` : '';
    });
}

const isRaises = (v: unknown): v is Raises => typeof v === 'object' && v !== null && 'raises' in v;

describe(`AO3 HTML sanitizer (otwarchive@${expected.commit.slice(0, 7)})`, () => {
    for (const [name, input] of Object.entries(cases.html)) {
        const want = (expected.html as Record<string, string | Raises>)[name];
        const skip = KNOWN_DIVERGENCES.html[name] ?? (isRaises(want) && `AO3 raises ${want.raises}`);
        it.skipIf(!!skip || want === undefined)(name, () => {
            expect(withoutLiftedClasses(renderAo3Content(input).html)).toBe(want);
        });
    }
});

describe(`AO3 Work Skin validator (otwarchive@${expected.commit.slice(0, 7)})`, () => {
    for (const [name, input] of Object.entries(cases.css)) {
        const want = (expected.css as Record<string, CssExpected>)[name];
        const skip = KNOWN_DIVERGENCES.css[name] ?? (isRaises(want) && `AO3 raises ${want.raises}`);
        it.skipIf(!!skip || want === undefined)(name, () => {
            const errors: string[] = [];
            const css = cleanWorkskinCss(input, {
                prefix: '#workskin',
                onDiagnostic: (d) => {
                    const key = RUBY_ERROR_KEY[d.kind];
                    if (key) errors.push(key);
                },
            });
            expect({ css, errors: errors.sort() }).toEqual(want);
        });
    }
});

it('every expected result has a case', () => {
    expect(Object.keys(expected.html).sort()).toEqual(Object.keys(cases.html).sort());
    expect(Object.keys(expected.css).sort()).toEqual(Object.keys(cases.css).sort());
});
