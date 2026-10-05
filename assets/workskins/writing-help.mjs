const prose = [
    ['A paragraph\n\nAnother paragraph', 'Leave a blank line between paragraphs.'],
    [
        '*italic* · **bold** · ~~struck out~~ · `code`',
        'Inline formatting; HTML is treated as text.',
    ],
];
const chat = [
    ['Alex [09:41]: Hello', 'One speaker per line. The time is optional.'],
    ['A second line', 'A line without a speaker continues the previous message.'],
    ['! Someone joined', 'An event on its own line.'],
    ['> Quoted message\n+ Like (2)', 'Put a quote or reaction below its message.'],
];
const headers = [
    '---\nKey: value\n---',
    'Headers override Details. Use them at the start of each later item.',
];

/** Literal syntax examples, shared by the editor and downloadable guides. */
export const writingHelp = {
    'text-messages': [...chat, ...prose.slice(1)],
    'group-chat': [...chat, ...prose.slice(1)],
    email: [
        ['--- message ---', 'Start another email. Details applies to the first email.'],
        [
            '---\nFrom: Alex\nTo: Sam\nSubject: Hello\n---',
            'Give each later email its own header, then write its body.',
        ],
        ['> Earlier message', 'Prefix each quoted line with >.'],
        ...prose,
    ],
    letter: [...prose, ['> Quoted passage', 'Prefix each quoted line with >.']],
    journal: [
        ['## 01 January', 'Start an entry with a date or title.'],
        ['> Margin note', 'Show a note beside the entry.'],
        ...prose,
    ],
    newspaper: [...prose, ['> Quoted passage', 'Set a quotation apart from the article.']],
    'case-file': [
        ['## Statement', 'Start a report section.'],
        ['> Witness statement', 'Set a statement apart from the report.'],
        ['**[REDACTED]**', 'Type the replacement text; remove the original words.'],
        ...prose,
    ],
    'social-thread': [
        ['--- post ---', 'Start another post. Details applies to the first post.'],
        [
            '---\nName: Alex\nHandle: @alex\nReply: @sam\n---',
            'Give later posts their own headers. Reply is optional.',
        ],
        ['> Quoted post', 'Quote a post inside the current one.'],
        ...prose,
    ],
    transcript: [
        ['[00:18] Alex: Hello', 'A speaker turn. Times may be omitted or written after the name.'],
        ['A second line', 'Continue the previous speaker’s turn.'],
        ['! A door closes', 'A stage direction on its own line.'],
        ...prose.slice(1),
    ],
    terminal: [
        ['$ cat notes.txt', 'A command prompt, displayed only; nothing is executed.'],
        ['[09:41] WARN Connection lost', 'WARN and ERROR highlight warning lines.'],
        [
            'Line one\n\nLine three',
            'Line breaks and blank lines are preserved. Formatting marks stay literal.',
        ],
    ],
    poetry: [
        [
            'First line\n  Indented line\n\nNext stanza',
            'Newlines make verses; blank lines make stanzas. Leading spaces indent.',
        ],
        ...prose.slice(1),
    ],
    'chapter-opening': [
        ...prose,
        [
            'End of scene\n\n---\n\nNext scene',
            'A scene break needs blank lines around the three dashes.',
        ],
    ],
    footnotes: [
        ['A reference[^note]', 'Place a reference where the note link belongs.'],
        [
            '[^note]: Note text',
            'Define the matching key below the prose. Notes are numbered in reading order.',
        ],
        ...prose,
    ],
    'collapsible-notes': [
        [
            '::: Translation\nOptional text\n:::',
            'Open a panel with its title; close it with ::: on its own line.',
        ],
        [
            'Story text outside the panel',
            'Keep essential text outside panels. Panels cannot be nested.',
        ],
        ...prose,
    ],
};

export const headerHelp = headers;

export const appearanceFields = [
    {
        key: '_size',
        label: 'Text size',
        type: 'choice',
        options: ['Original', 'Larger', 'Largest'],
        default: 'Original',
    },
    {
        key: '_width',
        label: 'Width',
        type: 'choice',
        options: ['Original', 'Narrow', 'Wide'],
        default: 'Original',
    },
    {
        key: '_font',
        label: 'Typeface',
        type: 'choice',
        options: ['Original', 'Serif', 'Sans serif', 'Monospace'],
        default: 'Original',
    },
].map((field) => ({ ...field, section: 'Appearance', advanced: true }));
