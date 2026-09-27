import { describe, expect, it } from 'vitest';
import { githubRepo, parseChangelog } from '../../src/util/changelog';

const commit = (message: string, parents = 1) => ({
    commit: { message, author: { date: '2026-09-27T00:00:00Z' } },
    html_url: `https://github.com/o/r/commit/${message.length}`,
    parents: Array.from({ length: parents }, () => ({})),
});

describe('changelog', () => {
    it('sorts conventional commits into features, fixes and the rest, newest first', () => {
        const log = parseChangelog([
            commit('feat(groups): user-made groups'),
            commit('fix: fit the picker'),
            commit('docs: note the dialogs rule'),
            commit('feat: show chapter styles'),
        ]);
        expect(log.features.map((c) => c.subject)).toEqual([
            'Show chapter styles',
            'User-made groups',
        ]);
        expect(log.fixes.map((c) => c.subject)).toEqual(['Fit the picker']);
        expect(log.other.map((c) => c.subject)).toEqual(['Note the dialogs rule']);
    });

    it('drops merge commits and trailer lines', () => {
        const log = parseChangelog([
            commit("Merge branch 'feat/mobile-layout'", 2),
            commit('fix(ui): dialogs\n\nWhy it matters.\n\nCo-Authored-By: Someone <a@b.c>'),
        ]);
        expect(log.other).toEqual([]);
        expect(log.fixes[0].body).toBe('Why it matters.');
    });

    it('keeps commits without a conventional prefix as they are', () => {
        expect(parseChangelog([commit('ADD: old style')]).other[0].subject).toBe('ADD: old style');
    });

    it('reads owner/repo from a GitHub URL', () => {
        expect(githubRepo('https://github.com/vaynealtapascine/eo3')).toBe('vaynealtapascine/eo3');
        expect(githubRepo('https://example.com')).toBeNull();
    });
});
