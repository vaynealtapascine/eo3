# Authoring group settings

A group exposes its Settings node through the existing group inputs. Add a Settings node,
send it to your Svelte node as a named input called `settings`, and import it:

```js
import settings from './settings';
// settings.signature, settings.size, etc.
```

In the simple view, open Customize and choose **show up front** on the Settings node.
Writers then get the form; the implementation stays inside Customize. Configure the fields
in the nodes view using **Fields → Options**. These controls use eo3's existing UI kit.

Group developers can also generate the same JSON directly. The Settings node's `data` is:

```json
{
    "fields": [
        { "key": "signed", "label": "Include signature", "type": "toggle", "default": true },
        {
            "key": "signature",
            "label": "Signature",
            "type": "text",
            "default": "A friend",
            "section": "Letter",
            "hint": "The name at the end of the letter.",
            "showWhen": { "key": "signed", "equals": true }
        },
        {
            "key": "size",
            "label": "Text size",
            "type": "number",
            "default": 16,
            "min": 10,
            "max": 32,
            "step": 1,
            "advanced": true
        }
    ],
    "values": {}
}
```

Use `text`, `paragraph`, `color`, `number`, `toggle`, `choice`, or `list`. Choice fields use
`options: ["First", "Second"]`; colors use six-digit hex strings, and a color field's
`options` are offered as suggested swatches in its picker. Keys should be unique
and stable. Defaults apply when no saved value exists; explicit empty strings, zero,
and false override defaults. Changing a default does not replace a writer's saved value.

Sections appear in first-occurrence order, with fields retaining their order inside
each section. Advanced fields appear in a separate, initially closed disclosure.
`showWhen` compares another field's effective value using strict equality (including its
default). Conditions affect presentation only: hidden values remain saved and exported.
Use the controlling value in your component to decide whether to render dependent content.
Missing controlling keys hide the dependent field. No JavaScript expressions are executed
by the form.

Numeric bounds apply both to the form and evaluated output. Contradictory bounds are
ignored; non-finite bounds are ignored individually. `step` controls the browser's numeric
increment, without rounding stored values. Fields without the new optional properties keep
their previous behavior.

The metadata lives in ordinary module data, so it travels with work downloads, group
exports, My groups, copies, and undo history. In a group file, include the Settings module's
index in `inputs`, for example `"inputs": [{ "module": 0, "label": "Details" }]`.

## Lists writers can grow

A `list` field holds entries the writer adds, reorders and removes. Each entry has the list's
own `fields` (any field type, including another list), and evaluates to an array of objects:

```json
{
    "key": "people",
    "label": "People",
    "type": "list",
    "itemLabel": "Person",
    "minItems": 1,
    "maxItems": 8,
    "fields": [
        { "key": "name", "label": "Name", "default": "Someone" },
        { "key": "color", "label": "Bubble color", "type": "color", "default": "#3366cc" }
    ],
    "default": [{ "name": "Ann", "color": "#aa3355" }]
}
```

`settings.people` is then `[{ name: "Ann", color: "#aa3355" }]`. `itemLabel` names the
"+ Add person" button; `minItems`/`maxItems` bound the number of entries (the form keeps at
least `minItems`, and contradictory bounds are ignored). `default` is the starting entries.
Every entry gets every item field, with its default when missing, so code never sees a hole.
`showWhen` inside an entry compares that entry's own fields. Renaming an item field in
**Options** doesn't move entries' saved values to the new name.

## Fields written as code

Under **Fields → Write the fields as code**, the fields can be TypeScript or JavaScript whose
default export is the list of fields, or a function returning it, so loops can make them:

```ts
const moods = ['calm', 'tense', 'happy'];
export default [
    { key: 'title', label: 'Title' },
    ...moods.map((m) => ({ key: `${m}Color`, label: `${m} color`, type: 'color' })),
];
```

**Apply** runs it in the script sandbox (see below), checks the result, and replaces the
fields; writers' values are kept. The code is saved as `fieldsCode` next to `fields`, but the
form only ever reads `fields`, so opening a work never runs it.

## Generating CSS, HTML, Svelte… from settings: the Script module

A **Script** module (nodes view, "add node" → Advanced) is TypeScript or JavaScript whose
default export is its output: text, or a function (it may be `async`) that returns it.
Choose what that text is with **Output as**: CSS, HTML, JavaScript module, Svelte component,
plain text, or any other MIME type. The output is that type everywhere: CSS styles a
chapter or feeds Sass, HTML is chapter content, a Svelte component can be sent to a Svelte
module, and so on.

```ts
import settings from './settings';

type Person = { name: string; color: string };

export default function (): string {
    return settings.people
        .map((p: Person, i: number) => `.chat .p${i} { color: ${p.color}; }`)
        .join('\n');
}
```

-   Send modules to a script as **named inputs**; import them as `./<name>` (the names are
    the only imports there are). The default-export function also gets them by name:
    `export default ({ settings }) => …`. JavaScript and TypeScript modules are imported as
    modules; text (CSS, HTML, plain text) as a string default export.
-   **Inputs and how to use them** under the editor lists each import with the TypeScript
    type of its values, generated from the Settings fields.
-   With **Output as: JavaScript module**, a script may return data instead of text; it is
    passed on as `export default <data>`, for Svelte or another script to import.
-   Types are removed, not checked (there's no TypeScript checker in the browser).
-   Scripts run in a sandbox: a hidden iframe with its own opaque origin and a worker inside
    it, so they can't reach eo3, the page or your library, and are stopped after 5 seconds.

TypeScript also works in a **Text** module (mode "TypeScript", passed on as JavaScript) and
in Svelte components with `<script lang="ts">`, in every Svelte version.

## Typed inputs

Data carries its MIME type, and inputs accept text labelled with theirs: a File Data module
in text mode passes a `.css` file on as CSS (so it can style chapters), `.html` as HTML and
`.js` as JavaScript, and a script's output is whatever type you chose.

## Writing help

Text inputs can also carry a `help` object in their module data. It appears under
**Writing help**, beside the editor, and never becomes part of the output:

```json
{
  "language": "text",
  "contents": "",
  "help": {
    "summary": "Write one message per line.",
    "examples": [
      { "syntax": "Alex [09:41]: Hello", "description": "Speaker, optional time, and message." }
    ]
  }
}
```
