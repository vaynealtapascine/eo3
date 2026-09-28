import fs from 'node:fs';
import { parse } from '@ltd/j-toml';
import { describe, expect, it } from 'vitest';
import { renderWorkskinDocument } from '../../scripts/render-workskin-document.mjs';
import { renderAo3Content } from '../../src/targets/ao3/render';

async function render(id: string, text: string, compose?: string) {
    const doc = parse(fs.readFileSync(`assets/examples/ao3-${id}.toml`, 'utf8'), {
        joiner: '\n',
        bigint: false,
    }) as any;
    doc.modules[0].data.contents = text;
    if (compose) doc.modules[2].data.contents = compose;
    const result = await renderWorkskinDocument(doc);
    const root = document.createElement('div');
    root.innerHTML = renderAo3Content(result.html).html;
    return root;
}

describe('plain-text writing through reusable Svelte components', () => {
    it('renders NAME: text without a header, groups by speaker, and keeps colons in prose', async () => {
        const root = await render(
            'text-messages',
            'Ada: one: two\r\nBo: **three**\r\nAda: four\r\ncontinued\r\nhttps://example.com/a:b'
        );
        expect(root.querySelectorAll('.fic-message-in')).toHaveLength(2);
        expect(root.querySelectorAll('.fic-message-out')).toHaveLength(1);
        expect(root.querySelector('strong')?.textContent).toBe('three');
        expect(root.textContent).toContain('one: two');
        expect(root.textContent).toContain('continued');
        expect(root.textContent).toContain('https://example.com/a:b');
    });
    it('supports self, both timestamp forms, events, quotes, reactions and literal lines', async () => {
        const root = await render(
            'group-chat',
            '---\nTitle: Team\n---\n! Joined\n[09:41] Ada: first\n> quoted\n+ +1 (2)\nBo [09:42]: second\n\\literal: third'
        );
        expect(root.querySelector('.fic-group-heading')?.textContent).toContain('Team');
        expect(root.querySelector('.fic-group-event')?.textContent).toBe('Joined');
        expect(root.querySelector('blockquote')?.textContent).toBe('quoted');
        expect(root.querySelector('.fic-group-reaction')?.textContent).toContain('+1 (2)');
        expect(root.querySelectorAll('.fic-group-entry')).toHaveLength(2);
        expect(root.textContent).toContain('literal: third');
        expect(root.textContent).toContain('09:41');
        expect(root.textContent).toContain('09:42');
        const bubbles = await render('text-messages', '---\nSelf: Ada\n---\nAda: one\nBo: two');
        expect(bubbles.querySelector('.fic-message-out')?.textContent).toContain('Ada');
    });
    it('escapes pasted HTML while retaining unfinished messages and formatting', async () => {
        const root = await render(
            'text-messages',
            'Unlabelled opening\nAda: <img src=x onerror=alert(1)> & <script>bad</script>\nBo: \n**unfinished'
        );
        expect(root.querySelector('img, script')).toBeNull();
        expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(root.textContent).toContain('Unlabelled opening');
        expect(root.textContent).toContain('**unfinished');
    });
    it('reuses one renderer for independently named drafts', async () => {
        const doc = parse(fs.readFileSync('assets/examples/ao3-text-messages.toml', 'utf8'), {
            joiner: '\n',
            bigint: false,
        }) as any;
        doc.modules[0].data.contents = 'Ada: first';
        doc.modules.push({
            plugin: 'source.text',
            data: { language: 'text', contents: 'Bo: second' },
            namedSends: { 2: ['second'] },
        });
        doc.modules[2].data.contents =
            '<script>import draft from "./draft"; import second from "./second"; import ChatLog from "./ChatLog.svelte";</script><ChatLog text={draft}/><ChatLog text={second} variant="group"/>';
        const { html } = await renderWorkskinDocument(doc);
        const root = document.createElement('div');
        root.innerHTML = html;
        expect(root.querySelectorAll('.fic-message, .fic-group')).toHaveLength(2);
        expect(root.textContent).toContain('first');
        expect(root.textContent).toContain('second');
    });
    it('numbers footnotes in reading order, keeps repeated anchors unique, and retains undefined notes', async () => {
        const root = await render(
            'footnotes',
            '---\nId: chapter-2\n---\n`Code[^b]` and \\[^a].\n\nOne[^b].\n\nTwo[^a]. Again[^b]. Missing[^missing].\n\n[^a]: A note\n[^b]: B note\n[^unused]: Unused note'
        );
        expect([...root.querySelectorAll('sup')].map((el) => el.textContent)).toEqual([
            '[1]',
            '[2]',
            '[1]',
        ]);
        const names = [...root.querySelectorAll('a[name]')].map((el) => el.getAttribute('name'));
        expect(new Set(names).size).toBe(names.length);
        for (const link of root.querySelectorAll('a[href^="#"]'))
            expect(
                root.querySelector(`a[name="${link.getAttribute('href')!.slice(1)}"]`)
            ).not.toBeNull();
        expect(root.textContent).toContain('Missing[^missing]');
        expect(root.textContent).toContain('Unused note');
    });
    it('creates native optional panels and preserves unclosed panel text', async () => {
        const root = await render(
            'collapsible-notes',
            'Before\n\n::: Translation\nInside **panel**\n:::\n\nAfter\n\n::: Unclosed\nStill visible'
        );
        expect(root.querySelectorAll('details')).toHaveLength(1);
        expect(root.querySelector('summary')?.textContent).toBe('Translation');
        expect(root.querySelector('details strong')?.textContent).toBe('panel');
        expect(root.textContent).toContain('Before');
        expect(root.textContent).toContain('After');
        expect(root.textContent).toContain('::: Unclosed');
        expect(root.textContent).toContain('Still visible');
    });
    it('creates email threads, posts, journal entries and report fields from writing inputs', async () => {
        const email = await render(
            'email',
            '---\nFrom: A <a@example.com>\nSubject: First\n---\nFirst body\n\n--- message ---\n---\nFrom: B\nSubject: Second\n---\nSecond body'
        );
        expect(email.querySelectorAll('.fic-email')).toHaveLength(2);
        expect(email.textContent).toContain('A <a@example.com>');
        const feed = await render(
            'social-thread',
            '---\nName: A\n---\nPost\n\n--- post ---\n---\nName: B\nReply: @a\n---\nReply'
        );
        expect(feed.querySelectorAll('.fic-feed-post')).toHaveLength(2);
        expect(feed.querySelectorAll('.fic-feed-reply')).toHaveLength(1);
        const journal = await render('journal', '## Day one\nText\n\n## Day two\n~~Crossed~~');
        expect(journal.querySelectorAll('.fic-journal-entry')).toHaveLength(2);
        expect(journal.querySelector('s')?.textContent).toBe('Crossed');
        const report = await render(
            'case-file',
            '---\nCustom field: Value\n---\n## Heading\nReport'
        );
        expect(report.querySelector('dt')?.textContent).toBe('custom field');
        expect(report.querySelector('dd')?.textContent).toBe('Value');
    });
    it('preserves poem line breaks and indentation and renders chapter scene breaks', async () => {
        const poem = await render('poetry', 'One\n  Two\n\nThree');
        expect(poem.querySelectorAll('.fic-verse-stanza')).toHaveLength(2);
        expect(poem.querySelector('br')).not.toBeNull();
        expect(poem.textContent).toContain('\u00a0\u00a0Two');
        const chapter = await render('chapter-opening', 'One\n\n---\n\nTwo');
        expect(chapter.querySelector('hr')).not.toBeNull();
    });
});
