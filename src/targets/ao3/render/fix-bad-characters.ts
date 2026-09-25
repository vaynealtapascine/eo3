/**
 * Port of otwarchive's `HtmlCleaner#fix_bad_characters`. Normalizes line endings and applies a
 * couple of AO3-specific text fix-ups before paragraph processing.
 *
 * The Ruby also re-encodes to UTF-8 dropping invalid bytes; JS strings are already UTF-16, so that
 * step is a no-op here. Order matters and matches the Ruby: escape "<3", then normalize newlines,
 * then strip legacy spacer inserts.
 */
export function fixBadCharacters(text: string | null | undefined): string {
    if (text == null) return '';
    return text
        .replace(/<3/g, '&lt;3') // keep the "<3" emoticon from being parsed as a tag
        .replace(/\r\n?/g, '\n') // CRLF / lone CR → LF
        .replace(/____spacer____/g, ''); // strip legacy "____spacer____" inserts
}
