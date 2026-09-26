/**
 * FNV-1a (32-bit) in base 36: cheap, synchronous and stable across sessions. Lifted class names
 * are built from it, so its output must never change (test/ao3/lift-styles.test.ts pins it).
 */
export function fnv1a36(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}
