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
| 2     | `Work` + parts in the document; migration of saved documents; parts list UI; `export()` over a work            | In progress |
| 3     | Delivery strategies (`shared-stylesheet`, `inline`); skin record; diff before copy; part-scoped CSS; conflicts | Not started |
| 4     | Import an existing skin, then existing chapters                                                                | Not started |
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

## Phase 2 — works and parts (in progress)

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
-   [ ] **2c — UI.** Parts list (labels from the target: Chapter/Post); one output node per part
        in the graph (`module-graph/index.tsx`, `auto-layout.ts`) and per-part entries in the
        module list's send menu (`module-list.tsx`); managed "Part styles" CSS module per part,
        auto-wired, detachable, collapsed under its part in the graph.
-   [ ] **2d — posting.** "Mark as posted" (explicit) recording the part's `eo3-*` classes;
        warnings for copied-but-unmarked parts.

Part-scoped CSS (wrapping a part in `eo3-part-<id>` and prefixing its CSS) is phase 3; in 2b
part CSS is simply added to the shared skin unscoped.

## Log

-   2026-09-26 — Plan written; phase 1 started.
-   2026-09-26 — Phase 1 done (see findings above). Next: phase 2.
-   2026-09-26 — Phase 2a (data model) done.
-   2026-09-26 — Phase 2b (targets export the whole work) done.
