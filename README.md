# eo3
A graph-based HTML generator to make fancy AO3 fics easier.
Built upon the work of cpsdqs on [prechoster](https://github.com/cpsdqs/prechoster). Eggbug forever!

[Open EO3](https://dev.vayne.garden/eo3/) · [About and workskin examples](https://dev.vayne.garden/eo3/about)

## AO3 workskin examples

The example library includes 14 ready-to-edit AO3 documents: text messages, group chat,
email, a personal letter, a journal, a newspaper, a case file, a social feed, a recording
transcript, a terminal log, verse, a chapter opening, linked footnotes, and collapsible notes.
They use standard Lorem ipsum and neutral labels, with no generated story content or external
images or fonts. Each is one block: a **Details** form (date, names, labels), a plain-text
writing input, and a reusable Svelte renderer, plus a shared CSS module; open one from
**Examples and Templates**, or link directly with `?example=ao3-letter.toml`.

The [gallery](https://dev.vayne.garden/eo3/about#examples) previews the actual documents,
compares their styled and unstyled appearance, and offers a ZIP of documents, chapter HTML,
CSS, writing inputs, importable groups, and a usage guide. `npm run build` packages those files
under `dist/workskin-examples`. Components, shared parsing helpers, styles and writing samples
in `assets/workskins` are the source of truth; `workskins.json` holds the gallery descriptions.
Run `node scripts/build-workskin-documents.mjs` to regenerate the self-contained TOML documents,
then `node scripts/export-workskin-examples.mjs` to render the previews and package downloads.

Fill in **Details**, then write in **Your text** (in the nodes view, **Write here**). The
details become the text's header, and a header written in the text itself wins. Chat accepts
`NAME: text`, optional `[09:41]` timestamps, continuations, `! event`, `> quote` and
`+ reaction`. Letters and found documents use headers between `---`
lines and plain paragraphs. Journal entries use `## date`; footnotes use `[^key]` references
and definitions; optional extras use `::: title` / `:::` panels. Prose supports `*emphasis*`,
`**strong**`, `~~crossed out~~`, and backtick code. This is a small syntax rather than full Markdown.

In the simple view, add any example to a chapter from **+ add → Blocks**. In the nodes view,
the reusable renderer group starts folded to leave the writing input visible; import any
example from **add node → Groups** (all 14 are bundled there too), then connect **Compose** and
**Workskin** to a chapter output. Internal named sends are already wired. The same Svelte
component can take a second named text input in Compose. ChatLog accepts `variant` and `self`;
Footnotes accepts `id` to keep anchors unique when composing multiple passages.

## Simple and nodes views

eo3 opens in the **simple** view: each chapter is a list of text, styles and ready-made blocks,
top to bottom, and the wiring follows from the order. Text and styles go to the chapter. An
effect (Style Inliner, SVG to backgrounds…) applies to everything above it, back to the previous
effect. A block is a group of modules used as one item: it shows the members its author marked
as inputs (its text, a **Settings** form) and folds the rest under **Customize**. "All chapters"
and chapter styles stay pinned at the top.

Any text, styles or block can be **mirrored** into other chapters (⋯ → **Mirror in…**, or
**+ add → Mirror from other chapters**). A mirror is the same item, not a copy: in the nodes
view it is one node (or group) wired to each of those chapters, editing it anywhere changes
it everywhere, and its CSS goes into the Work Skin once. **Make a separate copy here** splits a
chapter's mirror off to edit on its own. Mirrored items keep the same order relative to each
other in every chapter they share, since a chapter's content follows the work's module order.

The **nodes** view is the full graph. The first time eo3 opens it asks which you prefer; switch
any time with **simple / nodes** in the toolbar, and that choice is kept for every work. Works
wired in ways a list can't show (named inputs from outside a block, an effect sent to two
chapters, an effect that skips something above it) open in the simple view with a note and a
button to switch. Nothing about the simple view is saved in the work: it reads the graph and
rewrites it (`src/linear.ts`).

To make your own block, group the modules in the nodes view, then in the simple view choose
**show up front** on the members a writer should fill in (and **fold away** to hide them
again). A **Settings** module, sent to a Svelte module as a named input, is a form in the block
(`import settings from './settings'`). Group inputs are saved with the work and in group files.

## Saving and recovery

Works save in this browser as you edit. The indicator next to **download** in the toolbar
shows whether the latest changes are saved. When a save fails, a red bar above the editor
offers **Retry save** and **Download work**, and closing the tab waits until the work is
saved (a failed save leaves the tab open).

Click the indicator for **Version history**. Turn on **Keep versions of this work** to keep
earlier versions (off by default, per work). While the work is on screen and you are editing,
a version is recorded for every minute of editing, skipping minutes with no changes; every
ten minutes of editing it stores a full copy instead of only the changes. Time stops counting
after a minute without input and while the tab is hidden or unfocused. The newest 120
versions (or about 20 MiB) are kept; the latest is always kept. Pick a version to see what it
contains, download it, or restore it. Restoring keeps the current draft as a version too and
can be undone. Turning history off keeps the versions you have; **Delete all versions…**
removes them.

The sidebar's **Backups** section downloads all works, their version history, My groups and
custom sites as one JSON file, including the latest edits of open works. **restore…**
validates a backup before writing anything and adds its works as copies; nothing existing is
replaced, and custom sites that conflict with yours are kept as separate sites. Backups up to
100 MiB can be restored. The section can also ask the browser to keep eo3's data.

Browser storage is not a substitute for downloaded backups. If it is unavailable, the toolbar
says so, the indicator reads **Saved in memory**, and everything disappears when the page
closes. Everything runs in the browser; no application server is required.

## Overview
Documents are a directed graph of modules.
Every module is JSON data associated with a plugin implementation.
The plugin implementation evaluates result `Data` and provides it to connected modules on the graph.
Modules have “sends,” which simply input data into other modules in evaluation order,
and “named sends,” which are sort of like side inputs that don’t make sense as regular inputs (e.g. variable definitions).

Plugins are defined in `src/plugins` (indexed in `src/plugins/index.tsx`) and are composed of a module data interface, a UI component that edits module data, and an evaluation function.

Do not change module data interfaces in a backwards-incompatible way because people are apparently using this software sometimes!!

## Changes from prechoster
-   Rich Text Editor has been replaced with TinyMCE.
-   Svelte 3.55.1 is the default for now, but Svelte 4 and 5 have been added as options.
-	Modularized the render pipeline, so `SiteTargetPlugin`s can be used to extend EO3 to work with new or other sites.
-   A work has parts (chapters or posts), each with its own output, styles and posted state, and long parts can be split.
-   AO3 output runs through a port of AO3's own HTML sanitizer and Work Skin validator, tested against AO3's Ruby code.
-   Targets for AO3, wafrn and cohost, plus custom sites described without code.
-   Packaged effects and reusable groups of modules.

### Building
in the repository:

```sh
npm install
npm run build # or npm run dev
npm test
```

See [AGENTS.md](AGENTS.md) for contributor notes and [docs/design/](docs/design/) for the publishing model.

Look in `dist` for the output.

### Browser Support
Major feature gates:

- script type module
- dialog element
- Web Workers

According to caniuse, this means:

- Firefox 114
- Safari 15.4
- Chrome 80
