# AGENTS.md

Notes for anyone (human or AI) working on eo3. See README.md for what the app is, and
[PROGRESS.md](PROGRESS.md) for the work in flight. Design references live in
[docs/design/](docs/design/).

## Commands

```sh
npm run typecheck        # tsc --noEmit — the only type check; the build strips types unchecked
npm test                 # Vitest (jsdom): parity, document, target and UI logic tests
npm run build            # production build (Vite 8 / rolldown)
npm run test:ao3-update  # regenerate AO3 parity expectations (needs Ruby ≥ 3.2 + network)
npm run test:wafrn-update  # re-extract wafrn's sanitizer settings (needs network)
```

Run `typecheck` and `test` before committing; CI runs both plus the build on every push.

## Layout

-   `src/document.ts` — the module graph (modules, sends, evaluation) and the work's parts
    (chapters/posts), each with its own output; `evalWork()` evaluates them all.
-   `src/plugins/` — module plugins (sources and transforms), each lazy-loaded via `plugins/index.ts`.
-   `src/targets/` — site targets (`SiteTargetPlugin` in `types.ts`): how output is previewed and
    exported for a site. `ao3/` and `cohost/` are self-contained; `profile/` builds a target from
    a declarative site profile (custom sites, and `wafrn/`); `delivery/` holds the ways styles
    reach a site. Each target keeps its own explicit `ERRORS` registry on purpose — don't
    consolidate them.
-   `src/targets/ao3/render/` — a port of AO3's (otwarchive) chapter HTML sanitizer and Work Skin CSS
    validator. AO3 uses no Markdown. Preview and export both run it.
-   `test/ao3-parity/` — checks that port against AO3's real Ruby code; `test/wafrn-parity/` checks
    the wafrn target against wafrn's own sanitizer settings and `sanitize-html` version.

## AO3 parity tests

`generate.rb` downloads the otwarchive files the port mirrors, installs the gem versions from
otwarchive's `Gemfile.lock`, and runs every input in `cases.json` through the real
`HtmlCleaner#sanitize_value` and `WorkSkin#clean_css`, writing `expected.json`. `parity.test.ts`
compares the port's output against it.

-   **When you change anything in `src/targets/ao3/render/`**, add inputs covering it to
    `cases.json`, then run `npm run test:ao3-update -- --force` and `npm test`.
-   Never edit `expected.json` by hand; it is AO3's output, not ours.
-   Intentional differences live in `KNOWN_DIVERGENCES` in `parity.test.ts`, each with a reason.
    Inputs that crash AO3 itself are recorded as `raises` and skipped.
-   Without `--force`, the generator only rewrites `expected.json` when a tracked otwarchive file or
    gem version changed. The weekly `ao3-upstream` workflow uses this to open a PR when AO3 changes
    its sanitizer; its title says whether the port still passes.
-   Port regexes must keep Ruby semantics: `^`/`$` are line anchors (use the `m` flag), and CSS
    values are matched by the memoized grammar in `css-value.ts` because the single Ruby regex
    backtracks exponentially in JS.

## Conventions

-   Commit messages: conventional style (`feat(ao3): …`, `fix: …`, `test: …`) with a body saying
    why. Ignore the older `ADD:`/`FIX:` style in the history.
-   Don't modify `src/ui/examples*` for now; they come from upstream prechoster.
-   The `eo3-` class prefix is reserved for classes eo3 generates (lifted styles `eo3-<hash>`,
    part wrappers `eo3-part-<id>`). Authored or packaged CSS must use another prefix (effects use
    `fx-`).
-   Keep `@property` rules top-level with literal `initial-value`s (nested ones break CSS minify;
    `var()` makes the registration invalid).
-   Line endings: the repo uses `core.autocrlf`; check formatting with
    `npx prettier --check --end-of-line auto <files>` to avoid CRLF noise.
-   Never use `alert()`, `confirm()` or `prompt()`: some browsers and embedded views skip or
    throw on them. Use `showAlert`/`showConfirm` from `src/ui/dialogs.tsx` and `NamePopover`
    for names.
-   Don't change module data interfaces in a backwards-incompatible way; saved documents depend on
    them.
