# eo3 publishing model: works, parts and targets

Design reference, 2026-09-26. This is the repo copy of the design doc (the living version is
[on claude.ai](https://claude.ai/code/artifact/9963cb7e-25bd-4c94-ac4c-8eff7d3f6768)); decisions
are at the end. What has actually been built, and where it deviates from this design, is logged in
[PROGRESS.md](../../PROGRESS.md).

## Summary

eo3 should model a project as a **work** made of ordered **parts**, rendered by a **content graph** and delivered to one or more **targets**. Today it has one graph, one output and targets that each hard-code their delivery, which can't express chapters, stable Work Skins across chapters, importing posted works, or sites beyond AO3 and cohost.

The proposal splits responsibilities into three layers:

1. **Content** — the existing module graph, unchanged in power and target-agnostic.
2. **Structure** — a work with ordered parts (chapters, posts in a thread, pages), managed by the app rather than wired in the graph.
3. **Delivery** — a target that declares how its site accepts HTML and CSS, reusing a small set of shared delivery strategies.

Safety rules that span the whole work (stable class names, a Work Skin that only grows, what has been posted) live in the app, not in user wiring, so beginners can't break a posted chapter. Everything the app manages stays inspectable and overridable for experienced users.

## Goals and non-goals

The primary audience is young, not especially technical fic writers; experienced users must lose no power.

**Goals**

-   Multi-chapter works, where editing a later chapter never breaks the styling of one already posted.
-   Work Skin changes are minimal and predictable: rules are added, and removed only on request.
-   Import an existing work (its Work Skin and, optionally, its chapters) without renaming anything.
-   Split a chapter that exceeds a site's size limit without changing its styling.
-   One model for any site that accepts hypertext: AO3, cohost (legacy), wafrn, static sites, and sites added later.
-   A beginner never needs to wire nodes, name classes or understand hashing.
-   An experienced user can inspect and override everything the app manages.

**Non-goals**

-   Posting to sites automatically. eo3 prepares output; the user pastes it.
-   Replacing the module graph or changing how it evaluates.
-   Exact sanitizer ports for every site. Only high-value sites get verified ports; the rest use declarative profiles.

## Background

eo3 today produces exactly one piece of content per project, and each target decides on its own how to package it.

**The app now**

-   A document is a graph of modules. Each module evaluates to data and sends it on; everything ends at a single output node (`MOD_OUTPUT = 'output'` in `src/document.ts`).
-   The output (HTML plus the CSS sent to it) goes to the selected `SiteTargetPlugin` (`src/targets/types.ts`). A target has a fallback renderer, an `export()` that returns a fixed list of `outputs`, preview chrome and its own error list.
-   The AO3 target runs a port of otwarchive's chapter sanitizer and Work Skin validator (`src/targets/ao3/render/`), checked against AO3's real Ruby code by the parity tests in `test/ao3-parity/`.
-   Inline `style` attributes are lifted into classes named `eo3-<hash>`. The hash is FNV-1a (32-bit, base 36) over the normalized declarations (`lift-styles.ts`), so the same style always gets the same class. The Work Skin is the authored CSS followed by those lifted rules, in document order.

**Site constraints that shape the design**

| Site                         | Unit                    | Where CSS can live                                  | Does a CSS change affect posted units? | Limits                                                            |
| ---------------------------- | ----------------------- | --------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| AO3                          | Chapter of a work       | One Work Skin shared by every chapter               | Yes: a skin edit restyles all chapters | 510,000 characters per chapter and per skin; strict CSS validator |
| cohost (legacy)              | Post, often in a thread | Inline `style` only; classes and `<style>` stripped | No: each post is frozen                | cohost's sanitizer                                                |
| wafrn                        | Post                    | Not yet verified                                    | Not yet verified                       | Not yet verified                                                  |
| Static site (e.g. Neocities) | Page                    | Anywhere, including shared stylesheets              | Yes, if pages share a stylesheet       | Host limits only                                                  |

AO3 limits are from otwarchive's `config.yml` (`CONTENT_MAX: 510000`) and `skin.rb` (`validates :css, length: { maximum: ArchiveConfig.CONTENT_MAX }`). The key consequence: on AO3 every Work Skin rule applies to every chapter, and removing a rule can break a chapter posted months ago.

## The model

A project is a work: the graph produces content for each part, and each selected target turns the parts into what its site accepts.

1. **Content (the graph).** Unchanged. Modules produce HTML and CSS. Packaged effects for beginners are groups that flatten into the same graph before evaluation.
2. **Structure (the work).** An ordered list of parts, each with a stable ID, a title and its own output in the graph. Styles are either **work styles** (sent to every part) or **part styles** (sent to one part). The app owns this list; users never wire parts by hand.
3. **Delivery (the target).** Declares its part type, its delivery strategy, its limits and allowlists, and its preview. Owns its sanitizer, preview chrome and error list.

A target maps parts to its own unit and labels them in the UI:

| Target            | A part becomes           | Label in the parts list |
| ----------------- | ------------------------ | ----------------------- |
| AO3               | Chapter of the work      | Chapter                 |
| cohost (legacy)   | Post in a thread         | Post                    |
| Static site       | Page                     | Page                    |
| Single-post sites | The post (one part only) | Post                    |

**Delivery strategies** are written once and shared by any target that needs them:

| Strategy           | What it does                                                                                                                      | Used by                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Shared stylesheet  | Lifts inline styles to stable `eo3-<hash>` classes; emits one stylesheet for the whole work plus a skin record (see next section) | AO3 today; static sites with a shared stylesheet |
| Inline everything  | Applies all CSS as `style` attributes; drops classes and `<style>`                                                                | cohost today                                     |
| Embedded `<style>` | Keeps a `<style>` block inside each part                                                                                          | Sites that allow `<style>` in posts              |
| Plain HTML         | Removes styling the site can't carry and warns about each loss                                                                    | Very restrictive sites                           |

The stable-class machinery belongs to the shared-stylesheet strategy, not to AO3. Inline and embedded strategies need none of it, because each part carries its own styles and can't break another part.

## Stable styling for shared stylesheets

Keep content hashing as the naming scheme; add a persisted skin record so the stylesheet only grows until the user chooses to prune it.

The risk on a shared stylesheet is removal, not renaming. Editing a style yields a new `eo3-<hash>`; if the stylesheet is rebuilt from the current content alone, the old rule disappears and every posted part that used it loses its styling.

**Rules for the shared-stylesheet strategy**

1. **Build from the whole work.** The stylesheet is the union across all parts. Identical authored rules are deduplicated; the same selector with different declarations in different parts raises a warning, because the site applies both everywhere.
2. **Canonical, sorted output.** Lifted `eo3-*` rules are sorted by class name. Each element carries at most one lifted class, so their order has no cascade effect, and the output no longer depends on part order. Emit the site's canonical form (for AO3, `cleanWorkskinCss` with the `#workskin` prefix), so what the user pastes equals what the site stores.
3. **Skin record.** When a part is marked as posted (an explicit step; the app warns when a copied part hasn't been marked, and before pruning), store the `eo3-*` classes its HTML references. A rule is kept while any current part or any posted snapshot references it. Rules are only appended as the user works.
4. **Pruning is explicit.** "Clean up unused styles" removes rules nothing posted uses, after showing the diff. Imported rules the app didn't generate are never pruned automatically.
5. **Diff before copy.** Show what changed since the last posted stylesheet: "2 styles added, 0 removed".
6. **Pinned naming format.** FNV-1a plus `normalizeDecls` is a versioned format. A test pins known input → class pairs, because any change would rename every class in every posted work. A new format needs a migration that keeps old names.
7. **Collision check.** If two different declaration blocks produce the same class, report it instead of reusing the class. At 32 bits a collision is unlikely at hundreds of classes, but it would otherwise be silent.

How names become stable, compared:

| Approach                            | Stable across sessions | Needs stored state | Survives editing a style                     | Verdict                                      |
| ----------------------------------- | ---------------------- | ------------------ | -------------------------------------------- | -------------------------------------------- |
| Content hash (current)              | Yes                    | No                 | New name; old rule must be kept              | Keep                                         |
| Content hash + skin record          | Yes                    | Yes, small         | Yes: old rule kept while posted parts use it | **Proposed**                                 |
| Sequential names (`eo3-1`, `eo3-2`) | Only with stored state | Yes                | Depends on bookkeeping                       | Reject: fragile, order-dependent             |
| User-chosen names                   | Yes                    | In the content     | Yes                                          | Keep for authored CSS; not for lifted styles |

## Parts, scoping and splitting

Parts are identified by stable IDs, not positions, so reordering or inserting a part never renames or rescopes anything.

**Part styles are scoped automatically.** On shared-stylesheet targets, a part's content is wrapped in `<div class="eo3-part-<id>">` and its part styles are prefixed with that class. Work styles stay unscoped. Site-provided positional IDs (AO3's `#chapter-N`) are never used for scoping, because they shift when chapters move.

**Scope follows reach, not node type.** CSS that reaches every part is a work style and stays unscoped. CSS that reaches only some parts is scoped to each part it reaches, so a detached style module wired to Chapters 2 and 5 is scoped to both.

**Preview each part with the whole-work stylesheet.** That is what the site does, and it surfaces a rule from one part leaking into another.

**Splitting long parts**

-   Split the final sanitized HTML using the DOM, at top-level block boundaries. When the split point is inside a wrapper element, close it there and reopen a copy of it in the next part. Never split inside a paragraph, list item or table.
-   AO3's stored chapter HTML is **not** quite a fixed point of its own sanitizer: a second pass drops the newlines between block elements (visually identical; found by the parity tests in phase 1). So each split piece is checked against what AO3 produces when it re-sanitizes that piece, and the parity tests gain that property check.
-   Author-placed breaks come first: a new part in the parts list, or a break marker in the content. Automatic splitting is a fallback offered when a part nears the site's limit ("Chapter 3 is 96% of AO3's limit. Split it here?").
-   Splitting never changes the stylesheet, because class names depend on content, not on which part the content is in.

## Importing existing works

Import seeds the skin record from what is already posted, so an unchanged import round-trips byte for byte and nothing gets renamed.

1. **Paste the current stylesheet** (for AO3, the Work Skin from its edit page).
    - Rules that eo3 generated (`eo3-*`) hash to the same names and enter the skin record as posted.
    - Everything else becomes a locked "imported styles" module: kept verbatim and in order, never pruned automatically, editable by experienced users.
2. **Paste existing parts (optional).** AO3's stored chapter HTML is already sanitized, so it becomes a plain HTML source module for that part. Its class references also enter the skin record.
3. **Parts not imported stay protected.** Their classes are unknown, so imported rules are retained until the user prunes explicitly.

Because export emits the site's canonical form (rule 2 under Stable styling), the first export after an unchanged import produces an empty diff. The parity tests gain a property check that cleaning already-clean CSS changes nothing.

## User experience

Beginners and experienced users work on the same project; beginners see a simplified surface, and experienced users can open everything underneath it.

**Beginner surface**

-   A parts list shaped like AO3's chapter index or a document outline: add, reorder, rename, mark as posted. Labels come from the target (Chapter, Post, Page).
-   A shelf of packaged effects ("Text message thread", "Letter", "Chat log") with a few plain settings such as colours and names. Each is a group node.
-   Plain-language prompts instead of internals: "Your Work Skin changed: 2 styles added. Update it on AO3 before posting Chapter 4." with one copy button.
-   The existing per-target warnings (stripped tags, rejected CSS, size) shown per part.

**Power surface**

-   The full graph, always available. Groups share one definition, so fixes reach every use, and any instance can be detached into an independent copy to edit or remix; small single-purpose nodes remain the building blocks.
-   Managed but overridable: view the skin record, pin or rename a class, force-keep or prune a rule, override a setting for one part.
-   Target-aware nodes: a node can read the active target's capabilities and branch on them, e.g. use SVG backgrounds only where inline styles are the only option.
-   Crossposting: one work, several targets at once, each with its own outputs and warnings.
-   Custom target profiles: a declarative description of a new site (allowed tags and attributes, allowed CSS properties, delivery strategy, limits) drives a generic sanitizer, with no code needed.

**Why structure isn't made of nodes.** Wiring parts or the skin record as graph nodes would let one misplaced wire break a posted chapter, with the failure showing up later on the site. Keeping the whole-work rules in the app makes them impossible to break by accident, while the overrides above keep them adjustable.

## Interface changes

The changes extend `SiteTargetPlugin` and the document rather than replacing them; a single-output document becomes a work with one part.

**Document: a work with parts**

```ts
// src/document.ts
interface Part {
    id: string; // stable, never reused
    title: string;
    outputId: ModuleId; // this part's output node in the graph
    posted?: PostedSnapshot;
}

interface Work {
    parts: Part[]; // order = publication order
    workStyleIds: ModuleId[]; // CSS modules sent to every part
    skinRecord: SkinRecord; // per delivery strategy that needs it
}

interface PostedSnapshot {
    at: string; // ISO date
    htmlHash: string; // hash of the HTML the user copied
    classes: string[]; // eo3-* classes it references
}
```

Existing documents migrate to one part whose `outputId` is `MOD_OUTPUT`, through the versioned migrations in `src/storage/versions/`.

**Target: declared structure and delivery**

```ts
// src/targets/types.ts
type DeliveryStrategyId = 'shared-stylesheet' | 'inline' | 'embedded-style' | 'plain';

interface SiteTargetPlugin<Config> {
    // existing: id, title, initialConfig, renderFallback, previewCssScope,
    // PreviewHeader, previewSettings, configItems, outputMascot, exportActions
    part: { label: string; maxParts?: number; maxChars?: number };
    delivery: DeliveryStrategyId;
    export(input: WorkExportInput<Config>, pushError: PushError): WorkExportOutput;
}

interface WorkExportInput<Config> {
    parts: { id: string; title: string; source: string; html: string; css: string }[];
    workCss: string;
    skinRecord?: SkinRecord;
    config: Config;
}

interface WorkExportOutput {
    parts: Map<string, Map<string, string>>; // part id -> output id -> text
    shared: Map<string, string>; // e.g. 'css' -> the Work Skin
    skinRecord?: SkinRecord; // updated record, saved by the app
}
```

**Delivery strategies as modules**

```ts
// src/targets/delivery/shared-stylesheet.ts
export function buildSharedStylesheet(input: {
    parts: { id: string; html: string; partCss: string }[];
    workCss: string;
    record: SkinRecord;
    canonicalize: (css: string) => string; // AO3: cleanWorkskinCss(css, { prefix: '#workskin' })
}): { parts: Map<string, string>; stylesheet: string; record: SkinRecord; diff: SkinDiff };
```

`lift-styles.ts` moves here from `targets/ao3/render/`; the AO3 target keeps its sanitizer and passes its canonicalizer in. cohost's inlining (`targets/cohost/export.ts`) becomes `delivery/inline.ts`.

**Custom target profiles**

```ts
interface TargetProfile {
    id: string;
    title: string;
    part: { label: string; maxChars?: number };
    delivery: DeliveryStrategyId;
    elements: string[];
    attributes: Record<string, string[]>; // tag or 'all' -> allowed attributes
    protocols: Record<string, string[]>; // 'a.href' -> ['http', 'https']
    cssProperties?: string[]; // for strategies that keep CSS
}
```

A generic target built from a profile reuses the sanitize engine in `targets/ao3/render/sanitize.ts`, which is already driven by a config object.

## Rollout, testing and open questions

AO3 comes first: phases 1–4 complete multi-chapter AO3 support, and each phase is usable on its own. wafrn is last, after its sanitizer has been checked.

| Phase | Delivers                                                                                                                                    | Main risk                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1     | Canonical, sorted Work Skin; pinned-hash test; collision check                                                                              | None: output order changes once                  |
| 2     | `Work` and parts in the document; migration of saved documents; parts list UI; `export()` over a work                                       | Migration of existing saves                      |
| 3     | Delivery strategies extracted (`shared-stylesheet`, `inline`); skin record; diff before copy; part-scoped CSS; cross-part conflict warnings | Getting pruning rules right                      |
| 4     | Import of an existing skin, then of existing chapters                                                                                       | Canonical form must round-trip exactly           |
| 5     | Group nodes and a first shelf of packaged effects                                                                                           | Group editing UX                                 |
| 6     | Size-based splitting; custom target profiles; crossposting                                                                                  | Wrapper reopening edge cases                     |
| 7     | wafrn target, after checking which tags, attributes and CSS its sanitizer keeps                                                             | Sanitizer rules unknown until its source is read |

**Testing**

-   Keep the AO3 parity tests as the gate for the AO3 target, and add property checks: split pieces and already-clean CSS behave as AO3's pipeline does on a second pass.
-   For each new site with open-source sanitizer code, add a parity harness like `test/ao3-parity/` that runs its real code.
-   Unit-test each delivery strategy against a fixed multi-part work: stable names, sorted output, retention while posted, pruning only on request.

**Decisions**

-   **AO3 first.** Phases 1–4 aim at complete AO3 multi-chapter support. wafrn moves to the end (phase 7).
-   **Marking as posted is explicit, with warnings.** The user presses "Mark as posted". The app warns when a copied part hasn't been marked, and pruning lists copied-but-unmarked parts before removing any style.
-   **Group nodes are shared but detachable.** Every instance uses one shared definition, so fixes reach all uses; any instance can be detached into an independent copy.
-   **Per-part styles are auto-wired and detachable.** Each new part gets a managed "Part styles" CSS module in the graph, already wired to that part's output; the parts list's style box edits that module. Detaching hands it to the user to rewire freely. Managed style modules are collapsed under their part in the graph view; deleting a part deletes its managed module, and a detached module that no longer reaches any part gets a warning.
