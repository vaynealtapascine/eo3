# PROGRESS.md

Hand-off log for the works/parts/targets implementation. Read this first when picking the work up;
update it whenever a step lands (what changed, what's next, anything surprising).

-   **Design doc:** [eo3 publishing model: works, parts and targets](https://claude.ai/code/artifact/9963cb7e-25bd-4c94-ac4c-8eff7d3f6768)
    (decisions are recorded at its end).
-   **Repo conventions:** see [AGENTS.md](AGENTS.md). Gate before every commit: `npm run typecheck`
    and `npm test`; `npm run build` before pushing.

## Status

| Phase | Scope                                                                                                          | State       |
| ----- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| 1     | Canonical, sorted Work Skin; pinned-hash test; collision check                                                 | Done        |
| 2     | `Work` + parts in the document; migration of saved documents; parts list UI; `export()` over a work            | Done        |
| 3     | Delivery strategies (`shared-stylesheet`, `inline`); skin record; diff before copy; part-scoped CSS; conflicts | Done        |
| 4     | Import an existing skin, then existing chapters                                                                | Next        |
| 5     | Group nodes (shared but detachable); first packaged effects                                                    | Not started |
| 6     | Size-based splitting; custom target profiles; crossposting                                                     | Not started |
| 7     | wafrn target (read its sanitizer source first)                                                                 | Not started |

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
        **Not done:** collapsing managed style modules under their part in the graph view.
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
