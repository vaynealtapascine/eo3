# eo3
A graph-based HTML generator to make fancy AO3 fics easier.
Built upon the work of cpsdqs on [prechoster](https://github.com/cpsdqs/prechoster). Eggbug forever!

[Open EO3](https://dev.vayne.garden/eo3/) · [About and workskin examples](https://dev.vayne.garden/eo3/about)

## AO3 workskin examples

The example library includes 14 ready-to-edit AO3 documents: text messages, group chat,
email, a personal letter, a journal, a newspaper, a case file, a social feed, a recording
transcript, a terminal log, verse, a chapter opening, linked footnotes, and collapsible notes.
They use standard Lorem ipsum and neutral labels, with no generated story content or external
images or fonts. Each has a plain-text writing input, a shared CSS module, and a reusable
Svelte renderer; open one from **Examples and
Templates**, or link directly with `?example=ao3-letter.toml`.

The [gallery](https://dev.vayne.garden/eo3/about#examples) previews the actual documents,
compares their styled and unstyled appearance, and offers a ZIP of documents, chapter HTML,
CSS, writing inputs, importable groups, and a usage guide. `npm run build` packages those files
under `dist/workskin-examples`. Components, shared parsing helpers, styles and writing samples
in `assets/workskins` are the source of truth; `workskins.json` holds the gallery descriptions.
Run `node scripts/build-workskin-documents.mjs` to regenerate the self-contained TOML documents,
then `node scripts/export-workskin-examples.mjs` to render the previews and package downloads.

Start in **Write here**. Chat accepts `NAME: text`, optional `[09:41]` timestamps, continuations,
`! event`, `> quote` and `+ reaction`. Letters and found documents use headers between `---`
lines and plain paragraphs. Journal entries use `## date`; footnotes use `[^key]` references
and definitions; optional extras use `::: title` / `:::` panels. Prose supports `*emphasis*`,
`**strong**`, `~~crossed out~~`, and backtick code. This is a small syntax rather than full Markdown.

The reusable renderer group starts folded to leave the writing input visible. Import any
example from **add node → Groups** (all 14 are bundled there too), then connect **Compose** and
**Workskin** to a chapter output. Internal named sends are already wired. The same Svelte
component can take a second named text input in Compose. ChatLog accepts `variant` and `self`;
Footnotes accepts `id` to keep anchors unique when composing multiple passages.

## Saving and recovery

The save bar shows when edits are waiting, saving, or saved in this browser. Failed
saves stay visible with **Retry save** and **Download work** controls. Closing an editor
tab waits for its latest edits to save; a failed save leaves the tab open.

Open **Save history…** and enable **Keep checkpoints for this work** to retain earlier
versions. This is off by default for each work. While the work is visible and focused,
changes are checkpointed every minute of active editing, with a full snapshot every ten
active minutes. The clock pauses after a minute without interaction and while the tab is
hidden or unfocused. Unchanged minute checkpoints are skipped; full snapshots still run
on the ten-minute boundaries. Disabling checkpoints keeps the existing history.

History retains up to 120 revisions or approximately 20 MiB per work, preserving the
latest revision even if it exceeds that size. Inspect or download a revision before
restoring it. Restoration saves the current draft and restored version as new snapshots
and can be undone. **Clear history…** removes old checkpoints; when enabled, it starts
again with a snapshot of the current draft.

The sidebar's **Backup and recovery** section downloads all works, retained checkpoint
history, My groups, and custom sites as one JSON file, including open drafts' latest edits.
Import validates the backup before writing and creates independent work copies. Existing
works remain intact; conflicting custom sites are kept separately and their imported
posting records follow the copied site. Backup import supports files up to 100 MiB.
The browser storage request is optional and reports whether persistence was granted.

Browser-local data and checkpoints are not a substitute for downloaded backups. If browser
storage is unavailable, the save bar labels memory-only saving and the history disappears
when the page closes. Everything runs in the browser; no application server is required.

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
