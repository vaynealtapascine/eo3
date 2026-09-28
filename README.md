# eo3
A graph-based HTML generator to make fancy AO3 fics easier.
Built upon the work of cpsdqs on [prechoster](https://github.com/cpsdqs/prechoster). Eggbug forever!

[Open EO3](https://dev.vayne.garden/eo3/) · [About and workskin examples](https://dev.vayne.garden/eo3/about)

## AO3 workskin examples

The example library includes 14 ready-to-edit AO3 documents: text messages, group chat,
email, a personal letter, a journal, a newspaper, a case file, a social feed, a recording
transcript, a terminal log, verse, a chapter opening, linked footnotes, and collapsible notes.
They use standard Lorem ipsum and neutral labels, with no generated story content or external
images or fonts. Each has an HTML module and a shared CSS module; open one from **Examples and
Templates**, or link directly with `?example=ao3-letter.toml`.

The [gallery](https://dev.vayne.garden/eo3/about#examples) previews the actual documents,
compares their styled and unstyled appearance, and offers a ZIP of documents, chapter HTML,
CSS, and a usage guide. `npm run build` packages those files under `dist/workskin-examples`.
Authored TOML files in `assets/examples` are the source of truth; `workskins.json` holds the
gallery descriptions. Run `node scripts/export-workskin-examples.mjs` after editing them.

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
