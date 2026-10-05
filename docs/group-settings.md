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

Use `text`, `paragraph`, `color`, `number`, `toggle`, or `choice`. Choice fields use
`options: ["First", "Second"]`; colors use six-digit hex strings. Keys should be unique
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
