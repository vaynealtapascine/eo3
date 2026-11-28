# Edit blocks in the chapter

## What is this?

In the simple view, eo3 shows each block in the chapter as a live preview. A block is a group
of nodes, for example a letter or a chat log.

Usually the writer changes a block with its **Edit** button. This opens a form. It works, but
the writer cannot see the result while they type.

You can do better. You can let the writer click the preview and type directly into it. It is
like a paper form: the writer writes in the boxes, not on a separate sheet.

To do this, you add `data-edit…` attributes to the HTML that your block makes. These
attributes tell eo3 where each piece of the preview comes from.

Some facts about these attributes:

-   They work only in the eo3 editor.
-   eo3 removes them when it exports for AO3. They never get to AO3, and they cost nothing.
-   If an attribute is wrong, eo3 ignores it. That part of the preview is then not clickable.

## The four kinds

There are four kinds of attributes. The first is the easiest. The last can do the most.

| Attribute                | The element shows                                 | When the writer clicks it                  |
| ------------------------ | ------------------------------------------------- | ------------------------------------------ |
| `data-edit`              | its own text, in a block that is plain HTML       | the writer changes that text in place      |
| `data-edit-field="key"`  | a value from the Settings node of the block       | the writer changes that setting in place   |
| `data-edit-input="name"` | a full text input of the block                    | the writer edits all of the input's text   |
| `data-edit-line="n"`     | line `n` of a text input that your template reads | the writer edits that line, with a toolbar |

## `data-edit`: blocks that are plain HTML

Use this for a block whose output is a plain HTML text node, with no Svelte or script. Put
`data-edit` on the parts that the writer can change:

```html
<p><strong data-edit="text">Alex</strong> <span data-edit="rich">Are you there?</span></p>
```

-   `data-edit="text"` allows plain text only.
-   `data-edit="rich"` also keeps bold, italics, links and `style` attributes.

eo3 writes the change directly into the HTML of the block.

## `data-edit-field`: values from settings

Use this when the block has a Settings node (see [group-settings.md](group-settings.md)).
Put the key of the field on the element that shows the value:

```svelte
<h3 data-edit-field="Title">{settings.Title}</h3>
<span data-edit-field="Number" data-edit-prefix="No. ">No. {settings.Number}</span>
```

-   This works for text, paragraph, number and choice fields.
-   `data-edit-prefix` is text that your template shows before the value. It is not part of
    the value. In the example, the writer edits only the number, not "No. ".

## `data-edit-input`: a full text input

Put the name of a text input on the element that shows it. Use the name that the input has
when you send it to your template. When the writer clicks, eo3 opens the text of the input
in place:

```svelte
<div data-edit-input="draft">{@html renderBody(draft)}</div>
```

This works with all templates. But the writer edits the source text, for example
`mylo:: hello`, not the result that they see. If your template makes something from each line
of an input, use lines instead (next section).

## `data-edit-line`: line by line

Many templates read a text input one line at a time. Examples are a chat log with lines like
`name:: message`, a script for a play, or a list.

Your template can tell eo3 which line made each piece of the output. Then the writer can
change the output directly:

-   Click a message to change its text.
-   Pick a different speaker from a drop-down.
-   Press Enter to start a new line.

### Mark the lines

Put these attributes on the element that shows a line:

-   `data-edit-line="n"`: the number of the line in the input. The first line is 0.
-   `data-edit-input="name"`: the name of the input. You can put it on the line, or on an
    element around the line. If the block has only one text input, you do not need it.

### Mark the parts of a line

A line can have parts, for example a speaker and a message. Put `data-edit-part="name"` on
each part. Then use `data-edit-format` to tell eo3 how the parts make the line:

```svelte
<script>
    const FORMAT = '{speaker}:: {text}';
</script>

{#each lines as line}
    <p data-edit-input="conversation" data-edit-line={line.index} data-edit-format={FORMAT}>
        <b data-edit-part="speaker" data-edit-value={line.speaker} data-edit-options={speakers}>
            {line.speakerName}
        </b>
        <span data-edit-part="text" data-edit-placeholder="Say something">{line.text}</span>
    </p>
{/each}
```

When the writer changes a part, eo3 puts the value of each part into the format. Then eo3
replaces the line in the input with the result.

Example: the line is `mylo:: what the helly`. The writer changes the message to `hi`. eo3
writes `mylo:: hi`.

### All the attributes for lines

