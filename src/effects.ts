/**
 * Small, editable starting points for repeated effects. Their classes use the `fx-` prefix:
 * `eo3-` is reserved for classes eo3 generates (lifted styles, part wrappers).
 */
export const EFFECTS = {
    'text-thread': {
        title: 'Text message thread',
        html: '<div class="fx-text-thread"><p><strong>Alex</strong> <span>Are you there?</span></p><p><strong>Sam</strong> <span>On my way.</span></p></div>',
        css: '.fx-text-thread { padding: 1em; border: 1px solid #888; }\n.fx-text-thread p { margin: 0.5em 0; }\n.fx-text-thread strong { margin-right: 0.5em; }',
    },
    letter: {
        title: 'Letter',
        html: '<div class="fx-letter"><p>Dear friend,</p><p>Write your letter here.</p><p>Yours,<br />A friend</p></div>',
        css: '.fx-letter { padding: 1.5em; border: 1px solid #888; font-family: serif; }\n.fx-letter p { margin: 0 0 1em; }',
    },
    'chat-log': {
        title: 'Chat log',
        html: '<div class="fx-chat-log"><p><strong>Alex:</strong> Hello!</p><p><strong>Sam:</strong> Hi.</p></div>',
        css: '.fx-chat-log { padding: 1em; background: #f5f5f5; font-family: monospace; }\n.fx-chat-log p { margin: 0.25em 0; }',
    },
} as const;

export type EffectKey = keyof typeof EFFECTS;
