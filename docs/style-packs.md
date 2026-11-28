# Styles and style packs

## What is this?

A style is a look that a writer can put on their text. For example, a style can make text
look like a note card, a whisper or a text message.

The writer selects some text. Then the writer clicks **✦ Styles** and picks a style. eo3 adds
the HTML and the CSS that make the look.

A style pack is a file that holds one or more styles. You can make a pack and give it to other
writers. They import it, and then they can use your styles.

All the styles that come with eo3 use the same format as your styles. eo3 has no secret
features for its own styles. Anything that a built-in style does, your style can also do.

## How to make a style

You can make a style in two ways.

To make a style in eo3:

1. In the rich text editor, click **✦ Styles**.
2. Click **+ Create / Export**.
3. Click the **Create & export** tab.
4. Type the parts of your style. A live preview shows the result.
5. Read the AO3 checks. They tell you what AO3 will remove.

To learn from a built-in style:

1. Click **✦ Styles**, then **+ Create / Export**.
2. Click the **Library & export** tab.
3. Open **Built-in styles**.
4. Find a style and click **Copy & edit**. You get a copy that you can change.

You can also write a `.eo3styles.json` file by hand. The next section shows the format.

To share your styles, use the **Library & export** tab. Writers use the **Import pack** tab to
add your pack.

## The pack file

A pack file is JSON. This example has one style:

```json
{
    "eo3": "styles",
    "version": 1,
    "title": "Cozy styles",
    "author": "you",
    "styles": [
        {
            "label": "Parchment",
            "description": "Warm note card",
            "kind": "block",
            "className": "cozy-parchment",
            "css": ".cozy-parchment { background-color: #fbf7ee; padding: 1em; }"
        }
    ]
}
```

Each style can have these properties:

| Property                    | What it does                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `label`, `description`      | The name and the short text that **✦ Styles** shows.                                                         |
| `kind`                      | `inline` puts a `<span>` around the text. `block` puts a `<div>` around paragraphs. `template` inserts HTML. |
| `className`                 | The main class of the style. Do not start it with `eo3-` or `fx-`. eo3 uses these names.                     |
| `css`                       | The Work Skin CSS. Do not write `#workskin`. eo3 adds it when it exports.                                    |
| `templateHtml`              | For `template`: the HTML to insert. For `inline`: it makes an inline template (see below).                   |
| `fields`                    | The questions that the writer answers when they apply the style.                                             |
| `previewSample`             | The sample text in the small preview. For a template, the preview uses it as the selection.                  |
| `previewHtml`, `previewCss` | HTML and CSS for the small preview only. You do not have to use them.                                        |
| `extraClasses`              | Other classes that your `css` uses. If you do not give them, eo3 finds them.                                 |

## Template syntax

A template is HTML with tags in it. eo3 changes each tag into a value. A tag can be anywhere,
also in an attribute, for example `class="{{alt:in|out}}"`.

eo3 makes values safe before it puts them in the HTML. Then eo3 cleans the result with the
AO3 rules. Thus the preview shows only what AO3 will keep.

| Tag                                        | eo3 changes it into                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `{{selection}}`                            | The selected text. If the text has many lines, eo3 joins them with `<br>`.          |
| `{{selection\|Starter text}}`              | The selected text. If the writer selects nothing, the starter text.                 |
| `<p class="x">{{selection}}</p>`           | One paragraph like this for each selected line.                                     |
| `{{key}}`, `{{key\|Default}}`              | The value of a field.                                                               |
| `{{#if key}}…{{else}}…{{/if}}`             | The first part if a text field has text or a toggle is on. If not, the second part. |
| `{{#if !key}}…{{/if}}`                     | The opposite of `{{#if key}}`.                                                      |
| `{{#lines\|Line one⏎Line two}}…{{/lines}}` | The part between the tags, one time for each selected line (or each starter line).  |

You can use these tags between `{{#lines}}` and `{{/lines}}`:

