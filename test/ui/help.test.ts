// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, linkHelpHtml, openHelp, renderHelpMarkdown } from '../../src/ui/help-content';
import { HelpHost } from '../../src/ui/help';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = 'https://github.com/example/eo3';

async function settle() {
    for (let i = 0; i < 20; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

describe('Help guides', () => {
    it('renders Markdown with tables and code, dropping raw HTML', async () => {
        const html = await renderHelpMarkdown(
            '# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```html\n<p data-edit="text">x</p>\n```\n\n<script>alert(1)</script>\n'
        );
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<table>');
        expect(html).toContain('&#x3C;p data-edit="text">x&#x3C;/p>');
        expect(html).not.toContain('<script');
    });

    it('points links at other guides, the repository, or a new tab', () => {
        const linked = linkHelpHtml(
            '<a href="group-settings.md">settings</a><a href="../AGENTS.md">agents</a>' +
                '<a href="https://example.com/">web</a><a href="#fields">here</a>',
            REPO
        );
        const box = document.createElement('div');
        box.innerHTML = linked;
        const [topic, repo, web, anchor] = Array.from(box.querySelectorAll('a'));
        expect(topic.getAttribute('data-help-topic')).toBe('group-settings');
        expect(repo.getAttribute('href')).toBe(`${REPO}/blob/main/AGENTS.md`);
        expect(repo.getAttribute('target')).toBe('_blank');
        expect(web.getAttribute('target')).toBe('_blank');
        expect(web.getAttribute('rel')).toBe('noopener noreferrer');
        expect(anchor.getAttribute('href')).toBe('#fields');
        expect(anchor.hasAttribute('target')).toBe(false);
    });

    it('loads and renders every guide', async () => {
        for (const topic of HELP_TOPICS) {
            const markdown = await topic.load();
            expect(markdown.length).toBeGreaterThan(100);
            const html = await renderHelpMarkdown(markdown);
            expect(html).toMatch(/<h1>/);
        }
    });

    it('opens from anywhere and follows links between guides', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => root.render(createElement(HelpHost)));
        const dialog = container.querySelector('dialog.help-dialog') as HTMLDialogElement;
        expect(dialog.open).toBe(false);

        act(() => openHelp('inline-editing'));
        await settle();
        expect(dialog.open).toBe(true);
        expect(dialog.querySelector('[aria-current="page"]')?.textContent).toContain(
            'Edit blocks in the chapter'
        );
        expect(dialog.querySelector('.help-markdown h1')?.textContent).toBe(
            'Edit blocks in the chapter'
        );

        // inline-editing.md links to group-settings.md: it opens in Help.
        const link = dialog.querySelector<HTMLAnchorElement>('a[data-help-topic="group-settings"]');
        expect(link).not.toBeNull();
        act(() => link!.click());
        await settle();
        expect(dialog.querySelector('.help-markdown h1')?.textContent).toBe('Block settings');

        act(() => (dialog.querySelector('button[aria-label="Close help"]') as HTMLElement).click());
        expect(dialog.open).toBe(false);

        act(() => root.unmount());
        container.remove();
    });
});
