/** How a site accepts styling; see docs/design/publishing-model.md ("Delivery strategies"). */
export type DeliveryStrategyId = 'shared-stylesheet' | 'inline' | 'embedded-style' | 'plain';

export const DELIVERY_STRATEGIES: Record<DeliveryStrategyId, string> = {
    'shared-stylesheet': 'One stylesheet shared by every part (like an AO3 Work Skin)',
    inline: 'Inline style attributes only (like cohost)',
    'embedded-style': 'A <style> block inside each post',
    plain: 'No styling at all',
};

/**
 * A site described by data instead of code: what HTML it keeps, how it takes CSS and how big a
 * part may be. A generic target (./target.tsx) is built from it.
 */
export interface TargetProfile {
    id: string;
    title: string;
    /** What a part is called on the site ("Chapter", "Post", "Page"). */
    partLabel: string;
    /** Approximate size limit of one part's HTML, in characters. */
    partMaxChars?: number;
    delivery: DeliveryStrategyId;
    /** Allowed element names; anything else is unwrapped (its contents kept). */
    elements: string[];
    /** Allowed attributes per element name; the key `all` applies to every element. */
    attributes: Record<string, string[]>;
    /** Allowed URL protocols per `element.attribute` (`a.href`); `relative` allows scheme-less URLs. */
    protocols: Record<string, string[]>;
    /** Allowed CSS properties; absent means any property is kept. */
    cssProperties?: string[];
    /**
     * Allowed CSS properties in `style` attributes, when the site filters those differently
     * from stylesheets (wafrn filters attributes but not `<style>` blocks); defaults to
     * `cssProperties`.
     */
    styleAttributeProperties?: string[];
    /** Advanced: elements removed together with their contents (default: script, style, svg, …). */
    removeContents?: string[];
    /** Advanced: elements that get a space either side when unwrapped (default: block elements). */
    whitespaceElements?: string[];
}

/** Checks untrusted JSON (an imported profile) and fills defaults; returns an error message instead. */
export function parseProfile(value: unknown): TargetProfile | string {
    if (!value || typeof value !== 'object') return 'A profile must be a JSON object.';
    const v = value as Record<string, unknown>;
    const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
    const stringLists = (x: unknown) =>
        !!x && typeof x === 'object' && Object.values(x).every(strings);

    if (typeof v.id !== 'string' || !/^[\w-]+$/.test(v.id)) {
        return '"id" must be letters, digits, dashes or underscores.';
    }
    if (typeof v.title !== 'string' || !v.title.trim()) return '"title" is required.';
    if (!((v.delivery as string) in DELIVERY_STRATEGIES)) {
        return `"delivery" must be one of: ${Object.keys(DELIVERY_STRATEGIES).join(', ')}.`;
    }
    if (!strings(v.elements)) return '"elements" must be a list of element names.';
    if (v.attributes !== undefined && !stringLists(v.attributes)) {
        return '"attributes" must map element names to lists of attribute names.';
    }
    if (v.protocols !== undefined && !stringLists(v.protocols)) {
        return '"protocols" must map "element.attribute" to lists of protocols.';
    }
    for (const key of [
        'cssProperties',
        'styleAttributeProperties',
        'removeContents',
        'whitespaceElements',
    ]) {
        if (v[key] !== undefined && !strings(v[key])) return `"${key}" must be a list of names.`;
    }
    if (
        v.partMaxChars !== undefined &&
        !(typeof v.partMaxChars === 'number' && v.partMaxChars > 0)
    ) {
        return '"partMaxChars" must be a positive number.';
    }
    return {
        id: v.id,
        title: v.title.trim(),
        partLabel: typeof v.partLabel === 'string' && v.partLabel.trim() ? v.partLabel : 'Post',
        ...(v.partMaxChars ? { partMaxChars: v.partMaxChars as number } : {}),
        delivery: v.delivery as DeliveryStrategyId,
        elements: (v.elements as string[]).map((s) => s.toLowerCase()),
        attributes: (v.attributes as Record<string, string[]>) ?? {},
        protocols: (v.protocols as Record<string, string[]>) ?? {},
        ...lowercased(v, 'cssProperties'),
        ...lowercased(v, 'styleAttributeProperties'),
        ...lowercased(v, 'removeContents'),
        ...lowercased(v, 'whitespaceElements'),
    };
}

/** `{ [key]: lowercased list }` when the optional list is present, else nothing. */
function lowercased(v: Record<string, unknown>, key: string) {
    return Array.isArray(v[key]) ? { [key]: (v[key] as string[]).map((s) => s.toLowerCase()) } : {};
}

/** A starting point for a new profile: common formatting tags, links and images, inline styles. */
export function newProfile(id: string): TargetProfile {
    return {
        id,
        title: 'My site',
        partLabel: 'Post',
        delivery: 'inline',
        elements: [
            'a',
            'b',
            'blockquote',
            'br',
            'code',
            'div',
            'em',
            'h1',
            'h2',
            'h3',
            'hr',
            'i',
            'img',
            'li',
            'ol',
            'p',
            'pre',
            's',
            'small',
            'span',
            'strong',
            'sub',
            'sup',
            'u',
            'ul',
        ],
        attributes: {
            all: ['style', 'title'],
            a: ['href'],
            img: ['src', 'alt', 'width', 'height'],
        },
        protocols: { 'a.href': ['http', 'https', 'relative'], 'img.src': ['http', 'https'] },
    };
}