| Tag                             | eo3 changes it into                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{line}}`                      | All of the line.                                                                                                                                           |
| `{{text}}`, `{{speaker}}`       | For a line like `Name: message`: the message, and the name.                                                                                                |
| `{{index}}`                     | The number of the line: 1, 2, 3 and so on.                                                                                                                 |
| `{{alt:a\|b\|…}}`               | The next option in the list, in turn. If each line names one of two or more speakers, each speaker gets an option. If not, each line gets the next option. |
| `{{#if speaker}}`               | True if the line names a speaker.                                                                                                                          |
| `{{#if many-speakers}}`         | True if each line names a speaker, and there are three speakers or more.                                                                                   |
| `{{#if first}}`, `{{#if last}}` | True for the first line, or for the last line.                                                                                                             |

If your template has a mistake, eo3 tells you. For example, it shows a field name that does
not exist, or an `{{#if}}` that has no `{{/if}}`. You see these messages next to the AO3 checks.

## Fields

A field is a question that the writer answers when they apply your style. Example:

```json
"fields": [
    { "key": "summary", "label": "Summary (always shown)", "default": "Spoiler" },
    { "key": "loud", "label": "Shout it", "type": "toggle", "default": false },
    { "key": "who", "label": "Speaker", "placeholder": "e.g. Alex", "required": true }
]
```

When a style has fields, eo3 shows a small form before it applies the style.

-   A text field can have a `default` value, a `placeholder` and `required`.
-   A toggle (`"type": "toggle"`) is on or off. Use it with `{{#if}}`.
-   A `key` can have letters, numbers, `-` and `_`.
-   Do not use the keys `line`, `text`, `speaker` or `index`. `{{#lines}}` uses these names.
-   A field with the key `selection` does not add a question. In an inline template, it sets
    the label and the placeholder for the selected text.

## Inline templates

An inline template is an `inline` style that has `templateHtml`. eo3 inserts it as one item.
The writer can select it again to change its fields. The writer can also remove it and keep
its text.

The HTML of an inline template must start with a `<span>` that has the `className` of the
style. When a writer opens their work again, eo3 uses this class to find the template.

The built-in style **Translate on hover** is an inline template:

```json
{
    "label": "Translate on hover",
    "kind": "inline",
    "className": "fx-translate",
    "templateHtml": "<span class=\"fx-translate\">{{selection}}<span class=\"fx-translate-tip\">{{#if parens}}<span class=\"fx-translate-paren\"> (</span>{{/if}}{{translation}}{{#if parens}}<span class=\"fx-translate-paren\">)</span>{{/if}}</span></span>",
    "fields": [
        { "key": "selection", "label": "Original text", "required": true },
        { "key": "translation", "label": "Translation (shown on hover)", "required": true },
        {
            "key": "parens",
            "label": "Show (translation) fallback when styles are off",
            "type": "toggle",
            "default": true
        }
    ]
}
```

## How eo3 makes its built-in styles

| Built-in style                   | How eo3 makes it                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Redacted, Small caps, Whisper, … | `inline` styles: a class and some CSS.                                                     |
| Callout, Letter, Terminal, …     | `block` styles: a class and some CSS.                                                      |
| Translate on hover               | An inline template with two text fields and one toggle (see above).                        |
| Text messages                    | A template with `{{#lines}}`, `{{alt:fx-msg-in\|fx-msg-out}}` and `{{#if many-speakers}}`. |
| Collapsible spoiler              | A `<details>` template with a `summary` field.                                             |

## Make your styles easy for all readers

-   Give each field a clear `label`. Screen readers read the label aloud.
-   Make sure that readers can read the text when the creator's style is off on AO3. For
    example, Translate on hover keeps "(translation)" in the text. The spoiler style uses
    `<details>`, which works with no CSS.
-   Make sure that the colours of your text and background have good contrast. Do a check in
    the light site skin and in the dark site skin.
