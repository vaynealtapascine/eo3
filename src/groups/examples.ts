import type { GroupFile } from '../storage/group-file';
import { parse } from '@ltd/j-toml';
import catalog from '../../assets/examples/workskins.json';

const workskinSources = import.meta.glob('../../assets/examples/ao3-*.toml', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

/** What each example is for, shown under its title in the picker. */
const descriptions = new WeakMap<GroupFile, string>();

function described(file: GroupFile, description: string): GroupFile {
    descriptions.set(file, description);
    return file;
}

/** A sentence saying what a built-in example is for; undefined for any other group. */
export function exampleGroupDescription(file: GroupFile): string | undefined {
    return descriptions.get(file);
}

function workskinExample(file: string, title: string, description: string): GroupFile {
    const doc = parse(workskinSources['../../assets/examples/' + file], {
        joiner: '\n',
        bigint: false,
    }) as any;
    return described(
        {
            eo3: 'group',
            version: 1,
            title: 'AO3 · ' + title,
            // Every module of the document is in the file, so its indices are the file's too.
            inputs: doc.groups?.[0]?.inputs,
            modules: doc.modules.map((module: any) => ({
                plugin: module.plugin,
                title: module.title,
                data: module.data,
                sends: (module.sends ?? []).filter((target: unknown) => typeof target === 'number'),
                namedSends: module.namedSends,
                position: module.graphPos,
            })),
        },
        description
    );
}

/**
 * Example groups offered in "add node" → Groups. They are ordinary group files, imported the
 * same way as any other, and arrive unwired. Their classes use the `fx-` prefix: `eo3-` is
 * reserved for classes eo3 generates (lifted styles, part wrappers).
 */
function example(title: string, description: string, html: string, css: string): GroupFile {
    return described(
        {
            eo3: 'group',
            version: 1,
            title,
            modules: [
                {
                    plugin: 'source.text',
                    title: `${title} HTML`,
                    data: { contents: html, language: 'html' },
                    position: [0, 0],
                },
                {
                    plugin: 'source.text',
                    title: `${title} styles`,
                    data: { contents: css, language: 'css' },
                    position: [0, 72],
                },
            ],
        },
        description
    );
}

export const EXAMPLE_GROUPS: GroupFile[] = [
    ...catalog.map((item) => workskinExample(item.file, item.title, item.description)),
    example(
        'Text message thread',
        'A minimal text exchange: two lines of HTML and a few styles to build on.',
        '<div class="fx-text-thread"><p><strong>Alex</strong> <span>Are you there?</span></p><p><strong>Sam</strong> <span>On my way.</span></p></div>',
        '.fx-text-thread { padding: 1em; border: 1px solid #888; }\n.fx-text-thread p { margin: 0.5em 0; }\n.fx-text-thread strong { margin-right: 0.5em; }'
    ),
    example(
        'Letter',
        'A minimal framed letter in a serif typeface.',
        '<div class="fx-letter"><p>Dear friend,</p><p>Write your letter here.</p><p>Yours,<br />A friend</p></div>',
        '.fx-letter { padding: 1.5em; border: 1px solid #888; font-family: serif; }\n.fx-letter p { margin: 0 0 1em; }'
    ),
    example(
        'Chat log',
        'A minimal monospace chat transcript with speaker names.',
        '<div class="fx-chat-log"><p><strong>Alex:</strong> Hello!</p><p><strong>Sam:</strong> Hi.</p></div>',
        '.fx-chat-log { padding: 1em; background: #f5f5f5; font-family: monospace; }\n.fx-chat-log p { margin: 0.25em 0; }'
    ),
];
