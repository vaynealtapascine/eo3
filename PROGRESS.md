# PROGRESS.md

Hand-off log for the works/parts/targets implementation. Read this first when picking the work up;
update it whenever a step lands (what changed, what's next, anything surprising).

-   **Design doc:** [docs/design/publishing-model.md](docs/design/publishing-model.md)
    (decisions are recorded at its end; the living copy is linked from its header).
-   **Repo conventions:** see [AGENTS.md](AGENTS.md). Gate before every commit: `npm run typecheck`
    and `npm test`; `npm run build` before pushing.

## Status

2026-10-03 — **Simple view (linear editor), configurable blocks, Settings module.** Not
committed yet; branch `claude/low-complexity-linear-editor-2af9c9`.

-   **Model** (`src/linear.ts`): each part as an ordered list of items read from the graph.
    Sources send to their part; a `transform.*` takes everything above it back to the previous
    transform; a group is one block wired through its sinks (members sending to no other
    member); managed modules ("All chapters", imported skin, part styles) are pinned and never
    rewired. `linearLayout` returns a layout only if the order reproduces the current wiring
    exactly, otherwise a reason; `applyLinearLayout` rewrites order and sends from a layout and
    drops listed modules left out. No saved state: `Document.linear` is cached per state.
-   **Blocks:** `ModuleGroup.inputs` (`{ moduleId, label }[]`) picks the members shown up front;
    saved in work files (`groups[].inputs`, module indices) and group files (`inputs`,
    in-file indices). Older eo3 ignores the field. `setGroupInputs`, `instantiateGroupFile`
    (split out of `insertGroupFile`).
-   **Settings module** (`source.settings`): fields + values → JS module `export default {…}`.
-   **Workskin examples** regenerated: the header fields moved into a Settings module
    ("Details"), the draft holds only the body, and the group now contains draft + settings +
    renderer (inputs: Details, Your text). Compose calls `withSettings(draft, settings)` (new in
    `writing.js`); a header typed in the draft still wins. The CSS stays the managed
    "All chapters" module. The `.txt` download keeps the full header text.
-   **UI:** toolbar **simple / nodes** switch replaces the show/hide graph button (one global
    preference in localStorage `eo3-editor-view`, default simple); a one-time welcome dialog
    asks everyone on first launch. Simple view = parts list + `SimpleEditor` (no graph pane).
    Works that aren't listable show the reason and a "Switch to nodes view" button.
    `ModuleList` now lays out on mount (it used to rely on a later update; it now mounts when
    switching views).
-   **Validation:** typecheck, 602 tests (3 skipped), production build; checked in the browser
    at desktop and phone widths (welcome, letter block details → preview, add block, move,
    move to chapter, switch views, non-listable notice).
-   **Follow-up (same day):** cards reorder by dragging a three-line handle, as in the nodes
    view's list (cards fold to their headers while dragging; arrow keys on the focused handle
    also move them). Names are edited in place like module titles: card names, block input
    labels and Customize members (Enter or leaving the field saves, Escape cancels).
