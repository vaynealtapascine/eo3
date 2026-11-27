# Authoring styles and style packs

A style is what writers apply from **✦ Styles** in the rich editor. Every built-in style is
ordinary style data in the same format you write. Nothing a built-in does is reserved for
eo3. To see how one is made, open **✦ Styles → + Create / Export → Library**, then
**Built-in styles → Copy & edit**.

You can make styles in the **Create & export** tab (with live previews and AO3 checks) or write
a `.eo3styles.json` file by hand. Writers import packs from **Import pack**, and you can
export your own from **Library & export**.

## The pack file

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

| Property                    | Meaning                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `label`, `description`      | What ✦ Styles shows.                                                                   |
| `kind`                      | `inline` (a `<span>`), `block` (a `<div>` around paragraphs) or `template` (HTML).     |
| `className`                 | The main class. Don't start it with `eo3-` (eo3's own) or `fx-` (built-ins).           |
| `css`                       | Work Skin CSS, without `#workskin`; eo3 adds it when exporting.                        |
| `templateHtml`              | For `template`, the HTML to insert. For `inline`, it makes an inline template (below). |
| `fields`                    | What applying the style asks the writer for.                                           |
| `previewSample`             | The sample text in the swatch (for templates, the selection the preview uses).         |
| `previewHtml`, `previewCss` | Optional swatch-only HTML and CSS.                                                     |
| `extraClasses`              | Helper classes in `css`; found automatically if left out.                              |

## Template syntax

Templates are HTML with tags. Tags may sit anywhere, even inside attributes
(`class="{{alt:in|out}}"`). Values are escaped. The result is cleaned with AO3's HTML rules,
so the preview shows what AO3 will keep.

| Tag                                        | Becomes                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `{{selection}}`                            | The selected text; several lines are joined with `<br>`.       |
| `{{selection\|Starter text}}`              | The same, or the starter text when nothing is selected.        |
| `<p class="x">{{selection}}</p>`           | One such paragraph per selected line.                          |
| `{{key}}`, `{{key\|Default}}`              | A field's value.                                               |
| `{{#if key}}…{{else}}…{{/if}}`             | A part shown when a text field is filled in or a toggle is on. |
| `{{#if !key}}…{{/if}}`                     | The opposite.                                                  |
| `{{#lines\|Line one⏎Line two}}…{{/lines}}` | Repeated once per selected line, or per starter line.          |

Inside `{{#lines}}`:

| Tag                             | Becomes                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `{{line}}`                      | The whole line.                                                                 |
| `{{text}}`, `{{speaker}}`       | For `Name: message` lines, the message and the name.                            |
| `{{index}}`                     | 1, 2, 3, …                                                                      |
| `{{alt:a\|b\|…}}`               | Cycles through the options: by speaker when every line names one of two or more |
|                                 | speakers, otherwise line by line.                                               |
| `{{#if speaker}}`               | The line names a speaker.                                                       |
| `{{#if many-speakers}}`         | Every line names a speaker, and there are three or more.                        |
| `{{#if first}}`, `{{#if last}}` | The first or last line.                                                         |

The creator lists template mistakes (unknown fields, unclosed blocks) next to the AO3 checks.

## Fields

```json
"fields": [
    { "key": "summary", "label": "Summary (always shown)", "default": "Spoiler" },
    { "key": "loud", "label": "Shout it", "type": "toggle", "default": false },
    { "key": "who", "label": "Speaker", "placeholder": "e.g. Alex", "required": true }
]
```

A style with fields opens a small form when it's applied. Text fields can have a `default`,
a `placeholder` and `required`. Toggles (`"type": "toggle"`) are on or off and drive
`{{#if}}`. Keys are letters, numbers, `-` and `_`. `line`, `text`, `speaker` and `index` are
taken by `{{#lines}}`, so fields can't use them. A field with the key `selection` doesn't add
an input; it only sets the label and placeholder of the selected text in an inline template's
form.

## Inline templates

An `inline` style with `templateHtml` is inserted as one piece. Writers can select it again to
edit its fields, or remove it and keep its text. Its HTML must have a `<span>` root with the
style's `className`; eo3 finds it again by that class when a work is reopened. This is how
**Translate on hover** works:

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

## How the built-ins are made

| Built-in                         | Made with                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Redacted, Small caps, Whisper, … | `inline` styles: a class and CSS.                                                           |
| Callout, Letter, Terminal, …     | `block` styles: a class and CSS.                                                            |
| Translate on hover               | An inline template with two text fields and a toggle (above).                               |
| Text messages                    | A template using `{{#lines}}`, `{{alt:fx-msg-in\|fx-msg-out}}` and `{{#if many-speakers}}`. |
| Collapsible spoiler              | A `<details>` template with a `summary` field.                                              |

## Accessibility

-   Give every field a clear `label`: it's what screen readers announce.
-   Keep content readable when Creator's Style is off on AO3. For example, Translate on hover
    keeps "(translation)" in the text, and spoilers use `<details>`.
-   Check the colour contrast of your CSS in both light and dark site skins.
