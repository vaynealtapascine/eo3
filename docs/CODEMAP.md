# eo3 codebase map

A guide to where things live and what to edit, so you can make a change after reading two or
three files instead of twenty. Paths are relative to the repo root. Read
[AGENTS.md](../AGENTS.md) for commands and conventions first.

**Keep this map current.** When you add, move or delete a file, or a feature starts touching
new files, update the matching section here in the same commit.

-   [1. The big picture](#1-the-big-picture)
-   [2. Directory guide](#2-directory-guide)
-   [3. Feature index](#3-feature-index): what each feature touches
-   [4. Recipes](#4-recipes): step-by-step for common changes
-   [5. Invariants and traps](#5-invariants-and-traps)
-   [6. Tests](#6-tests)

## 1. The big picture

```
 author edits ──▶ Document (src/document.ts)
                   modules (graph) + parts (chapters) + posting state, with undo history
                        │ evalWork()
                        ▼
                  WorkOutput: per part {content HTML, css}, workCss, cssSources (reach)
                        │ SiteTargetPlugin.export()           (src/targets/<site>/)
                        ▼
                  finished artifacts: chapter HTML, Work Skin CSS …
                        │
          PostPreview (src/ui/components/post-preview/) shows them inside the target's
          page mockup (PreviewHeader/Footer), with copy buttons and posting controls.

 storage: Document ⇄ TOML/JSON text (src/storage/versions/v1.ts) ⇄ IndexedDB (src/storage/index.ts)
          SaveController (src/storage/save-controller.ts) autosaves and keeps version history.
```

-   **Modules** are nodes in a graph. Each has a plugin (`src/plugins/`), JSON `data`, `sends`
    (ordinary inputs to other modules or to a part's output) and `namedSends` (side inputs).
-   **Parts** are the work's chapters/posts. Each part has an output pseudo-module id
    (`output` for the first, `output:<partId>` for the rest). What a part publishes is
    whatever is sent to its output.
-   **Views.** The nodes view edits the graph directly. The simple view (default) shows each
    part as an ordered list and derives the wiring from the order (`src/linear.ts`); a
    graph it can't express just isn't listable, and the author switches to nodes.
-   **Targets** (sites) turn evaluated output into what you paste on the site, and draw the
    preview. Built-in: AO3 (exact port of its sanitizer), wafrn, cohost (legacy). Custom sites
    are data ("profiles") turned into targets at runtime.
-   **Delivery strategies** (`src/targets/delivery/`) are the shared ways a target can ship
    CSS: one shared stylesheet (AO3 Work Skin), inline styles, a `<style>` block per post, or
    none.
-   Everything is client-side; there is no server.

## 2. Directory guide

### `src/` top level

| File                  | What it is                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`           | Entry point. Opens IndexedDB (falls back to memory storage), mounts `ApplicationFrame`, `DialogHost`, `UpdateNotice`.                                                                                                                                                              |
| `document.ts`         | **The model.** `Document` (state + undo history + every edit operation), `Module`, `Part`, `ModuleGroup`, `PostedSnapshot`, `Data` classes (`HtmlData`, `CssData`, …), the evaluator (`cacheEvalModule`, `evalWork`, `eval`). Almost every feature reads or edits this file.       |
| `linear.ts`           | The simple editor's rules: `linearLayout` reads each part as an ordered list of items (modules and blocks) from the graph, or says why it can't; `applyLinearLayout` rewrites the graph from a list. Nothing is saved; `Document.linear` / `Document.applyLinearLayout` wrap them. |
| `storage-context.tsx` | React context carrying the `IStorage`.                                                                                                                                                                                                                                             |
| `globals.d.ts`        | Module declarations (`*.css`, `eo3:config` build values).                                                                                                                                                                                                                          |

### `src/plugins/` — module types

| File                                        | What it is                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                  | `MODULES` registry: id → title, description, picker `category`, lazy `load()`, `managed` (hidden from "add node").                                                            |
| `source/text.tsx`                           | Text module: HTML / rich text (TipTap) / CSS / JS / plain text. Also "insert chapter break".                                                                                  |
| `source/shared-styles.tsx`                  | "All chapters" CSS module (managed; wired to every part).                                                                                                                     |
| `source/settings.tsx`, `settings-values.ts` | Settings module: a form of named values (fields + values), evaluated to a JS module `export default {…}` for Svelte. `SettingsForm` is reused by blocks in the simple editor. |
| `source/sass.tsx`, `lesscss.tsx`            | Sass and Less compilers (run on the main thread; only Svelte uses a worker).                                                                                                  |
| `source/svelte*.ts(x)`                      | Svelte 3/4/5 component and context modules; `svelte-bundler.ts` + `svelte-worker.js` compile in a worker.                                                                     |
| `source/file-data*.tsx`                     | File upload as data / data URL.                                                                                                                                               |
| `source/external-url.tsx`                   | Fetches a script or stylesheet by URL.                                                                                                                                        |
| `transform/style-inliner.tsx`               | HTML + CSS → inline styles; the algorithm is `inline-styles-core.ts` (also used by `delivery/inline.ts`).                                                                     |
| `transform/svg-to-background.tsx`           | Turns `data-background` SVGs into CSS backgrounds.                                                                                                                            |
| `transform/svgo.tsx`, `to-*.tsx`            | SVG optimizer, data URL and blob URL converters.                                                                                                                              |

### `src/storage/` — persistence

| File                      | What it is                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                | `IStorage`; `Storage` (IndexedDB `eo3_data`: `documents`, `openDocuments`, `recovery`) and `MemoryStorage` fallback; `getExampleDocument`; `recordCheckpoint`. |
| `versions/index.ts`       | Current `serialize`/`deserialize` and DB migrations (`MIGRATIONS[n]` upgrades to DB version n).                                                                |
| `versions/v1.ts`          | **The document file format** (TOML default; JSON and "pchost" variants) and DB migration 1. Every persisted `DocumentState` field is written/read here.        |
| `versions/v0.ts`, `onv1/` | Older format reader; "pchost" object notation parser/printer.                                                                                                  |
| `versions/v2.ts`          | DB migration 2: adds the `recovery` store. (Document files are still version 1.)                                                                               |
| `save-controller.ts`      | One per open work: debounced ordered autosave, retry, flush-before-close, active-time clock, version history (enable, restore, clear).                         |
| `checkpoints.ts`          | Version history data: text diffs + periodic full snapshots, hashing, reconstruction (`checkpointSource`), retention limits, `ActiveWorkClock`.                 |
| `backup.ts`               | Whole-library backup: create, validate (`parseBackup`), import as copies (remaps conflicting custom-site ids).                                                 |
| `group-file.ts`           | `.eo3group.json` format: parse/stringify a group of modules.                                                                                                   |
| `group-library.ts`        | "My groups" in localStorage.                                                                                                                                   |
| `browser-list-store.ts`   | Shared localStorage list store (used by My groups and custom sites): parse, write with readable errors, cross-tab subscription.                                |
| `example-link.ts`         | `?example=` URL parameter → bundled example id.                                                                                                                |
| `origin-migration.ts`     | `?migrate=dev.vayne.garden` guided cross-origin transfer: receives a verified library backup via `postMessage` from the previous origin and imports as copies. |

### `src/targets/` — sites

| Path          | What it is                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | **The target contract**: `SiteTargetPlugin`, `WorkExportInput/Output`, `SiteTargetPreviewProps`, `PartPosting`, `PartSizing`, `PreviewConfig`.                                                                                                                                              |
| `index.ts`    | `SITE_TARGETS` registry of built-in targets (lazy).                                                                                                                                                                                                                                         |
| `context.tsx` | `SiteTargetProvider`/`useSiteTarget` (selected target, loads built-ins or builds profile targets), `targetTitle`, `copiedKey`.                                                                                                                                                              |
| `scan-css.ts` | CSS warnings shared by inline-style targets.                                                                                                                                                                                                                                                |
| `delivery/`   | How CSS reaches a site: `shared-stylesheet.ts` (lift + merge into one sheet, part scoping), `inline.ts`, `part-css.ts` (CSS for one part in cascade order), `scope-css.ts` (preview scoping), `skin-record.ts` (recorded rules, diffs), `css-conflicts.ts`.                                 |
| `ao3/`        | AO3 target: `index.tsx` (plugin), `export.ts`, `preview-chrome.tsx` (page mockup, copy buttons, size meter, posting controls), `diagnostics.tsx` (**own `ERRORS` registry**), `styles.scss` (mirrored AO3 CSS).                                                                             |
| `ao3/render/` | **Port of otwarchive's sanitizer and Work Skin validator.** `index.ts` pipeline; `sanitize.ts`, `paragraph-maker.ts`, `transformers.ts`, `archive-config.ts`; `css-cleaner.ts`, `css-value.ts`, `css-config.ts`; `lift-styles.ts` (style attributes → `eo3-<hash>` classes). Parity-tested. |
| `profile/`    | Custom sites: `types.ts` (`TargetProfile`, `parseProfile`, `newProfile`), `store.ts` (localStorage), `target.tsx` (`createProfileTarget`, footer), `filter-css.ts`, `diagnostics.tsx` (own `ERRORS`).                                                                                       |
| `wafrn/`      | wafrn = a profile built from `sanitizer-config.json` (extracted from wafrn's source) + own `ERRORS`.                                                                                                                                                                                        |
| `cohost/`     | Legacy target (site closed): live renderer loader, fallback markdown renderer, header/footer. Kept for old documents.                                                                                                                                                                       |

### `src/ui/` — the application shell

| File                                               | What it is                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                                        | `ApplicationFrame`: toolbar (simple/nodes switch, new/load/download, save status, undo/redo, tabs), sidebar split, one `ApplicationTab` per open work (loads it, owns its `SaveController`, error banner, version history dialog).                                                     |
| `eo3.tsx`                                          | `Eo3`: the editor for one work. Render scheduling, left panel (project title, parts list, then the simple editor or the module list — collapsed by default in desktop Simple view with a toggle in the preview header), preview, graph (nodes view only); phone layout with pane tabs. |
| `editor-view.tsx`, `editor-canvas-context.tsx`     | Simple / nodes preference (`EditorViewSwitch`, `EditorViewWelcome`); `EditorCanvasContext` supplying live Work Skin CSS and CSS-piece injection to the WYSIWYG editor.                                                                                                                 |
| `sidebar.tsx`                                      | Sidebar: local documents, examples menu, extras (share URL), Backups.                                                                                                                                                                                                                  |
| `dialogs.tsx`                                      | `showAlert` / `showConfirm` + `DialogHost`. **Never use native `alert/confirm/prompt`.**                                                                                                                                                                                               |
| `startup-error.tsx`                                | Shown when eo3 can't open its storage: reload, download a backup, and only then delete everything.                                                                                                                                                                                     |
| `update-notice.tsx`                                | "eo3 has been updated" toast and changelog (via `util/changelog.ts`).                                                                                                                                                                                                                  |
| `group-files.ts`                                   | Pick / download group files.                                                                                                                                                                                                                                                           |
| `viewport.ts`, `opt-held.tsx`, `render-context.ts` | On-screen keyboard sizing; Alt-key hook; context to schedule a re-render.                                                                                                                                                                                                              |
| `render-inputs.ts`                                 | What a render reads from the document, by reference: tells `Eo3` when the preview is out of date while Live Update is off.                                                                                                                                                             |
| `focus-when-shown.ts`                              | `useFocusWhenShown`: focus something once a `DirPopover` is really open (menus, the picker's search field); `isCoarsePointer`.                                                                                                                                                         |
| `examples.tsx`, `examples.css`                     | Examples menu. **Upstream prechoster code: don't modify.**                                                                                                                                                                                                                             |

### `src/ui/components/`

| File                                                                                                          | What it is                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parts-list.tsx`                                                                                              | Chapters list in the left panel: select, rename, ⋯ menu (styles, split at break, move, remove), posted badges.                                                                                                                                                                             |
| `ao3-import.tsx`                                                                                              | "Import existing AO3 work": paste Work Skin, then chapters.                                                                                                                                                                                                                                |
| `module-list.tsx`                                                                                             | The module editor list (each module's plugin UI, sends, named sends, reorder by drag).                                                                                                                                                                                                     |
| `module-picker.tsx`                                                                                           | "add node" (and the simple view's "Other module types…"): search, module types by category (loading and failed-load states per row), and the "Groups and templates" level (import, My groups, templates).                                                                                  |
| `simple-editor.tsx`                                                                                           | Simple view left panel: the selected part as a list (pinned managed styles, draggable items with in-place names and ⋯ menus, blocks showing their inputs with the rest under Customize), "+ add" menu (text, styles, blocks, all module types). Shows a notice for works it can't list.    |
| `inline-chapter-editor.tsx`                                                                                   | Direct in-preview WYSIWYG chapter editor mounted inside AO3's `#workskin .userstuff` in Simple view: chrome-less inline TipTap editors, live preview islands with edit popovers for blocks/custom modules, and a floating side rail (Styles, Format, Insert, Work Skin CSS, Panel toggle). |
| `module-graph/`                                                                                               | React Flow graph. `index.tsx` (`ModuleGraph`: nodes, edges, connect, drag, grouping), `auto-layout.ts`, `group-cards.ts` (collapsed group rows and edge routing), `module-node.tsx`, `output-node.tsx`, `part-styles-node.tsx`, `group-node.tsx`, `consts.ts`.                             |
| `preview.tsx`                                                                                                 | Preview pane: left-panel toggle and quick "+ Chapter" button (Simple view), output/part/site selectors, live toggle and "out of date" notice, error display with "Open this module"; wires `PostPreview` (and `InlineChapterEditor` for AO3 Simple view) to document actions.              |
| `post-preview/index.tsx`                                                                                      | `PostPreview`: runs the target's fallback render and `export()`, builds `posting`/`sizing`, injects CSS, renders header/footer (with optional `chapterBody` override). Also `RenderConfigEditor`.                                                                                          |
| `post-preview/posted-status.tsx`, `split-prompt.tsx`, `copy-to-clipboard-button.tsx`, `dark-theme-button.tsx` | Shared controls targets use in their chrome.                                                                                                                                                                                                                                               |
| `profile-editor.tsx`                                                                                          | Custom sites dialog (create/edit/import/export/delete profiles; forget retired sites' history).                                                                                                                                                                                            |
| `save-recovery.tsx`                                                                                           | `SaveStatus` (toolbar), `SaveErrorBanner`, `VersionHistory` dialog.                                                                                                                                                                                                                        |
| `library-backup.tsx`                                                                                          | Sidebar Backups section.                                                                                                                                                                                                                                                                   |
| `action-menu.tsx`, `name-popover.tsx`                                                                         | "⋯" menus (arrow-key navigation, finger-sized on touch screens); in-app naming popover (instead of `prompt()`).                                                                                                                                                                            |
| `code-editor.tsx`, `codemirror.tsx`, `rich-editor.tsx`, `tiptap-rich-editor.tsx`                              | CodeMirror and lazy-loaded TipTap WYSIWYG editor wrappers (`card` and chrome-less `inline` variants, live Work Skin canvas, CSS pieces & selection templates, floating selection menu, Format/Styles/Link/Ruby popovers).                                                                  |
| `split-panel.tsx`, `data-preview.tsx`, `icons.tsx`, `module-status.tsx`                                       | Layout and small widgets.                                                                                                                                                                                                                                                                  |

### Other source

| Path                              | What it is                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/editor/`                     | Framework-agnostic TipTap / ProseMirror extensions (`extensions.ts`, `ruby.ts`, `chapter-break.ts`, `ao3-attributes.ts`), HTML boundary conversion (`html-sync.ts`), live canvas CSS scoping (`canvas-css.ts`), AO3-safe CSS pieces & selection templates (`css-pieces.ts`), and Document style wiring (`work-styles.ts`). |
| `src/uikit/`                      | Upstream widget kit: `Button` (async `run`), `DirPopover` (anchored modal popover), text field, checkbox, springs.                                                                                                                                                                                                         |
| `src/util/`                       | `hash.ts` (fnv1a36), `lazy.ts`, `split-html.ts` (chapter splitting), `download.ts`, `changelog.ts`, `word-count.ts` (`countWords`, `workWordCount`: version labels and the AO3 mockup's word count).                                                                                                                       |
| `src/groups/examples.ts`          | Built-in example groups (letters, chat, all 14 workskins) offered as Blocks in the simple view and Templates in "add node"; `exampleGroupDescription`.                                                                                                                                                                     |
| `assets/examples/`                | Bundled example documents (`index.json` lists them; `workskins.json` is the workskin gallery catalog).                                                                                                                                                                                                                     |
| `assets/workskins/`               | Source of the 14 workskin examples: Svelte components, `writing.js` parser, `examples.mjs`, `styles/`.                                                                                                                                                                                                                     |
| `site/`                           | Static pages merged into `dist/` for `eo3.dev`: `site/about/` (About & Workskin Gallery template, CSS, JS, brand icons/fonts) and `site/404.html`.                                                                                                                                                                         |
| `scripts/`                        | Build & deploy: regenerate workskin TOML documents, render previews, package the gallery and writing lab, assemble `dist/about/` (`build-about-page.mjs`), and verify live deploys (`verify-deploy.mjs`).                                                                                                                  |
| `wrangler.jsonc`                  | Cloudflare Workers Static Assets deploy config for `eo3.dev` (run by `.github/workflows/deploy.yml`).                                                                                                                                                                                                                      |
| `vite.config.js`                  | Build: node-module string/bundle plugins, Svelte runtime trees, `eo3:config` virtual module.                                                                                                                                                                                                                               |
| `docs/design/publishing-model.md` | Design of works/parts/targets/delivery. `docs/screenshots/`: README screenshots. `PROGRESS.md`: hand-off log.                                                                                                                                                                                                              |

## 3. Feature index

Each entry: the files that implement it (most important first), its tests, and where to start.

### Module graph and evaluation

-   **Files:** `src/document.ts` (`cacheEvalModule`, `evalModuleInputs`, `evalWork`, `eval`),
    `src/plugins/index.ts`, `src/ui/eo3.tsx` (`renderPreview`, debounce, `stale`, `openModule`),
    `src/ui/render-inputs.ts`, `src/ui/components/preview.tsx` (errors, out-of-date notice),
    `src/ui/components/module-list.tsx`, `src/ui/components/module-graph/`.
-   **Tests:** `test/document/*`.
-   **Start:** evaluation semantics → `document.ts`; how the editor shows modules →
    `module-list.tsx`; the graph → `module-graph/index.tsx`.

### Parts (chapters/posts)

-   **Files:** `src/document.ts` (`Part`, `addPart`, `addPartWithText`, `movePart`,
    `removePart`, `partStyles`, `updatePart`, `modulesWiredToNewPart`),
    `src/ui/components/parts-list.tsx`, `src/ui/components/module-graph/output-node.tsx` and
    `part-styles-node.tsx`, `auto-layout.ts` (one output per part), `src/storage/versions/v1.ts`
    (`parts` in files), `preview.tsx` (part selector).
-   **Tests:** `test/document/parts.test.ts`.
-   **Labels** ("Chapter", "Post") come from the target's `partLabel`.

### "All chapters" shared styles

-   **Files:** `src/plugins/source/shared-styles.tsx`, `src/document.ts` (`ensureSharedStyles`,
    `sharedStylesReach`, `moduleDescription`), `v1.ts` (`sharedStyles`).
-   **Tests:** `test/document/shared-styles.test.ts`.

### Splitting long chapters and chapter breaks

-   **Files:** `src/util/split-html.ts` (`splitHtml`, `splitHtmlAtMarker`, `SPLIT_MARKER`),
    `src/document.ts` (`splittableContent`, `splitPart`), `src/ui/components/preview.tsx`
    (`splitPart` helper), `post-preview/split-prompt.tsx` (size warning), `parts-list.tsx`
    ("Split at chapter break"), `src/plugins/source/text.tsx` ("insert chapter break", both
    editors).
-   **Tests:** `test/util/split-html.test.ts`, split cases in
    `test/document/groups-and-splitting.test.ts`.
-   **Limit** comes from the target's `partMaxChars`.

### Simple view, blocks and Settings

-   **Files:** `src/linear.ts` (rules, read and write), `src/document.ts` (`linear`,
    `applyLinearLayout`, `setGroupInputs`, `instantiateGroupFile`, `GroupInput`),
    `src/ui/components/simple-editor.tsx`, `src/ui/editor-view.tsx`, `src/ui/eo3.tsx`,
    `src/ui/index.tsx` (toolbar switch, welcome), `src/plugins/source/settings*.ts(x)`,
    `v1.ts` and `group-file.ts` (group `inputs`).
-   **Tests:** `test/document/linear.test.ts` (rules, rewiring, inputs round trip, every bundled
    AO3 example has a layout).
-   **Rules:** sources send to their part; a `transform.*` module takes everything above it back
    to the previous transform; a block (group) is wired through its sinks; managed modules are
    pinned and left alone. Group `inputs` pick the members a block shows up front. An item
    listed in several parts is a mirror: one module or group sending to each of those parts.
    `applyLinearLayout` orders modules by merging the parts' lists and throws
    `LinearOrderError` when mirrors are in opposite orders. `Document.removePartAndContent`
    removes a part with the items only it lists.

### Groups and My groups

-   **Files:** `src/document.ts` (`ModuleGroup`, `canGroup`, `createGroup`, `renameGroup`,
    `ungroup`, `groupFile`, `insertGroupFile`), `src/ui/components/module-graph/group-cards.ts`,
    `group-node.tsx`, `index.tsx` (selection, drag, `groupActions`), `src/storage/group-file.ts`,
    `group-library.ts`, `src/ui/group-files.ts`, `src/ui/components/module-picker.tsx`
    (Groups level), `src/groups/examples.ts`.
-   **Tests:** `test/document/groups-and-splitting.test.ts`, `test/ui/group-cards.test.ts`,
    `test/ui/group-drag.test.ts`, `test/ui/module-picker.test.ts`,
    `test/storage/browser-libraries.test.ts`.

### AO3 output (sanitizer port, Work Skin)

-   **Files:** `src/targets/ao3/render/*` (the port), `src/targets/ao3/export.ts`,
    `src/targets/delivery/shared-stylesheet.ts`, `lift-styles.ts`, `src/targets/ao3/diagnostics.tsx`.
-   **Tests:** `test/ao3-parity/` (against real Ruby), `test/ao3/*`.
-   **Rules:** see "AO3 parity tests" in AGENTS.md. Add cases to `cases.json`, regenerate,
    never hand-edit `expected.json`.

### AO3 preview page (mockup, title/author, copy buttons)

-   **Files:** `src/targets/ao3/preview-chrome.tsx`, `src/targets/ao3/styles.scss`,
    `src/ui/components/post-preview/*`, `src/ui/eo3.tsx` (`DocumentSettings`: project title).
-   Copy buttons (`copy-to-clipboard-button.tsx`) report a copy, and start the posting
    reminders, only once the browser confirms it; a refused copy shows the text to copy by
    hand. Tests: `test/ui/copy-button.test.ts`.
-   The mockup's word and chapter counts are the work's (`workWords`, `part.count`); its
    tags, dates and reader numbers are examples, and a note in the mockup says so.
-   The chapter title is edited in place too (`onPartTitleChange`), like the title and byline.
-   The work title and byline are edited in place in the AO3 mockup (`PrefaceField` in
    `preview-chrome.tsx`, via `onWorkTitleChange` / `onAuthorChange` in
    `SiteTargetPreviewProps`). They come from the document, not from the render, so they
    update even with Live Update off. The author is only editable there.

### Posting state, skin record, crossposting

-   **Files:** `src/document.ts` (`setPartPosted`, `cleanupUnusedSkinRules`,
    `pruneImportedSkinRules`, `forgetTargetPostingState`, per-target maps),
    `src/ui/components/post-preview/index.tsx` (builds `PartPosting`, `markPosted`),
    `posted-status.tsx`, `src/targets/delivery/skin-record.ts`, `parts-list.tsx` (badges),
    `v1.ts` (`LEGACY_TARGET` migration).
-   **Tests:** `test/document/parts.test.ts` ("crossposting"), `test/ao3/export.test.ts`.

### Importing an existing AO3 work

-   **Files:** `src/ui/components/ao3-import.tsx`, `src/document.ts` (`importWorkSkin`,
    `importChapter`).
-   **Tests:** `test/ao3/export.test.ts`, `test/document/parts.test.ts`.

### Custom sites (profiles) and wafrn

-   **Files:** `src/targets/profile/*`, `src/ui/components/profile-editor.tsx`,
    `src/ui/components/preview.tsx` (site selector), `src/targets/context.tsx`,
    `src/targets/wafrn/*`.
-   **Tests:** `test/targets/profile.test.ts`, `test/wafrn-parity/`.

### Saving, version history, backups

-   **Files:** `src/storage/save-controller.ts`, `checkpoints.ts`, `index.ts`, `backup.ts`,
    `versions/v2.ts`; UI in `src/ui/components/save-recovery.tsx` (toolbar status, what changed per version, error
    banner, version history dialog), `library-backup.tsx`, `src/ui/index.tsx`
    (toolbar "history" button; `ApplicationTab` creates the controller and flushes on
    hide/blur/close), `src/ui/startup-error.tsx`.
-   **Tests:** `test/storage/*`, `test/ui/save-recovery.test.ts`,
    `test/ui/save-lifecycle.test.ts`, `test/ui/library-errors.test.ts`,
    `test/ui/startup-error.test.ts`.

### Examples and workskin gallery

-   `assets/workskins/examples.mjs` holds sample writing and optional per-field Settings
    metadata; `scripts/workskin-documents.mjs` carries it into generated documents and groups.
-   `assets/workskins/writing-help.mjs` holds per-example syntax help and shared appearance
    fields. `styles/appearance.css` supplies AO3-compatible size, width, and font variants.
    The generator stores help in text module data; `src/plugins/source/text.tsx` and
    `text.css` display the Writing help disclosure in both editor views.
    `scripts/export-workskin-examples.mjs` includes the syntax examples in downloaded guides.

-   **Files:** `assets/examples/*` (documents), `assets/workskins/*` (source),
    `scripts/*workskin*`, `scripts/build-writing-lab.mjs`, `src/groups/examples.ts`,
    `src/storage/example-link.ts`, `src/ui/examples.tsx` (upstream, don't modify).
-   **Tests:** `test/examples/*`.
-   **Workflow:** edit `assets/workskins`, run `node scripts/build-workskin-documents.mjs`,
    then the export script (part of `npm run build`).

### Update notice

-   **Files:** `src/ui/update-notice.tsx`, `src/util/changelog.ts`.
-   **Tests:** `test/util/changelog.test.ts`.

### Phone layout

-   **Files:** `src/ui/eo3.tsx` (`compactLayout`, 700px query), `src/ui/index.css`,
    `src/ui/viewport.ts`, `src/ui/eo3.scss`.

## 4. Recipes

### Add a field to the work (saved with it)

1. `src/document.ts`: add it to `DocumentState` (optional if older files lack it), default it in
   `init()` and the initial history entry, add a getter and an edit method that calls
   `pushHistoryState` with a `ChangeType` (add one if it needs its own undo coalescing).
2. `src/storage/versions/v1.ts`: write it in `serializeV1` (omit when default) and read it in
   `deserializeV1` with a default for older files. Never change existing fields
   incompatibly; documents stay version 1.
3. If it holds target ids, also remap it in `src/storage/backup.ts` (`remapTargets`).
4. Test a round trip in `test/document/`.

### Add a module type

1. Create `src/plugins/source/<name>.tsx` (or `transform/`) exporting a `ModulePlugin`:
   `id`, `component`, `initialData`, `description`, `eval` returning a `Data` subclass.
2. Register it in `src/plugins/index.ts` (`MODULES`) with a `category` (where "add node"
   lists it; category titles and order are in `module-picker.tsx`). Its data interface is
   saved in files: keep it backwards compatible forever.
3. If it outputs CSS before rendering matters (splitting, styles detection), see
   `isCssModule` in `document.ts`.

### Add a built-in site target

1. Create `src/targets/<site>/index.tsx` exporting a `SiteTargetPlugin` (see `types.ts`).
   Prefer building it as a profile (`createProfileTarget`, like `wafrn/`) if a declarative
   sanitizer is enough.
2. Give it its own `diagnostics.tsx` with an `ERRORS` registry (don't share registries).
3. Register it in `src/targets/index.ts`.
4. Add tests under `test/targets/`.

### Change how CSS is delivered

`src/targets/delivery/` holds the strategies; targets call them from `export()`. CSS order
matters: use `partCss()` to get one part's CSS in graph order.

### Change the AO3 sanitizer port

Edit `src/targets/ao3/render/`, add inputs to `test/ao3-parity/cases.json`, run
`npm run test:ao3-update -- --force` (Ruby ≥ 3.2) and `npm test`. Keep Ruby regex semantics.

### Add a dialog, menu or confirmation

Use `showAlert`/`showConfirm` (`src/ui/dialogs.tsx`), `ActionMenu`, `NamePopover`, or a
`<dialog>` with `showModal()` like `VersionHistory`. Never `alert/confirm/prompt`. To put
focus inside a `DirPopover` when it opens, use `useFocusWhenShown` (its dialog opens a frame
or two after `open` turns true).

### Change autosave or version history

Behavior: `src/storage/save-controller.ts` (timing, ordering) and `checkpoints.ts` (format,
limits; the format is stored in IndexedDB and in backups, so keep reading old entries).
UI: `src/ui/components/save-recovery.tsx`. Update README's "Saving and recovery".

### Add a database store

Bump `newVersion` in `src/storage/index.ts`, add `versions/v<n>.ts` with a migration and
schema, append it to `MIGRATIONS` in `versions/index.ts`, and implement the store in both
`Storage` and `MemoryStorage`.

## 5. Invariants and traps

-   `DocumentState` is immutable: every edit builds a new state and pushes history. Modules
    are shared between states; clone with `shallowClone()` before changing one.
-   `Document.parts` is never empty; the first part's output id is `output` forever.
-   Look up plugin ids from files with `moduleDef()` in `document.ts`, never `MODULES[id]`
    directly (inherited keys such as `constructor`).
-   `eo3-` class prefix is reserved for generated classes; packaged CSS uses `fx-`.
-   Keep `@property` rules top-level with literal `initial-value`s.
-   In plain `.css` files keep `@keyframes` top-level too: nested ones fail the production
    build's CSS minify (`.scss` files are fine, Sass hoists them).
-   Posting state is keyed by target id (`ao3`, `profile:<id>`, …). Custom profiles live in
    localStorage, not in documents.
-   `evalWork` snapshots the state before awaiting; keep it that way so edits during a render
    can't mislabel output.
-   Don't modify `src/ui/examples*`. Upstream (cpsdqs) code elsewhere may be fixed when there's
    a real bug; keep such changes small.
-   On Windows, run Vitest directly (`node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2`) if `npm test` times out.

## 6. Tests

Programmable group settings extend the existing `source/settings.tsx` form and authoring
controls, `settings-values.ts` evaluation helpers, and `settings.css`. The simple editor
reuses that form. Optional field metadata stays in module data without a file-version
change. See `docs/group-settings.md`; `test/ui/settings.test.ts` covers conditional forms,
defaults, bounds, and group-file round trips.

| Folder               | Covers                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/document/`     | Parts, groups, splitting, shared styles, evaluation, simple view layout.                                                                      |
| `test/ao3/`          | AO3 export, lift-styles naming.                                                                                                               |
| `test/ao3-parity/`   | The AO3 port against otwarchive's Ruby (`expected.json` is generated).                                                                        |
| `test/wafrn-parity/` | wafrn target against the real sanitize-html with wafrn's config.                                                                              |
| `test/targets/`      | Custom site profiles.                                                                                                                         |
| `test/storage/`      | Checkpoints, save controller, recovery store, backups, browser libraries.                                                                     |
| `test/ui/`           | Save UI and lifecycle, library errors, group cards and drag, copy buttons, module picker, action menu keys, preview freshness, startup error. |
| `test/plugins/`      | Svelte bundler worker handling.                                                                                                               |
| `test/util/`         | Split HTML, changelog, word count.                                                                                                            |
| `test/examples/`     | Workskin examples: content, layout, writing parser.                                                                                           |