-   **Mirrored items:** a source or block listed in several parts is one module/group sending
    to each part (seamless in the nodes view; its CSS is one source reaching those parts, so
    the Work Skin has it once). `linear.ts` reads multiple targets per item (one per part;
    effects can't be mirrored) and `applyLinearLayout` merges the parts' lists into one module
    order (`itemOrder`, a topological merge), throwing `LinearOrderError` for opposite orders.
    UI: "mirrored · Chapters 1, 3" badge, ⋯ "Mirror in…", "Make a separate copy here",
    "Remove from this chapter", and "+ add → Mirror from other chapters". Removing a chapter
    in the simple view removes what only it lists (`removePartAndContent`, one undo step).
-   **Next / open:** per-chapter text with a shared look (mirror the renderer, not the
    text) would be a further model change.

2026-10-02 — **Audit, refinement of recent features, codebase map.** Working tree also
contains the 2026-09-29 cleanup edits (uncommitted until now); nothing is committed yet.

-   **Codebase map:** [docs/CODEMAP.md](docs/CODEMAP.md) maps directories and features to
    files, with recipes and invariants. AGENTS.md points to it; keep it current.
-   **Save and version history UI rebuilt** (`ui/components/save-recovery.tsx`). The
    always-visible save bar is gone: the toolbar shows a small status (Saved / Edited /
    Saving… / Not saved) next to **download** (the old "save" button, which only ever
    downloaded a file). A red banner appears above the editor only while saving fails, with
    Retry and Download. Clicking the status opens **Version history**: one toggle ("Keep
    versions of this work", still opt-in per work), a newest-first list of versions with
    plain dates and editing time, and restore / download / show file for the selected one.
    Storage behavior (`save-controller.ts`, `checkpoints.ts`) is unchanged.
-   **Backups** sidebar section restyled like the other sections, shorter copy, uikit buttons.
-   **Chapter breaks** can now be inserted from the rich text editor too (previously code mode
    only, which hid the feature from the default chapter editor).
-   **Custom sites editor:** "save and preview" also works for new sites; switching sites
    asks before discarding unsaved edits; saving a site no longer moves it to the end of the
    list (`profile/store.ts`).
-   **Fixes:** group-file and saved-document plugin lookups ignore inherited object keys
    (`moduleDef` in `document.ts`; this was the failing test left by the cleanup);
    `popstate` listener leak in `ui/index.tsx`; four copies of "download a file" merged into
    `util/download.ts` (some revoked the URL before the download started).
-   Sass/Less compile on the main thread in `main`; a worker offload exists only in
    `git stash@{0}` ("WS4-WS5"), never applied. Decide whether to revive it.
-   Validation: typecheck, 574 tests (3 skipped), production build; UI checked in the
    browser at desktop and phone widths.

2026-09-30 — **Completed: save recovery and opt-in checkpoints.** User requested
mandatory visible save/error/retry handling, recoverable revisions and complete backups
(works, My groups, custom sites), plus incremental checkpoints every minute of active
work and full snapshots every ten active minutes. Preserve the pre-existing cleanup
working-tree changes; do not commit or discard them.

- Added `src/storage/checkpoints.ts`: serialized-text replacement diffs with base/result
  hashes, reconstructable snapshots, one-minute/ten-minute constants, retention at 120
  revisions / approximately 20 MiB (one oversized latest snapshot can remain), and an
  active-work clock. Active = foreground, visible, focused editing; idle cutoff one
  minute. No background catch-up. Initial and explicit recovery snapshots are full.
- Database version 2 is wired (`recovery` store); document files remain version 1.
  Storage now offers transactional history updates and atomic work/history import. The
  memory fallback supports the same operations and snapshots drafts instead of holding
  mutable references. Delete removes the associated history in the same transaction.
- `storage/save-controller.ts` orders autosaves, catches failures, retries, flushes on
  lifecycle boundaries, counts active time and restores with before/after snapshots.
  `ui/components/save-recovery.*` shows save status, per-work opt-in, history inspection,
  downloads, undoable restore and explicit history clearing. `ui/index.tsx` integrates it;
  virtual documents are realized only after a successful save.
- `storage/backup.ts` validates works/history/groups/profiles before writes, imports works
  as new copies, keeps conflicting custom profiles separately and remaps posting history.
  UI in `library-backup.tsx` is in the sidebar; exports include current in-memory drafts.
  Library writes roll back if transactional work import fails. Added `fake-indexeddb` as
  a dev dependency for migration/transaction regression coverage (only one package added).
- Regression tests now cover database migration/reopen/transactions, diff reconstruction
  and corruption, count/byte retention, ten-minute boundaries, opt-in/idle/background time,
  partial-minute resume, failed writes/retry, edits during a save, restore/undo, deletion,
  backup round-trips, conflicting target-id remapping and rollback, and recovery UI states.
  Autosave tab closes await a successful write; failures leave the tab open. Pending writes
  cancel on deletion. Virtual works are realized only when their latest edits are saved.
- Validation: typecheck passed; full suite passed **574 tests, 3 skips, 25 files**
  using direct Vitest with two thread workers; production build passed and packaged all
  14 workskin examples. Existing mirrored-image/compiler/chunk-size build warnings remain.
  Browser verification confirmed opt-in, revision inspection, persistence after reload,
  and successful restoration with both sides retained. The dialog layout was inspected.
  README now documents timing, recovery, retention and complete backup/import behavior.
  Lifecycle tests cover failed tab closes and virtual-document realization. Flush drains
  newer edits made during an awaited write before closing. Build-generated example files
  had only line-ending changes and were restored; pre-existing cleanup edits are preserved.
  Prettier checks for changed implementation/tests and `git diff --check` passed.
  Temporary browser verification tab and preview server were closed. On the user's later
  commit/push request, recovery and its browser-library dependencies were staged separately
  from unrelated cleanup. The isolated staged tree passed typecheck, **558 tests, 3 skips,
  24 files**, and production build. The full working tree's 574-test result above includes
  the remaining cleanup tests. Commit title: `feat(storage): add opt-in checkpoints and recovery`.
- Previous audit baseline: typecheck
  passed; default Vitest forks timed out, but `node node_modules/vitest/vitest.mjs run
  --pool=threads --maxWorkers=2` passed 534 tests with 3 skips. In this PowerShell setup,
  use the direct Node Vitest command because npm consumed forwarded CLI options.

2026-09-29 — Cleanup of EO3 additions: removed seven unused build plugins (150 packages
total), shared browser-library persistence with visible save errors and cross-tab updates,
preserved graph CSS order for inline/embedded exports, and tightened profile/group validation.
Work evaluation now keeps one document snapshot across awaits; concurrent plugin/style-node
requests share their work. Chapter-split candidate scanning no longer copies every suffix.
Regression tests cover these changes. Upstream runtime code and saved-file formats remain
unchanged. See [cleanup review](docs/cleanup-review.md) for decisions and deferred examinations.

2026-09-28 — Svelte bundling now waits for an explicit worker-ready message before
posting work. Startup gets 30 seconds; compilation gets 15 seconds, with two retries
on timeouts. Failed worker generations retire all their pending requests and timers
without touching a replacement; compiler errors and worker crashes fail immediately.
Rollup bundles close after generation. Tests cover slow startup, retry limits, stale
callbacks, concurrent requests and error cleanup. A browser check in the site repo
reproduces the old five-second cold-start failure and exercises automatic recovery.

2026-09-28 — The landing page now follows AO3 and EO3's visual language, using the
existing EO3 logo and editor typeface. The exported writing lab uses the editor's
dark toolbar, gray controls and burgundy accents, with a matching dark theme.
The example workskins themselves retain their distinct appearances.

2026-09-28 — Workskin examples now use automatic graph positions, including their
downloadable groups. Layout keeps writing inputs to the left of the whole renderer,
reserves expanded group frames across every column, and places styles below the HTML
path. The AO3 output has space for its logo. Expanding or collapsing groups and running
auto layout fits the graph into view. Tests cover all 14 examples in both views and
multiple imported groups across chapters; the site browser checks verify visible bounds.

2026-09-28 — Rebuilt all 14 workskin examples around plain-text writing inputs,
reusable Svelte 4 components, shared writing helpers, and separate styles. ChatLog
supports NAME: text, optional timestamps, events, continuations, quotes and reactions.
Other examples use headers, section headings, footnote definitions or native panel
markers. The renderer modules start folded. All 14 also appear in add node → Groups,
and downloads include importable groups and writing samples. Exports evaluate the
actual module graph; the landing page's live writing lab uses the same components.
Tests cover parsing, repeated footnotes, escaped text, component reuse, group links,
AO3 processing, and live browser edits. Maintain assets/workskins and regenerate
the TOML examples with scripts/build-workskin-documents.mjs.

2026-09-28 — Added 14 AO3 workskin documents to the built-in example library, using
standard Lorem ipsum and neutral labels. Every document has editable HTML and shared CSS,
with distinct `fic-*` classes. Direct `?example=` links open virtual copies alongside saved
tabs. The build exports previews, chapter fragments, CSS, TOML documents, and an offline ZIP
for the landing page at `dev.vayne.garden/eo3/about`. `test/examples/workskins.test.ts` checks
the examples against the existing AO3 processing pipeline, including text, classes, and
footnote anchors. Upstream `src/ui/examples*` is unchanged. Next: maintain the catalog and
TOML sources together; the site derives its gallery from `dist/workskin-examples`.

2026-09-28 — Revised five gallery descriptions with the requested unslop skill and
synced the built-in example index. Template content, styles, instructions, and file names
are unchanged. The landing page copy lives in the dev.vayne.garden repository.

AO3 preview metadata now uses the current project title, and the Author field under the project
name is saved with the project and supports undo/redo. Both update the preview even with Live
Update disabled; older projects keep an empty author and show the existing placeholder. These
fields describe the preview; chapter HTML and Work Skin exports still contain only their content.

| Phase | Scope                                                                                                          | State |
| ----- | -------------------------------------------------------------------------------------------------------------- | ----- |
| 1     | Canonical, sorted Work Skin; pinned-hash test; collision check                                                 | Done  |
| 2     | `Work` + parts in the document; migration of saved documents; parts list UI; `export()` over a work            | Done  |
| 3     | Delivery strategies (`shared-stylesheet`, `inline`); skin record; diff before copy; part-scoped CSS; conflicts | Done  |
| 4     | Import an existing skin, then existing chapters                                                                | Done  |
| 5     | Group nodes (shared but detachable); first packaged effects                                                    | Done  |
| 6     | Size-based splitting; custom target profiles; crossposting                                                     | Done  |
| 7     | wafrn target (read its sanitizer source first)                                                                 | Done  |

## Phase 1 — canonical, sorted Work Skin (done)

-   [x] Lifted `eo3-*` rules sorted by class name; rule bodies built from canonical declarations,
        so the skin no longer depends on document order (`src/targets/ao3/render/lift-styles.ts`).
-   [x] Work Skin exported in AO3's canonical form (`prefix: '#workskin'`, `src/targets/ao3/export.ts`).
        The preview's `scopeCss` already skips selectors under `#workskin`, so nothing is double-prefixed.
-   [x] Parity: `expected.json` now also records AO3 re-processing its own output (`htmlReclean`,
        `css.*.reclean`); `parity.test.ts` checks the port reproduces it.
-   [x] Pinned names + behaviour: `test/ao3/lift-styles.test.ts`.
-   [x] Collision check: reported as `class-collision` (ERRORS entry in `diagnostics.tsx`); the later
        block gets `eo3-<hash>-<hash2>`.

Naming-format notes (don't change without a migration):

-   Key = canonical declarations joined by `;`, sorted, except when a shorthand and one of its
    longhands are both present (`background` + `background-color`): then written order is kept,
    because it changes the result. Names for blocks without that overlap are unchanged from before.
-   A repeated property keeps its last value (browser and css_parser behaviour). Blocks with a
    repeated property got new names in this phase; before, `color:red;color:blue` and
    `color:blue;color:red` wrongly shared one class.

Findings:

-   AO3's stored chapter HTML is **not** a fixed point of its sanitizer: re-sanitizing drops the
    newline between block elements (visually identical). Splitting (phase 6) must compare against
    AO3's re-sanitized output, not assume identity.
-   AO3's cleaned Work Skin **is** a fixed point, except `@font-face` (a known divergence).

## Phase 2 — works and parts (done)

Landed in four commits, each leaving the app working:

-   [x] **2a — data model.** `DocumentState.parts: Part[]` (never empty) in `src/document.ts`.
        A part's output is a pseudo-module id: the first part keeps `MOD_OUTPUT` (`'output'`),
        later parts use `output:<partId>` (`isPartOutput()`). Part ops: `addPart`, `updatePart`,
        `movePart`, `removePart` (drops sends to it and its managed styles module; never the last
        part), all undoable (`ChangeType.EditParts`). `removeModule` clears a part's
        `stylesModuleId`. `evalWork()` evaluates every part with one shared cache and splits CSS
        by reach: `workCss` = CSS from modules reaching every part, `part.css` = the rest.
        `RenderOutput.work` replaces `markdownOutput`/`cssOutput`. Saved files stay version 1:
        an optional `parts` list (omitted for a single untouched part) and sends to
        `output:<id>`; older files load as one part. Tests: `test/document/parts.test.ts`.
-   [x] **2b — targets.** `SiteTargetPlugin.export(WorkExportInput) → WorkExportOutput`
        (`src/targets/types.ts`): each output declares `scope: 'part' | 'work'`; targets declare
        `partLabel` ("Chapter", "Post"). AO3 (`ao3/export.ts`) emits HTML per chapter and one Work
        Skin with every chapter's lifted rules merged and sorted; a cross-chapter hash collision
        is reported (`class-collision`) but not renamed (the class is already in both chapters'
        HTML; the user changes one style). cohost (`cohost/export.ts`) inlines per post. Only
        the part on screen has live-rendered `html`; others get `null` and targets use their
        fallback. `renderAo3Content` caches up to 256 contents (LRU). `PostPreview` takes
        `work` + `partId`, and hands the chrome the part's outputs merged with the work outputs
        (so chrome and copy buttons are unchanged); `SiteTargetPreviewProps.part` gives the
        chrome the part's index/count/title (AO3 mockup shows "Chapter N: title"). Part
        selection lives in `Eo3` state (`partId`); `preview.tsx` shows a part selector when
        there's more than one part. Tests: `test/ao3/export.test.ts`.
-   [x] **2c — UI.** `src/ui/components/parts-list.tsx` in the left panel: one row per part
        (select → preview; title; styles; detach; ↑/↓; remove with confirm) and "+ add
        chapter", which calls `Document.addPartWithText` (new part + a rich-text module wired
        to it, one undo step). "styles" calls `Document.partStyles`, which creates the part's
        managed CSS module wired to it on first use (lazy, so single-chapter works stay
        uncluttered) and returns the same module afterwards; "detach" clears `stylesModuleId`
        and leaves the module and its wiring alone. Graph: one output node per part
        (`auto-layout.ts` column 0 in part order; labelled "Chapter N" when there are several;
        160px apart), `isPartOutput()` replaces `'output'` checks. Module list send menus list
        every part. `SiteTargetProvider` now wraps the whole editor (the left panel needs the
        target's `partLabel`). Tests: `test/document/parts.test.ts` (mocks the plugin
        registry; the real Text plugin needs `matchMedia`).
        (Collapsing managed style modules into their output node landed in phase 5.)
-   [x] **2d — posting.** `PostedSnapshot { at, classes, htmlHash }` on `Part` (persisted).
        `SiteTargetPreviewProps.posting: PartPosting` (built in `PostPreview`): marking records
        the date, the `eo3-*` classes in the part's primary output (`class="…"` attributes) and
        `fnv1a36` of that output (`src/util/hash.ts`, also used by lift-styles). Shared control
        `post-preview/posted-status.tsx` next to the copy buttons (AO3 chrome, cohost footer):
        "mark as posted"; reminder after copying an unmarked part; "changed since you marked it
        posted" when the output hash differs; "unmark". `CopyToClipboardButton` has
        `onCopied`; copies of 'part'-scoped outputs are tracked per session in `Eo3` state
        (`copiedParts`, not persisted). Parts list shows "posted" / "not marked posted" badges.

## Phase 3 — delivery strategies and the skin record (done)

Plan, in order:

-   [x] Extract `src/targets/delivery/shared-stylesheet.ts` from `ao3/export.ts` (lift merge,
        sort, canonicalize callback) and `delivery/inline.ts` from `cohost/export.ts`; targets
        call them. Pure refactor; parity + export tests must pass unchanged.
-   [x] Part-scoped CSS: on shared-stylesheet targets wrap a part's HTML in
        `<div class="eo3-part-<partId>">` and prefix CSS that reaches only some parts with that
        class for each part it reaches (scope follows reach). Work CSS stays unscoped. Needs the
        reach per CSS module, not just per part: extend `evalWork` to return, per CSS source,
        the set of parts it reaches.
-   [x] Skin record: keep a rule while any posted snapshot references its class, even if no
        current part does; "clean up unused styles" drops the rest after showing them.
-   [x] Diff before copy: compare the new Work Skin with the one last marked posted (store the
        skin text or its rule set when a part is marked posted) — "N styles added, M removed".
-   [x] Cross-part conflict warning: the same selector with different declarations in CSS
        that reaches different parts.

The skin record is saved in document version 1. Marking a part posted adds its lifted rules to
that record and saves the current Work Skin for the later diff. Export retains a recorded rule only
while some posted part references its class. The cleanup control shows the unused rules before
deleting them from the record. Older posted snapshots have class names but no saved rule text or
Work Skin; marking those parts posted again seeds the record and diff baseline.

## Phase 4 — import an existing AO3 work (done)

-   [x] The AO3 parts panel has a compact import flow: paste Work Skin CSS, then paste each
        chapter's HTML source and optional title in order. Inputs become ordinary editable
        `source.text` modules. Existing chapters are not automatically marked posted; the user
        checks the preview and marks them explicitly.
-   [x] An imported Work Skin is a managed CSS module sent to every part. Adding a part later
        wires it to the skin automatically. Reimporting replaces that module in one undo step.
        The reference is saved in document version 1 by module index, and clears if the module
        is removed.
-   [x] The first pasted chapter uses an otherwise empty initial part; later ones append parts.
        Every chapter import is one undoable change and preserves the pasted HTML in code mode.
-   [x] Import canonicalizes the pasted skin to seed the record with existing `eo3-*` rules and a
        diff baseline. Those rules are protected even if none of the already-posted chapters are
        imported. Export does not duplicate a recorded rule already present in the imported CSS.
        The cleanup control leaves protected rules alone; a separate review list can explicitly
        prune selected rules from the imported module and record. A canonical unchanged Work Skin
        round-trips byte for byte in the export test.

AO3's chapter HTML sanitizer is not a fixed point (phase 1 finding): it can remove inter-block
newlines on a second pass. Imported chapter HTML stays unchanged in its source module, but its
export may have that visually identical normalization. Imported CSS is preserved as an editable
module; eo3 never automatically removes its authored rules.

## Phase 5 — groups and packaged effects (done)

-   [x] **Groups** (`src/document.ts`): a `GroupDefinition` is shared by `GroupInstance`s; an
        instance is a list of ordinary modules in one part (`moduleIds`, in matching order across
        instances). Evaluation is untouched. Editing a module's data or title in an instance
        (`insertModule`) copies it to the module in the same slot of every sibling instance;
        wiring stays per instance. `detachGroup` gives an instance its own definition.
        `duplicateGroup` clones an instance into a part, remapping internal links and the part
        output. `createGroup` (modules must only send within the group or to the part's output)
        exists but has **no UI yet** — it needs multi-select in the graph. Removing a part or any
        module of an instance forgets that instance (the modules stay, unwired from the part).
        Persisted in document version 1 (`groupDefinitions`, `groupInstances` by module index).
-   [x] **Effect shelf** (`src/effects.ts`, parts list): Text message thread, Letter, Chat log,
        each added as an HTML + CSS module pair wired to the selected part; adding the same effect
        again reuses its definition (shared). Effect classes use the `fx-` prefix — `eo3-` is
        reserved for generated classes (posting records every `eo3-*` class as generated).
        The parts list shows the part's groups with "copy here" and "detach".
-   [x] **Graph**: a part's managed styles module is hidden from the graph while it is only wired
        to its part (`collapsedStyles` in `auto-layout.ts`); the output node has "+ styles" /
        "edit styles". A styles module that isn't sent anywhere (e.g. detached, then its part
        removed) is listed under the parts with a link to it.
-   Tests: `test/document/groups-and-splitting.test.ts`.

## Phase 6 — splitting, target profiles, crossposting (done)

-   [x] **6a — splitting long parts.** Splits the **source**, not the output, so both pieces stay
        editable: `Document.splittableContent(partId)` accepts a part fed by exactly one content
        module (anything but CSS/Sass/Less) that is a Text module holding HTML (`html` or
        `html-contenteditable`); otherwise it returns a plain-language reason.
        `Document.splitPart(partId, first, second)` keeps `first` in that module, inserts a new
        part after it (title "… (continued)") with a copy of the module holding `second`, and
        sends everything else that reached the part (styles, Work Skin) to the new part too; one
        undo step. The split point comes from `src/util/split-html.ts`: top-level block
        boundaries only, descending through a lone wrapper element (closed and reopened with the
        same attributes), the last cut whose first piece `fits`. Targets declare `partMaxChars`
        (AO3 500,000; cohost 200,000); `PostPreview` measures candidates with the target's
        `renderFallback` against 90% of the limit (room for lifted classes and part wrappers).
        `SiteTargetPreviewProps.sizing` feeds `post-preview/split-prompt.tsx`, shown from 95% of
        the limit next to the size meter. Tested in the browser on a 530 kB chapter
        (→ 450 kB + 80 kB, 0.1 s). Tests: `test/util/split-html.test.ts`, split cases in
        `test/document/groups-and-splitting.test.ts`.
-   [x] **Author-placed break follow-up.** HTML source modules offer "insert chapter break" in
        code mode, inserting the invisible `<!-- eo3:split -->` marker at the cursor. Parts with a
        marker offer "split at break" without waiting for the size warning. The size warning
        prefers the first marker and checks that its first piece fits the target. Splitting can
        reopen a surrounding wrapper and leaves later markers for subsequent splits. It refuses
        a text source shared with another part or group so other uses are not silently rewritten.
        Not done: an author-placed break marker in content (adding a part covers it for now).
-   [x] **6b — custom target profiles.** `src/targets/profile/`: `TargetProfile` + `parseProfile`
        (validates imported JSON, fills defaults) + `newProfile` template (`types.ts`);
        `createProfileTarget` builds a `SiteTargetPlugin` from a profile (`target.tsx`): the
        config-driven sanitizer from `targets/ao3/render/sanitize.ts`, then one of four delivery
        strategies — `shared-stylesheet` (lift + `exportSharedStylesheet`), `inline`
        (`exportInline`; `class` is kept through sanitizing so CSS can match before the inliner
        drops it), `embedded-style` (a `<style>` block per part), `plain` (all styling dropped,
        reported). Optional `cssProperties` allowlist filters stylesheets and style attributes
        (`filter-css.ts`). Own ERRORS registry and footer with an error list (`diagnostics.tsx`),
        per the per-target-registries convention. Profiles are app-wide in localStorage
        (`store.ts`, key `eo3:target-profiles`, target ids `profile:<id>`), not in documents:
        they describe sites, not stories; the editor copies/imports them as JSON to share.
        `SiteTargetProvider` loads them and rebuilds on change (falls back to AO3 if the active
        one is deleted). Editor: `ui/components/profile-editor.tsx` (native `<dialog>`), opened
        from "custom sites…" in the site selector. Tests: `test/targets/profile.test.ts`.
-   [x] **6c — crossposting.** All posting state is keyed by target id (`ao3`,
        `profile:<id>`, …): `Part.postedTo` replaces `Part.posted`; `DocumentState.skinRecords`,
        `skinBaselines` and `protectedSkinClasses` are per-target maps (accessors
        `skinRecordFor` / `skinBaselineFor` / `protectedClassesFor`), and `setPartPosted`,
        `cleanupUnusedSkinRules`, `pruneImportedSkinRules` and `importWorkSkin` take the target
        id. The imported skin _module_ stays global (it's content every target sees). Files from
        before crossposting load as posted to `ao3` (`LEGACY_TARGET` in `storage/versions/v1.ts`).
        `PostPreview` reads the state for `plugin.id`; session copy reminders are keyed by
        target + part (`copiedKey` in `targets/context.tsx`). The parts list shows "posted" for
        the site on screen and "also on …" for the others (`targetTitle`). Crossposting in
        practice = switching the site selector; each site keeps its own marks, record and diff.
        Tests: "crossposting" in `test/document/parts.test.ts`.

## Phase 7 — wafrn (done)

Read from wafrn's source (codeberg.org/wafrn/wafrn; the GitHub mirror is archived) at `944a5ab`:

-   Readers' browsers run `sanitize-html` (2.17.7) in `PostRenderingService.getPostHtml`
    (`packages/frontend/src/app/services/post-rendering.service.ts`), then insert the HTML with
    raw `innerHTML` into a component with `ViewEncapsulation.ShadowDom`. So a post's `<style>`
    block (allowed via `allowVulnerableTags`) applies to that post only; `class` is allowed on
    everything; `style` attributes are filtered to ~120 properties; `<style>` content isn't.
-   No `<div>` (use `<section>`/`<aside>`); `<marquee>`, `<font>`, `<details>`, ruby are allowed.
-   Images in post text get `src` blanked at display (stored content is unchanged).
-   Readers with reduced motion get Angular `[innerHTML]` instead, which strips styles. The
    backend's server-rendered pages (`services/getPostHtml.ts`) allow no `class`/`<style>`/`img`.
    Other fediverse servers apply their own sanitizers. None of these are modelled.
-   No practical size limit (50 MB request body), so no `partMaxChars`.

Built as:

-   `src/targets/wafrn/sanitizer-config.json` — wafrn's own settings, extracted (not
    transcribed) by `test/wafrn-parity/extract.mjs` (`npm run test:wafrn-update`; parses the
    source as text, never runs it; records the commit and wafrn's locked sanitize-html version).
-   `src/targets/wafrn/index.tsx` — a profile (`embedded-style` delivery) built from that config
    via `createProfileTarget`, which gained an extension hook (own id, own ERRORS registry,
    per-part `finalizePart`, mascot). wafrn's `finalizePart` warns about images. Profiles gained
    `styleAttributeProperties` (filter for `style` attributes only), `removeContents` and
    `whitespaceElements` (sanitize-html unwraps without spacing and keeps `<style>`).
-   `test/wafrn-parity/parity.test.ts` runs the real sanitize-html (pinned to wafrn's version)
    with the extracted config against eo3's wafrn target over 17 cases, plus a version check.
    `.github/workflows/wafrn-upstream.yml` re-extracts weekly and opens a PR on change.

## Open follow-ups

Everything in the design's seven phases has landed, and the follow-ups found along the way are
done. Smaller known limits:

-   Custom site profiles live in the browser (localStorage), not in the document; share them as
    JSON.
-   `npm audit` still reports one moderate advisory for the Svelte 3/4 compiler aliases used to
    support older Svelte modules. Its suggested forced fix replaces them with Svelte 5 and would
    break that compatibility; review a migration separately.

## Log

-   2026-09-26 — Plan written; phase 1 started.
-   2026-09-26 — Phase 1 done (see findings above). Next: phase 2.
-   2026-09-26 — Phase 2a (data model) done.
-   2026-09-26 — Phase 2b (targets export the whole work) done.
-   2026-09-26 — Phase 2c (parts list, graph outputs, part styles) done. Also fixed a pre-existing
    crash: undo that shortened a code editor's text blanked the app (`codemirror.tsx`).
-   2026-09-26 — Phase 2d (mark as posted) done; phase 2 complete. Next: phase 3.
-   2026-09-26 — Phase 3 delivery strategies extracted; shared stylesheets now scope CSS by each
    module's reach and wrap multi-part HTML. The preview uses the same part wrapper. Next: skin
    record, diff before copy, and cross-part conflict warnings.
-   2026-09-26 — Phase 3 complete. Posted snapshots now capture Work Skin text and lifted rules;
    export retains referenced rules, cleanup lists and removes unreferenced records, the preview
    shows added/removed style counts before copy, and selectors with conflicting part-specific
    declarations are reported. Next: phase 4 import.
-   2026-09-26 — Phase 4 paste flow landed. The design artifact clarified additional retention
    and round-trip requirements.
-   2026-09-26 — Phase 4 retention follow-up complete. Imported generated rules seed the skin
    record, remain protected for unimported chapters, and can be pruned only after a rule review.
    Canonical unchanged Work Skin export is byte-for-byte stable. Next: phase 5.
-   2026-09-26 — Design doc copied into the repo (`docs/design/publishing-model.md`).
-   2026-09-26 — Phase 5 done (continued from Sol's uncommitted work): effect classes renamed to
    `fx-`, styles-module naming and unsent-styles warning added, tests. Next: phase 6.
-   2026-09-26 — Phase 6a (splitting long parts) done. Next: 6b custom target profiles.
-   2026-09-26 — Phase 6b (custom target profiles) done. Next: 6c crossposting.
-   2026-09-26 — Phase 6c (crossposting: per-target posting state) done; phase 6 complete. Next: phase 7 (wafrn).
-   2026-09-26 — Phase 7 (wafrn) done. All planned phases complete; see "Open follow-ups".
-   2026-09-26 — Added graph multi-selection for creating reusable groups from existing modules.
    `groupablePart` checks a selection's external wiring before creation; copying a group remaps
    its internal links and part output. Remaining group UI work: optionally collapse members into
    one card.
-   2026-09-26 — Added an author-placed chapter break marker to HTML source modules. Authors can
    insert it at the code editor's cursor and split a part at that point, even below the size
    warning threshold. The size prompt honors it when present.
-   2026-09-26 — Added advanced custom-site form fields for style-attribute properties, tags
    removed with their contents, and whitespace when unwrapping. Each optional list has an
    explicit override checkbox, preserving the difference between omitted and empty arrays when
    editing an imported profile. Saving and previewing now switches sites only after a valid save.
-   2026-09-26 — The custom-site dialog now lists posting history for removed profiles in the
    open work. Authors can explicitly forget a retired site's marks, skin record, baseline, and
    protected classes in one undoable change. History in unopened works stays available until
    each work is opened and reviewed.
-   2026-09-26 — wafrn previews of styled posts now note that reduced-motion readers,
    server-rendered pages and other fediverse servers show the post unstyled. Profile targets
    take an optional `footerNote` for site-specific notes like this.
-   2026-09-26 — Groups now show in the graph as one card (collapsed by default) that expands to
    its members. Edges to hidden members are drawn to the card with their own ids and mapped back
    when selected or removed (`module-graph/group-cards.ts`, tested in `test/ui/`).
-   2026-09-27 — Collapsed group cards can now be dragged. One undoable layout change translates
    every member by the same offset, preserving their relative positions; a graph test covers the
    translation and leaves other groups untouched. A component test checks the controlled drag
    position and undo. The local browser preview was blocked by this environment, so a manual
    drag check remains useful.
-   2026-09-27 — Updated direct SVGO and PostCSS dependencies to patched releases and refreshed
    compatible transitive packages after GitHub reported dependency advisories. The full audit
    dropped from 9 findings (4 high) to 1 moderate in the legacy Svelte aliases. Typecheck, tests
    and production build pass with the updated lockfile.
-   2026-09-27 — Redesigned group cards after review ("out of place", "breaks position", unclear
    inputs/outputs). A collapsed group is now a regular module card whose rows are the links
    crossing the group's edge: one input row per member fed from outside, one output row per
    member sending out (with its type), each with its own handle. Auto layout places the card as
    one node, keeps expanded members adjacent, and leaves room for a framed "▾ title" header.
    Needs a visual check in a visible window (the Claude pane can't draw while hidden).
-   2026-09-27 — Chapters UI pass, from a design review with the author:
    -   "All chapters" (`source.shared-styles`): a visible CSS node that also accepts CSS, wired to
        every part and to each new part (`Document.modulesWiredToNewPart`). No hidden rule: reach
        is still decided by wiring, and the node names itself "3 of 4 chapters" when unwired
        from some. Works that predate it get an empty one on open (`ensureSharedStyles`, no undo
        step), existing links untouched; deleting it is remembered (`sharedStyles = false`).
    -   Part outputs show separate HTML and CSS inputs; edges attach by the data they carry.
    -   Each part's managed styles are docked to the right of its output, feeding a CSS port on
        that side; parts without styles show a "+ styles" placeholder.
    -   The sidebar lists chapters only, with a ⋯ menu per row (`action-menu.tsx`). The effect
        shelf moved into "add node"; group sharing ("use in Chapter N", detach) moved onto the
        group card's ⋯ menu.
-   2026-09-27 — Groups reworked after review ("effects feel too hardcoded", "too abstract"):
    -   A group is just named modules shown as one card (`ModuleGroup`: id, title, moduleIds).
        Any selection of two or more ungrouped modules can be grouped; links crossing its edge
        become the card's rows. Grouping pins members' positions so the layout is kept.
    -   Copies are independent: no shared definitions, no detach. Older files' definitions and
        instances load as independent groups titled by their definition.
    -   Group files (`storage/group-file.ts`, `.eo3group.json`) hold modules, internal links and
        relative layout; imports arrive unwired. "My groups" (`storage/group-library.ts`) keeps
        saved group files in this browser, in an order the author sets.
    -   The built-in effects are now example group files (`src/groups/examples.ts`).
    -   "add node" has a "Groups ›" row opening a second level: import file, My groups (⋯: move,
        export, remove), Examples. The card's ⋯ menu: rename, save to my groups, export,
        duplicate, ungroup.
-   2026-09-27 — Merged `feat/mobile-layout` (phone reflow, on-screen keyboard handling). The
    "add node" picker now fits phone widths, since Groups lives there.
-   2026-09-27 — Update notice: after eo3 updates, a toast says so until dismissed; "See changes"
    lists the commits since the version this browser last acknowledged, fetched from GitHub's
    compare API (`util/changelog.ts`) and sorted into New / Fixed / Behind the scenes. The
    version is the build's `gitCommitHash`; dev.vayne.garden's hourly deploy builds eo3 `main`.
    A first visit lists changes since `3ce4778` (the author's chosen baseline).
