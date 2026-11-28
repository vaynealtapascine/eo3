/**
 * The guides shown in eo3's Help dialog. They are the Markdown files in `docs/`, bundled as
 * text and loaded only when Help opens, so the app and the repository always say the same thing.
 */

export interface HelpTopic {
    id: string;
    title: string;
    /** One line shown under the title in the topic list. */
    summary: string;
    /** The file's name in `docs/`, which other guides link to. */
    file: string;
    load: () => Promise<string>;
}

export const HELP_TOPICS: readonly HelpTopic[] = [
    {
        id: 'style-packs',
        title: 'Styles and style packs',
        summary: 'Make your own looks for ✦ Styles, and share them with other writers.',
        file: 'style-packs.md',
        load: () => import('../../docs/style-packs.md?raw').then((m) => m.default),
    },
    {
        id: 'group-settings',
        title: 'Block settings',
        summary: 'Give a block a form. The writer changes the block with the form.',
        file: 'group-settings.md',
        load: () => import('../../docs/group-settings.md?raw').then((m) => m.default),
    },
    {
        id: 'inline-editing',
        title: 'Edit blocks in the chapter',
        summary: 'Let the writer click a block in the chapter and type in it.',
        file: 'inline-editing.md',
        load: () => import('../../docs/inline-editing.md?raw').then((m) => m.default),
    },
];

export function findHelpTopic(id: string): HelpTopic | undefined {
    return HELP_TOPICS.find((topic) => topic.id === id);
}

/** Markdown (with GitHub tables) to HTML. Raw HTML in the Markdown is dropped, not rendered. */
export async function renderHelpMarkdown(markdown: string): Promise<string> {
    const [{ unified }, remarkParse, remarkGfm, remarkRehype, rehypeStringify] = await Promise.all([
        import('unified'),
        import('remark-parse'),
        import('remark-gfm'),
        import('remark-rehype'),
        import('rehype-stringify'),
    ]);
    const file = await unified()
        .use(remarkParse.default)
        .use(remarkGfm.default)
        .use(remarkRehype.default)
        .use(rehypeStringify.default)
        .process(markdown);
    return String(file);
}

/**
 * Points a rendered guide's links somewhere useful: another guide opens in Help
 * (`data-help-topic`), other repository files open on GitHub, and web links open in a new tab.
 */
export function linkHelpHtml(html: string, repositoryUrl: string): string {
    const root = document.createElement('div');
    root.innerHTML = html;
    const docsBase = repositoryUrl.replace(/\/$/, '') + '/blob/main/docs/';
    for (const link of Array.from(root.querySelectorAll('a[href]'))) {
        const href = link.getAttribute('href') ?? '';
        if (href.startsWith('#')) continue;
        if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) {
            const file = href.replace(/^(\.\/|(\.\.\/)?docs\/)/, '').split('#')[0];
            const topic = HELP_TOPICS.find((t) => t.file === file);
            if (topic) {
                link.setAttribute('href', `#help-${topic.id}`);
                link.setAttribute('data-help-topic', topic.id);
                continue;
            }
            link.setAttribute('href', new URL(href, docsBase).toString());
        }
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
    }
    return root.innerHTML;
}

/** Opens the Help dialog (mounted once by `HelpHost`), optionally at a topic. */
export function openHelp(topicId?: string): void {
    window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT, { detail: topicId ?? null }));
}

export const OPEN_HELP_EVENT = 'eo3:open-help';