| Attribute               | Put it on              | What it does                                                                                                                                                                                             |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-edit-line`        | the line               | The number of the line in the input. The first line is 0.                                                                                                                                                |
| `data-edit-input`       | the line, or around it | The name of the input that has the line.                                                                                                                                                                 |
| `data-edit-format`      | the line               | How the parts make the line. `{name}` is the value of a part. `{{` and `}}` are real braces. If you do not give a format, eo3 puts the values one after the other.                                       |
| `data-edit-part`        | a part                 | The name of the part. The format uses this name. A line with no parts is one part, with the name `text`.                                                                                                 |
| `data-edit-value`       | a part                 | The value of the part in the input, if it is different from what the template shows. Example: the input has `mylo`, and the template shows `MYLO`. If you do not give it, eo3 uses the text of the part. |
| `data-edit-options`     | a part                 | Makes the part a choice. The writer picks it from a drop-down. Give a JSON array of values, or of `{ "value": …, "label": … }` objects. You can also give values with `\|` between them.                 |
| `data-edit-label`       | a part                 | The name of the drop-down for a choice. If you do not give it, eo3 uses the name of the part, with a capital first letter.                                                                               |
| `data-edit-placeholder` | a part                 | The text that eo3 shows when the part is empty.                                                                                                                                                          |
| `data-edit-mode`        | a part                 | `rich` lets the writer edit the part as formatted text (see below). If you do not give it, the part is plain text.                                                                                       |

### What the writer can do with a line

-   **Click a text part** to type in it. eo3 saves the change while the writer types.
-   **Enter** cuts the line in two at the cursor. The text after the cursor goes to a new line
    below. The new line has the same choices, for example the same speaker. When the preview
    updates, the writer can type in the new line.
-   **Backspace** in an empty line removes the line.
-   **Escape** cancels all of the edit. **Tab** goes to the next part that the writer can edit.
-   **The line toolbar** shows above the line under the pointer, and above the line that the
    writer edits. It has a drop-down for each choice. It also has buttons to add a line below,
    to move the line up or down, and to remove the line.

The drop-downs work also when your template hides the part. For example, a template can hide
the speaker name and keep it only for screen readers.

### Count lines the same way as eo3

eo3 changes the line that `data-edit-line` gives. Thus you must count lines in the same way
as eo3:

-   **HTML inputs** (rich text, and text nodes in HTML mode): each top-level element is one
    line. Usually this is one `<p>` for each paragraph. In a template:

    ```js
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lines = Array.from(doc.body.children).map((el) => el.textContent);
    ```

    `doc.querySelectorAll('p')` gives the same lines if the input has only paragraphs. It
    gives wrong lines if the input has a list or a paragraph in another element.

-   **Other inputs** (plain text): each line between `\n` characters. `text.split('\n')`
    gives these lines. Count the empty lines too, also if you do not show them.

### Formatted text: `data-edit-mode="rich"`

A part is plain text if you do not tell eo3 something different. When the writer edits a
plain part, eo3 writes the line again as plain text. Bold or italics in that line go away.

Your template can show the HTML of a line, with its formatting. Then put
`data-edit-mode="rich"` on the part that shows it:

```svelte
<span data-edit-part="text" data-edit-mode="rich">{@html line.html}</span>
```

When the writer clicks a rich part, eo3 opens its rich text editor in that place. The editor
looks like the part. When the writer selects text, the editor shows the same toolbar as for
chapter text: ✦ Style, bold, italics, links, ruby, colours and more.

-   Enter cuts the line in two at the cursor. The formatting goes with the text to the new
    line.
-   Shift+Enter adds a line break in the same line.
-   A click outside the part stops the edit. A click on the toolbar or its windows does not.

When a line has a rich part, eo3 writes all of the line back as HTML:

-   The rich part goes in as HTML.
-   The other parts and the text of the format go in as text. eo3 makes them safe for HTML.
-   eo3 cleans the HTML with the AO3 rules, but it keeps `style` attributes. eo3 moves styles
    into the Work Skin when it exports.
-   Paragraphs in a part become line breaks, because a part is in one line.
-   The editor writes HTML in its own way. For example, it can change `color: red` to
    `color: red;`. It does the same for chapter text.

The HTML that your template shows must be the HTML of the line, without the bits that the
other parts show. For `name:: text`, remove the `name::` from the start of the paragraph's
HTML:

```js
const html = paragraph.innerHTML.replace(/^.*?::/s, '').trim();
```

### Things to remember

-   **In Svelte, write the format as an expression.** In `data-edit-format="{speaker}: {text}"`,
    Svelte reads `{speaker}` as code. Use a string constant, as in the example above. Or write
    `data-edit-format={'{speaker}:: {text}'}`.
-   **Your format must undo what your template reads.** If your template removes spaces or
    changes letters to lower case, eo3 writes back the value that you gave in
    `data-edit-value`. This is correct if your template reads that value in the same way.
-   **Each line needs its own number.** Sometimes a line has no speaker, and your template
    adds it to the message of the speaker before. Give that line its own `data-edit-line`.
    Give it the speaker of the line before as `data-edit-value`. eo3 then writes the line
    with the speaker name in it. The result looks the same.
-   **A speaker that is not in the list** still works. The drop-down shows the current value
    as "not in the list". The writer can then pick a speaker from the list.
