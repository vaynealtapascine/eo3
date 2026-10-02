# Codebase cleanup review — 2026-09-29

This pass reviewed EO3's document/part additions, groups and browser libraries, target
delivery and profiles, plugin loading, chapter splitting, and build dependencies. It
also inspected the preview and editor boundaries for follow-up work. It is not a claim
that every path in the application has been exhaustively audited.

History was checked against the last upstream cpsdqs commit, `2c85906`. Runtime edits
are confined to EO3 additions, including EO3-added sections of inherited files. The
inherited evaluator, live-preview implementation, UI toolkit and examples are unchanged.
The pre-existing working-tree edit in `src/ui/sidebar.css` is also untouched.

## Removed (>95% confidence)

Seven unused build dependencies: `@rollup/plugin-alias`, `@rollup/plugin-babel`,
`@rollup/plugin-html`, `@rollup/plugin-json`, `@rollup/plugin-typescript`,
`@surma/rollup-plugin-off-main-thread`, and `rollup-plugin-postcss`.
Repository searches found no consumers outside the manifests. The current Vite config
and example-export scripts use other plugins. Removing these pruned 150 installed/locked
packages, added none, and changed no retained package versions. Production build and
example packaging were verified after removal.

Also removed redundant JSON stringify/parse work when saving the group library and a
stray comment left above `moduleDescription`.

## Fixed and refactored (>90% confidence)

-   **CSS cascade:** Inline and embedded-style delivery now select CSS through the shared
    `delivery/part-css.ts` helper. It preserves graph module order using `cssSources` and
    excludes sources that do not reach the part. Older callers providing only `workCss`
    and `part.css` retain the previous fallback. Previously, moving all shared CSS before
    part CSS could reverse the winning declaration.
-   **Render consistency:** `Document.evalWork()` captures parts, modules and posting
    metadata before waiting. Adding, removing or rearranging parts during evaluation no
    longer mislabels old output, loses its styles, or reads past the evaluated parts.
    The inherited module evaluator is unchanged.
-   **Concurrent loading:** EO3's `lazy()` shares one pending promise, retains falsy exports,
    and permits retry after failure. Concurrent managed-styles requests recheck the part
    after loading and create one node and one undo entry.
-   **Browser libraries:** Custom profiles and My groups share persistence and subscription
    handling in `storage/browser-list-store.ts`, while keeping their separate validation,
    keys and stored formats. Failed writes throw a readable error and never emit a success
    notification. Menus and the profile editor display the error; failed imports retain
    pasted text, and failed saves do not switch targets. Subscribers also refresh after
    another tab changes the corresponding library.
-   **Profile validation:** Delivery names must be actual registered strategies, rather than
    inherited object keys. Arrays cannot masquerade as attribute/protocol maps, and size
    limits must be finite. Group imports similarly reject inherited object keys as unknown
    module types before making changes.
-   **Plain delivery:** Explicitly strips embedded `<style>` elements even if the profile's
    element allowlist includes them.
-   **Chapter splitting:** Candidate-boundary scanning is linear in the number of nodes,
    replacing repeated suffix copies. Binary search and the existing splitting rules remain
    unchanged, including the requirement that both sides contain something besides whitespace.

Regression coverage includes CSS precedence and reach, edits during asynchronous rendering,
concurrent loads/styles creation, invalid imports, storage failure/recovery boundaries,
cross-tab notifications, visible UI errors and whitespace at split boundaries. No document
schema or module-data interface was changed. AO3 sanitizer sources and parity fixtures are
unchanged.

Validation: typecheck passed; all 19 test files passed (534 tests, with the same 3 existing
skips); changed TypeScript and this review passed Prettier; `git diff --check` passed;
production build and all 14 example exports passed. A blame check of every changed existing
runtime line attributed it to EO3's author, not cpsdqs. Browser interactions were exercised
with DOM component tests, not a manual browser session.

## Examine later

Percentages below express confidence in the proposed architectural change, not the
probability that the observation is real. Upstream items are explicitly deferred under
the instruction to change cpsdqs's code only for a demonstrated substantial performance gain.

| Area                                 | Observation and next examination                                                                                                                                                                                                                                                                                                                                                     | Confidence in changing now     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Inherited live preview               | `MarkdownRenderer` compares two values captured by the same effect, so the apparent stale-result guard cannot detect a later render. The live-renderer loader also needs a lifecycle review. Reproduce with delayed promises and target switches before designing cancellation; leave upstream code alone for this cleanup.                                                          | Deferred: upstream restriction |
| Preview/export contract              | `post-preview/index.tsx` can inject authored CSS even when a target exports no styling; rendered-HTML caching is keyed by content rather than the full target/configuration. Decide whether the comparison pane is intended to show source appearance or final delivery, then test switching targets and configurations with identical content. This crosses inherited preview code. | 50%; upstream boundary         |
| Plugin capabilities                  | `document.ts:isCssModule` knows specific plugin ids and text languages. Evaluation itself already uses `CssData`; only pre-render UI/splitting classification uses the heuristic. Compare an optional output-kind capability against dynamic plugins that cannot promise one kind before adding a new plugin contract.                                                               | 55%                            |
| Shared sanitizer location            | Custom profiles import configurable sanitizing/lifting APIs from `targets/ao3/render`. The APIs already accept configuration, so moving them is mainly an ownership change. Establish whether a target-neutral package would reduce real coupling enough to justify file moves and parity-regeneration work. Keep separate target error registries.                                  | 45%                            |
| Target load recovery                 | `targets/context.tsx` has no explicit UI for a rejected target import. Design a retry/error state that preserves the selected target instead of silently changing the export destination. Exercise offline chunk loading before changing the provider interface.                                                                                                                     | 55%                            |
| Large editor/compiler bundles        | Production reports large text-editor, Sass and app chunks. Measure first-edit and first-render costs in a browser before splitting editor loading or relocating compiler work. The build also reports AO3 stylesheet image URLs without local assets; audit actually used selectors before trimming mirrored site CSS.                                                               | 45%                            |
| Legacy targets and compiler versions | Cohost and Svelte 3/4 may look obsolete, but existing documents can depend on them, and the user explicitly protects upstream code. Keep their compatibility paths; examine actual usage and migration options before removing anything.                                                                                                                                             | 20%                            |
| Example packaging                    | The main build regenerates and exports all 14 workskins. Separating app builds from gallery packaging could simplify iteration, but the external site consumes those downloads. Inspect that deployment contract before changing the build entry point.                                                                                                                              | 50%                            |

The local Node executable is 22.14.0. Installed jsdom-related packages report newer Node
engine requirements during npm operations, although this run's checks succeed. Align the
developer runtime with the dependency requirements separately; no system runtime was changed.
