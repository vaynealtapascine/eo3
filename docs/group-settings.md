# Block settings

## What is this?

A block is a group of nodes. It makes one thing in a chapter, for example a letter or a chat
log. Settings are a form that comes with a block. The writer changes the values in the form,
and the block changes.

Think of a block as a machine and of settings as the knobs on the front of the machine. The
writer turns the knobs. The writer does not have to open the machine.

The form comes from a **Settings** node. You add the node to the block, and you tell it which
questions to ask.

## How to add settings to a block

1. Add a **Settings** node to the group.
2. Send the Settings node to your Svelte node as a named input. Use the name `settings`.
3. In your Svelte code, import the settings:

    ```js
    import settings from './settings';
    // settings.signature, settings.size and so on
    ```

4. Open the nodes view. On the Settings node, open **Fields**.
5. Add a field for each question. To change a field, open **Options for** that field.
6. Go to the simple view. Open **Customize** and click **show up front** on the Settings node.

Now the writer sees the form. The other nodes stay in **Customize**, out of the way.

## The settings data

You can also write the data of the Settings node by hand. It is JSON:

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

### Types of fields

| `type`      | The writer gets                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`      | One line of text.                                                                                                                            |
| `paragraph` | Many lines of text.                                                                                                                          |
| `color`     | A colour picker. Values are six-digit hex strings, for example `#3366cc`. If you give `options`, the picker shows them as suggested colours. |
| `number`    | A number.                                                                                                                                    |
| `toggle`    | On or off.                                                                                                                                   |
| `choice`    | A drop-down. Give the choices as `options`, for example `["First", "Second"]`.                                                               |
| `list`      | Entries that the writer adds, moves and removes. See "Lists" below.                                                                          |

### Keys and default values

-   Give each field a `key` that is different from the other keys.
-   Do not change a key after writers use your block. Their saved values use the key.
-   eo3 uses the `default` value only when the writer has no saved value.
-   An empty text, `0` and `false` are saved values. They replace the default.
-   If you change a default, the saved values of writers do not change.

### Sections and advanced fields

-   `section` puts fields under a heading. The sections are in the order that they first
    appear. The fields in a section stay in their order.
-   `"advanced": true` puts a field in a separate part of the form. This part is closed at
    the start.

### Show a field only sometimes

`showWhen` shows a field only when another field has a given value. In the example,
**Signature** shows only when **Include signature** is on.

-   eo3 compares the value exactly. It uses the default value if the writer has no saved
    value.
-   If the other key does not exist, eo3 hides the field.
-   A hidden field still has its value. eo3 saves it and exports it. Thus your code must
    also examine the other field. For example, show the signature only if `settings.signed`
    is true.
-   The form does not run code. `showWhen` is only a comparison.

### Numbers

-   `min` and `max` limit the number in the form and in the output.
-   If `min` is more than `max`, eo3 ignores both. If one of them is not a real number, eo3
    ignores that one.
-   `step` sets how much the arrows in the number box add or remove. eo3 does not round the
    saved value.
-   Fields that do not have these properties work as before.

### Where the settings go

The fields and the values are part of the node's data. Thus they go with the work into
downloads, group exports, **My groups**, copies and the undo history.

In a group file, put the index of the Settings node in `inputs`, for example
`"inputs": [{ "module": 0, "label": "Details" }]`.

## Lists

A `list` field holds entries. The writer can add, move and remove entries. Each entry has
its own `fields`. These fields can be of any type, also another list.

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

With this list, `settings.people` is `[{ name: "Ann", color: "#aa3355" }]`.

-   `itemLabel` is the name on the add button, for example "+ Add person".
-   `minItems` and `maxItems` set the smallest and the largest number of entries. The form
    always keeps `minItems` entries. If `minItems` is more than `maxItems`, eo3 ignores both.
-   `default` gives the entries at the start.
-   Each entry always has each field. If a value is missing, eo3 uses the default of that
    field. Thus your code never finds a hole.
-   `showWhen` in an entry compares fields of the same entry.
-   If you change the key of an item field in **Options**, the saved values stay on the old
    key. They do not move to the new key.

## Write the fields as code

You can make the fields with code. This is useful when you have many fields that are almost
the same. Open **Write the fields as code**. Write TypeScript or JavaScript. The default export
is the list of fields, or a function that returns the list:

```ts
const moods = ['calm', 'tense', 'happy'];
export default [
    { key: 'title', label: 'Title' },
    ...moods.map((m) => ({ key: `${m}Color`, label: `${m} color`, type: 'color' })),
];
```

Click **Apply**. eo3 runs the code in the script sandbox (see the next section). eo3 checks
the result and replaces the fields. The values that writers saved do not change.

eo3 saves the code as `fieldsCode` next to `fields`. The form reads only `fields`. Thus eo3
never runs the code when someone opens a work.

## Make CSS, HTML or Svelte from settings: the Script node

A **Script** node runs TypeScript or JavaScript and gives its result to other nodes. To add
one, open the nodes view, click "add node" and look under **Advanced**.

The default export is the output. It can be text, or a function that returns text. The
function can be `async`.

Use **Output as** to tell eo3 what the text is: CSS, HTML, a JavaScript module, a Svelte
component, plain text or another MIME type. Other nodes then use it as that type. For
example, CSS output can style a chapter, and HTML output can be chapter content.

```ts
import settings from './settings';

type Person = { name: string; color: string };

export default function (): string {
    return settings.people
        .map((p: Person, i: number) => `.chat .p${i} { color: ${p.color}; }`)
        .join('\n');
}
```

-   Send nodes to the script as **named inputs**. Import each one as `./<name>`. A script can
    import only its named inputs.
-   The default-export function also gets the inputs by name:
    `export default ({ settings }) => …`.
-   A JavaScript or TypeScript input comes in as a module. A text input (CSS, HTML, plain
    text) comes in as a string, as the default export.
-   Under the editor, **Inputs and how to use them** shows each import and the TypeScript type
    of its values. eo3 makes these types from the Settings fields.
-   With **Output as: JavaScript module**, the script can return data, not text. eo3 gives it
    to other nodes as `export default <data>`. A Svelte node or another script can import it.
-   eo3 removes the TypeScript types. It does not check them. The browser has no TypeScript
    checker.

Scripts run in a sandbox. A sandbox is a closed box: a hidden frame with its own origin, and
a worker in that frame. A script cannot get to eo3, to the page or to your library. eo3 stops
a script after 5 seconds.

You can also use TypeScript in two other places:

-   In a **Text** node, in the "TypeScript" mode. eo3 gives it to other nodes as JavaScript.
-   In Svelte components, with `<script lang="ts">`. This works in all Svelte versions.

## Data types of inputs

Data in eo3 has a MIME type. An input that gets text also gets the type of that text.

-   A **File Data** node in text mode gives a `.css` file as CSS. Thus the file can style
    chapters.
-   The same node gives a `.html` file as HTML, and a `.js` file as JavaScript.
-   A script gives the type that you set in **Output as**.

## Writing help

A text input can have writing help. Writing help tells the writer how to write the text, for
example "one message on each line". It shows under **Writing help**, next to the editor. It
is never part of the output.

To add writing help, click **Add writing help for writers** under the text input. Type a
summary and some example rows.

You can also put a `help` object in the data of the node:

```json
{
    "language": "text",
    "contents": "",
    "help": {
        "summary": "Write one message per line.",
        "examples": [
            {
                "syntax": "Alex [09:41]: Hello",
                "description": "Speaker, optional time, and message."
            }
        ]
    }
}
```
