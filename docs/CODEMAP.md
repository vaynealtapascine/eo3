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
-   **Targets** (sites) turn evaluated output into what you paste on the site, and draw the
    preview. Built-in: AO3 (exact port of its sanitizer), wafrn, cohost (legacy). Custom sites
    are data ("profiles") turned into targets at runtime.
-   **Delivery strategies** (`src/targets/delivery/`) are the shared ways a target can ship
    CSS: one shared stylesheet (AO3 Work Skin), inline styles, a `<style>` block per post, or
    none.
-   Everything is client-side; there is no server.

## 2. Directory guide

### `src/` top level

| File                  | What it is                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`           | Entry point. Opens IndexedDB (falls back to memory storage), mounts `ApplicationFrame`, `DialogHost`, `UpdateNotice`.                                                                                                                                                        |
| `document.ts`         | **The model.** `Document` (state + undo history + every edit operation), `Module`, `Part`, `ModuleGroup`, `PostedSnapshot`, `Data` classes (`HtmlData`, `CssData`, …), the evaluator (`cacheEvalModule`, `evalWork`, `eval`). Almost every feature reads or edits this file. |
| `storage-context.tsx` | React context carrying the `IStorage`.                                                                                                                                                                                                                                       |
| `globals.d.ts`        | Module declarations (`*.css`, `eo3:config` build values).                                                                                                                                                                                                                    |

### `src/plugins/` — module types

| File                              | What it is                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `index.ts`                        | `MODULES` registry: id → title, description, lazy `load()`, `managed` (hidden from "add node").           |
| `source/text.tsx`                 | Text module: HTML / rich text (TinyMCE) / CSS / JS / plain text. Also "insert chapter break".             |
| `source/shared-styles.tsx`        | "All chapters" CSS module (managed; wired to every part).                                                 |
| `source/sass.tsx`, `lesscss.tsx`  | Sass and Less compilers (run on the main thread; only Svelte uses a worker).                              |
| `source/svelte*.ts(x)`            | Svelte 3/4/5 component and context modules; `svelte-bundler.ts` + `svelte-worker.js` compile in a worker. |
| `source/file-data*.tsx`           | File upload as data / data URL.                                                                           |
| `source/external-url.tsx`         | Fetches a script or stylesheet by URL.                                                                    |
| `transform/style-inliner.tsx`     | HTML + CSS → inline styles; the algorithm is `inline-styles-core.ts` (also used by `delivery/inline.ts`). |
| `transform/svg-to-background.tsx` | Turns `data-background` SVGs into CSS backgrounds.                                                        |
| `transform/svgo.tsx`, `to-*.tsx`  | SVG optimizer, data URL and blob URL converters.                                                          |

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

| File                                               | What it is                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                                        | `ApplicationFrame`: toolbar (new/load/download, save status, undo/redo, tabs), sidebar split, one `ApplicationTab` per open work (loads it, owns its `SaveController`, error banner, version history dialog). |
| `eo3.tsx`                                          | `Eo3`: the editor for one work. Render scheduling, left panel (title/author, parts list, module list), preview, graph; phone layout with pane tabs.                                                           |
| `sidebar.tsx`                                      | Sidebar: local documents, examples menu, extras (share URL), Backups.                                                                                                                                         |
| `dialogs.tsx`                                      | `showAlert` / `showConfirm` + `DialogHost`. **Never use native `alert/confirm/prompt`.**                                                                                                                      |
| `update-notice.tsx`                                | "eo3 has been updated" toast and changelog (via `util/changelog.ts`).                                                                                                                                         |
| `group-files.ts`                                   | Pick / download group files.                                                                                                                                                                                  |
| `viewport.ts`, `opt-held.tsx`, `render-context.ts` | On-screen keyboard sizing; Alt-key hook; context to schedule a re-render.                                                                                                                                     |
| `examples.tsx`, `examples.css`                     | Examples menu. **Upstream prechoster code: don't modify.**                                                                                                                                                    |

### `src/ui/components/`

| File                                                                                                          | What it is                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parts-list.tsx`                                                                                              | Chapters list in the left panel: select, rename, ⋯ menu (styles, split at break, move, remove), posted badges.                                                                                                                                                 |
| `ao3-import.tsx`                                                                                              | "Import existing AO3 work": paste Work Skin, then chapters.                                                                                                                                                                                                    |
| `module-list.tsx`                                                                                             | The module editor list (each module's plugin UI, sends, named sends, reorder by drag).                                                                                                                                                                         |
| `module-picker.tsx`                                                                                           | "add node": module types and the Groups level (import, My groups, examples).                                                                                                                                                                                   |
| `module-graph/`                                                                                               | React Flow graph. `index.tsx` (`ModuleGraph`: nodes, edges, connect, drag, grouping), `auto-layout.ts`, `group-cards.ts` (collapsed group rows and edge routing), `module-node.tsx`, `output-node.tsx`, `part-styles-node.tsx`, `group-node.tsx`, `consts.ts`. |
| `preview.tsx`                                                                                                 | Preview pane: output/part/site selectors, live toggle, error display; wires `PostPreview` to document actions (mark posted, split, prune).                                                                                                                     |
| `post-preview/index.tsx`                                                                                      | `PostPreview`: runs the target's fallback render and `export()`, builds `posting`/`sizing`, injects CSS, renders header/footer. Also `RenderConfigEditor`.                                                                                                     |
| `post-preview/posted-status.tsx`, `split-prompt.tsx`, `copy-to-clipboard-button.tsx`, `dark-theme-button.tsx` | Shared controls targets use in their chrome.                                                                                                                                                                                                                   |
| `profile-editor.tsx`                                                                                          | Custom sites dialog (create/edit/import/export/delete profiles; forget retired sites' history).                                                                                                                                                                |
| `save-recovery.tsx`                                                                                           | `SaveStatus` (toolbar), `SaveErrorBanner`, `VersionHistory` dialog.                                                                                                                                                                                            |
| `library-backup.tsx`                                                                                          | Sidebar Backups section.                                                                                                                                                                                                                                       |
| `action-menu.tsx`, `name-popover.tsx`                                                                         | "⋯" menus; in-app naming popover (instead of `prompt()`).                                                                                                                                                                                                      |
| `code-editor.tsx`, `codemirror.tsx`, `rich-editor.tsx`, `tiny-rich-editor.tsx`, `tiny-plugins/`               | CodeMirror and TinyMCE wrappers.                                                                                                                                                                                                                               |
| `split-panel.tsx`, `data-preview.tsx`, `icons.tsx`, `module-status.tsx`                                       | Layout and small widgets.                                                                                                                                                                                                                                      |

### Other source

| Path                              | What it is                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/uikit/`                      | Upstream widget kit: `Button` (async `run`), `DirPopover` (anchored modal popover), text field, checkbox, springs. |
| `src/util/`                       | `hash.ts` (fnv1a36), `lazy.ts`, `split-html.ts` (chapter splitting), `download.ts`, `changelog.ts`.                |
| `src/groups/examples.ts`          | Built-in example groups (letters, chat, all 14 workskins) offered in "add node → Groups".                          |
| `assets/examples/`                | Bundled example documents (`index.json` lists them; `workskins.json` is the workskin gallery catalog).             |
| `assets/workskins/`               | Source of the 14 workskin examples: Svelte components, `writing.js` parser, `examples.mjs`, `styles/`.             |
| `scripts/`                        | Build-time: regenerate workskin TOML documents, render previews, package the gallery and writing lab.              |
| `vite.config.js`                  | Build: node-module string/bundle plugins, Svelte runtime trees, `eo3:config` virtual module.                       |
| `docs/design/publishing-model.md` | Design of works/parts/targets/delivery. `PROGRESS.md`: hand-off log.                                               |

## 3. Feature index

Each entry: the files that implement it (most important first), its tests, and where to start.

### Module graph and evaluation

-   **Files:** `src/document.ts` (`cacheEvalModule`, `evalModuleInputs`, `evalWork`, `eval`),
    `src/plugins/index.ts`, `src/ui/eo3.tsx` (`renderPreview`, debounce),
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

### Groups and My groups

-   **Files:** `src/document.ts` (`ModuleGroup`, `canGroup`, `createGroup`, `renameGroup`,
    `ungroup`, `groupFile`, `insertGroupFile`), `src/ui/components/module-graph/group-cards.ts`,
    `group-node.tsx`, `index.tsx` (selection, drag, `groupActions`), `src/storage/group-file.ts`,
    `group-library.ts`, `src/ui/group-files.ts`, `src/ui/components/module-picker.tsx`
    (Groups level), `src/groups/examples.ts`.
-   **Tests:** `test/document/groups-and-splitting.test.ts`, `test/ui/group-cards.test.ts`,
    `test/ui/group-drag.test.ts`, `test/storage/browser-libraries.test.ts`.

### AO3 output (sanitizer port, Work Skin)

-   **Files:** `src/targets/ao3/render/*` (the port), `src/targets/ao3/export.ts`,
    `src/targets/delivery/shared-stylesheet.ts`, `lift-styles.ts`, `src/targets/ao3/diagnostics.tsx`.
-   **Tests:** `test/ao3-parity/` (against real Ruby), `test/ao3/*`.
-   **Rules:** see "AO3 parity tests" in AGENTS.md. Add cases to `cases.json`, regenerate,
    never hand-edit `expected.json`.

### AO3 preview page (mockup, title/author, copy buttons)

-   **Files:** `src/targets/ao3/preview-chrome.tsx`, `src/targets/ao3/styles.scss`,
    `src/ui/components/post-preview/*`, `src/ui/eo3.tsx` (`DocumentSettings`: title, author).
-   The preview shows the project title and author from the document, not from the render.

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
    `versions/v2.ts`; UI in `src/ui/components/save-recovery.tsx` (toolbar status, error
    banner, version history dialog), `library-backup.tsx`, `src/ui/index.tsx`
    (`ApplicationTab` creates the controller and flushes on hide/blur/close).
-   **Tests:** `test/storage/*`, `test/ui/save-recovery.test.ts`,
    `test/ui/save-lifecycle.test.ts`, `test/ui/library-errors.test.ts`.

### Examples and workskin gallery

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
2. Register it in `src/plugins/index.ts` (`MODULES`). Its data interface is saved in files:
   keep it backwards compatible forever.
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
`<dialog>` with `showModal()` like `VersionHistory`. Never `alert/confirm/prompt`.

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
-   Posting state is keyed by target id (`ao3`, `profile:<id>`, …). Custom profiles live in
    localStorage, not in documents.
-   `evalWork` snapshots the state before awaiting; keep it that way so edits during a render
    can't mislabel output.
-   Don't modify `src/ui/examples*`. Upstream (cpsdqs) code elsewhere may be fixed when there's
    a real bug; keep such changes small.
-   On Windows, run Vitest directly (`node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2`) if `npm test` times out.

## 6. Tests

| Folder               | Covers                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `test/document/`     | Parts, groups, splitting, shared styles, evaluation.                      |
| `test/ao3/`          | AO3 export, lift-styles naming.                                           |
| `test/ao3-parity/`   | The AO3 port against otwarchive's Ruby (`expected.json` is generated).    |
| `test/wafrn-parity/` | wafrn target against the real sanitize-html with wafrn's config.          |
| `test/targets/`      | Custom site profiles.                                                     |
| `test/storage/`      | Checkpoints, save controller, recovery store, backups, browser libraries. |
| `test/ui/`           | Save UI and lifecycle, library errors, group cards and drag.              |
| `test/plugins/`      | Svelte bundler worker handling.                                           |
| `test/util/`         | Split HTML, changelog.                                                    |
| `test/examples/`     | Workskin examples: content, layout, writing parser.                       |
