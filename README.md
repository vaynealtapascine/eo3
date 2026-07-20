# eo3
A graph-based HTML generator to make fancy AO3 fics easier.
Built upon the work of cpsdqs on [prechoster](https://github.com/cpsdqs/prechoster). Eggbug forever!

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

### Building
in the repository:

```sh
npm install
npm run build # or npm run dev
```

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
