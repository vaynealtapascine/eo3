/**
 * Small string helpers shared across the render/ port, kept in one place because they were
 * getting reimplemented slightly differently per file (a bare `split(' ')` breaks on a
 * multi-line/indented word list the way `trim().split(/\s+/)` doesn't; three near-identical
 * ASCII lstrip/rstrip pairs is one too many copies of the same regex to keep in sync).
 */

/** Split a whitespace-separated word list, tolerant of the extra whitespace a wrapped multi-line string picks up. */
export function words(s: string): string[] {
    return s.trim().split(/\s+/);
}

/** Ruby `String#lstrip` / `#rstrip` / `#strip`: ASCII whitespace and NUL only (not Unicode spaces). */
export function rubyLstrip(s: string): string {
    return s.replace(/^[ \t\r\n\f\v\0]+/, '');
}
export function rubyRstrip(s: string): string {
    return s.replace(/[ \t\r\n\f\v\0]+$/, '');
}
export function rubyStrip(s: string): string {
    return rubyRstrip(rubyLstrip(s));
}
