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
| 2     | `Work` + parts in the document; migration of saved documents; parts list UI; `export()` over a work            | Next        |
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
    ` ` between block elements (visually identical). Splitting (phase 6) must compare against
    AO3's re-sanitized output, not assume identity.
-   AO3's cleaned Work Skin **is** a fixed point, except `@font-face` (a known divergence).

## Phase 2 — works and parts (next)

Start by reading `src/document.ts` (single `MOD_OUTPUT`), `src/ui/components/preview.tsx`,
`src/ui/components/post-preview/index.tsx` and `src/storage/versions/` (migrations). Plan:

-   [ ] Document: `Work { parts: Part[] }`, each part with a stable id, title and its own output
        module; existing documents migrate to one part on `MOD_OUTPUT`.
-   [ ] Per-part managed "Part styles" CSS module, auto-wired and detachable (design doc decision).
-   [ ] Evaluate every part; scope CSS by which parts it reaches (all parts → work style).
-   [ ] `SiteTargetPlugin.export` over a work: per-part outputs + shared outputs (AO3: one skin).
-   [ ] Parts list UI with target-provided labels; preview a chosen part with the whole-work skin.
-   [ ] "Mark as posted" (explicit) with warnings for copied-but-unmarked parts.

## Log

-   2026-09-26 — Plan written; phase 1 started.
-   2026-09-26 — Phase 1 done (see findings above). Next: phase 2.
