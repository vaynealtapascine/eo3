import { createProfileTarget } from '../profile/target';
import { TargetProfile } from '../profile/types';
import { ERRORS } from './diagnostics';
import config from './sanitizer-config.json';

// sanitize-html's defaults, which wafrn's config doesn't override.
const URL_SCHEMES = ['http', 'https', 'ftp', 'mailto', 'tel', 'relative'];
/** `nonTextTags` minus `style`, which wafrn allows: removed along with their contents. */
const REMOVE_CONTENTS = ['script', 'textarea', 'option'];

const { '*': allAttributes = [], ...attributesByTag } = config.allowedAttributes as Record<
    string,
    string[]
>;

/**
 * wafrn as a profile, built from its own sanitizer config (sanitizer-config.json, extracted from
 * wafrn's frontend by test/wafrn-parity/extract.mjs). wafrn renders each post in its own shadow
 * DOM, so a post's `<style>` block applies to that post only: the embedded-style strategy.
 * Inline `style` attributes are filtered to a property list; `<style>` content isn't.
 */
export const WAFRN_PROFILE: TargetProfile = {
    id: 'wafrn',
    title: 'wafrn',
    partLabel: 'Post',
    delivery: 'embedded-style',
    elements: config.allowedTags,
    attributes: { all: allAttributes, ...attributesByTag },
    protocols: { 'a.href': URL_SCHEMES, 'img.src': URL_SCHEMES },
    styleAttributeProperties: config.allowedStyles,
    removeContents: REMOVE_CONTENTS,
    whitespaceElements: [],
};

const MASCOT =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="48" ' +
    'height="48" rx="10" fill="none" stroke="currentColor" stroke-width="4"/><path d="M24 8v48M40 ' +
    '8v48M8 24h48M8 40h48" stroke="currentColor" stroke-width="3"/></svg>';

export default createProfileTarget(WAFRN_PROFILE, {
    id: 'wafrn',
    errors: ERRORS,
    mascot: { awake: MASCOT, asleep: MASCOT },
    // wafrn blanks images in post text when it shows the post; the stored post keeps them.
    finalizePart(root, pushError) {
        for (const img of root.querySelectorAll('img')) {
            pushError('image-not-shown', { src: img.getAttribute('src') ?? '' });
        }
    },
});
