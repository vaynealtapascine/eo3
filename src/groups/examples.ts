import type { GroupFile } from '../storage/group-file';

/**
 * Example groups offered in "add node" → Groups. They are ordinary group files, imported the
 * same way as any other, and arrive unwired. Their classes use the `fx-` prefix: `eo3-` is
 * reserved for classes eo3 generates (lifted styles, part wrappers).
 */
function example(title: string, html: string, css: string): GroupFile {
    return {
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
    };
}

export const EXAMPLE_GROUPS: GroupFile[] = [
    example(
        'Text message thread',
        '<div class="fx-text-thread"><p><strong>Alex</strong> <span>Are you there?</span></p><p><strong>Sam</strong> <span>On my way.</span></p></div>',
        '.fx-text-thread { padding: 1em; border: 1px solid #888; }\n.fx-text-thread p { margin: 0.5em 0; }\n.fx-text-thread strong { margin-right: 0.5em; }'
    ),
    example(
        'Letter',
        '<div class="fx-letter"><p>Dear friend,</p><p>Write your letter here.</p><p>Yours,<br />A friend</p></div>',
        '.fx-letter { padding: 1.5em; border: 1px solid #888; font-family: serif; }\n.fx-letter p { margin: 0 0 1em; }'
    ),
    example(
        'Chat log',
        '<div class="fx-chat-log"><p><strong>Alex:</strong> Hello!</p><p><strong>Sam:</strong> Hi.</p></div>',
        '.fx-chat-log { padding: 1em; background: #f5f5f5; font-family: monospace; }\n.fx-chat-log p { margin: 0.25em 0; }'
    ),
];
