// Existing standard Lorem ipsum is used throughout, never generated story prose.
const a = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
const b = 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
const c =
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
const d =
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
const e =
    'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
const header = (fields, body) =>
    `---\n${Object.entries(fields)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')}\n---\n${body}\n`;

export const examples = {
    'text-messages': {
        component: 'ChatLog',
        props: 'variant="messages"',
        writing: header(
            {
                Title: 'Messages',
                Self: 'Person B',
                Date: 'Monday · 09:41',
                Status: 'Delivered · 09:44',
            },
            `Person A [09:41]: ${a}\nPerson B [09:42]: ${b}\nPerson A [09:43]: *Ut enim ad minim veniam.*\nQuis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nPerson B [09:44]: ${d}`
        ),
        syntax: 'NAME: text',
        guide: 'One message per NAME: line. Optional times: NAME [09:41]: text. A line without a name continues the message. Set Self in the header for outgoing bubbles. Use ! for events, > for quoted replies, + for reactions, and a leading backslash for a literal line.',
    },
    'group-chat': {
        component: 'ChatLog',
        props: 'variant="group"',
        writing: header(
            { Title: '# general', Date: 'Monday', Status: 'End of conversation · 09:45' },
            `! 09:41 · Person C joined the conversation.\nPerson A [09:42]: ${a}\nPerson B [09:43]: ${b}\n> Person A: Lorem ipsum dolor sit amet.\nUt enim ad minim veniam.\nPerson C [09:44]: Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n+ +1 (2)`
        ),
        syntax: 'NAME: text · ! event · > quote · + reaction',
        guide: 'Type NAME: text; speaker accents are assigned automatically. Use ! event on its own line. Put > quote or + reaction below a message. Times are optional. Add or remove participants without changing the renderer.',
    },
    email: {
        component: 'EmailThread',
        writing:
            header(
                {
                    From: 'Person A <a@example.com>',
                    To: 'Person B <b@example.com>',
                    Date: '01 January · 09:41',
                    Subject: 'Re: Lorem ipsum',
                    Signature: 'Person A',
                    Attachment: 'lorem-ipsum.txt · 1 KB',
                },
                `Lorem ipsum dolor sit amet,\n\n${b}\n\n${c}\n\n> On 01 January at 09:00, Person B wrote:\n> ${d}`
            ) +
            '\n--- message ---\n' +
            header(
                {
                    From: 'Person B <b@example.com>',
                    To: 'Person A <a@example.com>',
                    Date: '01 January · 09:00',
                    Subject: 'Lorem ipsum',
                },
                a
            ),
        syntax: 'From: / To: / Subject: · --- message ---',
        guide: 'Edit the headers between the --- lines, then write paragraphs below. Quote an earlier email with >. Separate complete emails with --- message ---. Signature and Attachment headers are optional.',
    },
    letter: {
        component: 'Letter',
        writing: header(
            {
                Label: 'Personal correspondence',
                Date: '01 January',
                Place: 'Lorem ipsum',
                To: 'Dear Person B,',
                Closing: 'Yours,',
                From: 'Person A',
                PS: 'Lorem ipsum dolor sit amet.',
            },
            `${a}\n\n${b}\n\n${c}\n\n${d}`
        ),
        syntax: 'Date: / To: / From: · plain paragraphs',
        guide: 'Edit Date, Place, To, Closing, From and PS between the --- lines. Write the letter beneath them. Blank lines make paragraphs. Remove any optional header you do not need. Reuse Letter with another text input for a second letter.',
    },
    journal: {
        component: 'Journal',
        writing: header(
            { Title: 'Private journal' },
            `## 01 January · 09:41 · Entry 01\n${a} ${b}\n\n${c}\n\n~~Duis aute irure dolor.~~ In reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.\n\n## 02 January · 22:14 · Entry 02\n${e}\n\n> Lorem ipsum dolor sit amet.`
        ),
        syntax: '## date · ~~crossed out~~ · > margin note',
        guide: 'Start an entry with ## and its date. Write paragraphs below. Use ~~text~~ for crossings-out and > text for a margin note. Add another ## heading for the next day; no HTML needs duplicating.',
    },
    newspaper: {
        component: 'Newspaper',
        writing: header(
            {
                Paper: 'The Lorem Ipsum',
                Edition: 'Vol. 01 · No. 01',
                Date: '01 January · Morning edition',
                Section: 'Local / Correspondence',
                Title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit',
                Deck: b,
                By: 'Person A · Staff writer',
                Footer: 'Continued on page 02',
            },
            `${a} ${b}\n\n${c}\n\n${d}\n\n${e}`
        ),
        syntax: 'Paper: / Title: / By: · plain paragraphs',
        guide: 'Change the masthead, headline, deck and byline in the header. Write the article as ordinary paragraphs. The component handles the newspaper layout. Remove optional headers or reuse it with another article input.',
    },
    'case-file': {
        component: 'CaseFile',
        writing: header(
            {
                Classification: 'Confidential / Fictional sample',
                Title: 'Case file',
                Number: '0001',
                Subject: 'Person A',
                'Compiled by': 'Person B',
                Date: '01 January',
                Status: 'Open',
                Footer: 'File 0001 · Page 1 of 1',
            },
            `## 01 / Summary\n${a} ${b}\n\n## 02 / Statement\n> ${c}\n\n## 03 / Redacted excerpt\nDuis aute irure dolor **[REDACTED]** in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`
        ),
        syntax: 'Field: value · ## section · > statement',
        guide: 'Add report fields in the header; extra fields are rendered automatically. Use ## for sections and > for a statement. Write [REDACTED] as literal text instead of putting hidden information underneath a black bar.',
    },
    'social-thread': {
        component: 'SocialFeed',
        writing:
            header(
                {
                    Name: 'Person A',
                    Handle: '@person_a',
                    Time: '09:41',
                    Metrics: '12 replies · 24 reposts · 128 likes',
                },
                a
            ) +
            '\n--- post ---\n' +
            header(
                {
                    Name: 'Person B',
                    Handle: '@person_b',
                    Time: '09:42',
                    Reply: '@person_a',
                    Metrics: '2 replies · 8 likes',
                },
                b
            ) +
            '\n--- post ---\n' +
            header(
                {
                    Name: 'Person C',
                    Handle: '@person_c',
                    Time: '09:44',
                    Metrics: '3 reposts · 16 likes',
                },
                `Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n\n> **Quoted post · @person_a**\n> ${a}`
            ),
        syntax: 'Name: / Handle: / Reply: · --- post ---',
        guide: 'Write posts with Name, Handle and optional Time, Reply and Metrics headers. Separate them with --- post ---. Use > to quote a post. Adding Reply automatically applies the nested reply layout.',
    },
    transcript: {
        component: 'Transcript',
        writing: header(
            {
                Recording: 'Recording 001 / Transcript',
                Title: 'Lorem ipsum',
                Date: '01 January · 00:00–01:12',
            },
            `! [Recording begins]\n[00:00] Person A: ${a}\n[00:18] Person B: ${b}\n! [Pause · 00:34–00:42]\n[00:42] Person A: ${c}\n! [Recording ends · 01:12]`
        ),
        syntax: '[00:18] NAME: text · ! direction',
        guide: 'Type [timecode] NAME: text. Times may also follow the name in brackets, or be omitted. A line without a name continues the turn. Use ! for stage directions. The speaker list is collected from your turns.',
    },
    terminal: {
        component: 'Terminal',
        writing: header(
            { Title: 'Terminal / Session 001' },
            `$ cat lorem.txt\n${a}\n${b}\n\n$ tail system.log\n[09:41:00] INFO · Ut enim ad minim veniam.\n[09:41:01] INFO · Quis nostrud exercitation ullamco laboris.\n[09:41:02] WARN · Duis aute irure dolor in reprehenderit.\n$ _`
        ),
        syntax: '$ command · [time] INFO / WARN / ERROR',
        guide: 'Write a log one line at a time. Lines starting with $ are command prompts; WARN and ERROR receive warning colors. Text and commands are displayed literally and never executed. Blank lines stay as breaks.',
    },
    poetry: {
        component: 'Poem',
        writing: header(
            { Label: 'Verse / Fragment', Title: 'Lorem ipsum', By: 'Person A' },
            `Lorem ipsum dolor sit amet,\n  consectetur adipiscing elit,\nsed do eiusmod tempor incididunt\n  ut labore et dolore magna aliqua.\n\nUt enim ad minim veniam,\n  quis nostrud exercitation ullamco laboris\nnisi ut aliquip ex ea commodo consequat.`
        ),
        syntax: 'Line breaks · blank-line stanzas · indentation',
        guide: 'Write the poem with ordinary line breaks. Blank lines separate stanzas, and leading spaces preserve indentation. Title, Label and By are optional. Emphasis works with *text* and **text**.',
    },
    'chapter-opening': {
        component: 'ChapterOpening',
        writing: header(
            {
                Chapter: 'Chapter 01',
                Title: 'Lorem ipsum',
                Subtitle: '01 January',
                Epigraph: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
                Attribution: 'Person A',
            },
            `${a} ${b}\n\n${c}\n\n---\n\n${d}\n\n${e}`
        ),
        syntax: 'Title: / Epigraph: · --- scene break',
        guide: 'Set the chapter heading and optional epigraph in the header. Write prose below it. Put --- on its own line, with blank lines around it, for a scene break. The first paragraph receives a drop cap.',
    },
    footnotes: {
        component: 'Footnotes',
        writing: header(
            { Title: 'Lorem ipsum', Id: 'fic-notes' },
            `Lorem ipsum dolor sit amet, consectetur adipiscing elit.[^lorem] ${b}\n\nUt enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.[^ipsum]\n\n${d}\n\n[^lorem]: ${a}\n[^ipsum]: ${e}`
        ),
        syntax: 'text[^key] · [^key]: note',
        guide: 'Put [^key] after a reference and define it below as [^key]: note text. Notes are numbered in reading order, with links back to the prose. Set a different Id when reusing Footnotes in the same chapter. Missing definitions remain visible for you to fix.',
    },
    'collapsible-notes': {
        component: 'Extras',
        writing: header(
            { Title: 'Lorem ipsum' },
            `${a} ${b}\n\n${c}\n\n::: Translation / Lorem ipsum\n${d}\n:::\n\n::: Optional notes / Lorem ipsum\n${e}\n\n${a}\n:::\n\n${b}`
        ),
        syntax: '::: panel title … :::',
        guide: 'Start an optional panel with ::: and its title. Close it with ::: on its own line. Keep essential story text outside panels. The component makes native details panels that still work when readers hide the workskin.',
    },
};
