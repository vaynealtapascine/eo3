import { Component, FunctionComponent } from 'react';
import { MODULES } from './plugins';
import type { GroupFile } from './storage/group-file';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

type DocEvalState = {
    steps: number;
    asyncCache: Map<ModuleId, Promise<Data>>;
    cache: Map<ModuleId, Data>;
    userData: Map<ModuleId, UserData>;
};

export type UserData = Record<string, unknown>;

export const MAX_EVAL_STEPS = 1024;
export const MAX_HISTORY_LEN = 300;
export const MOD_OUTPUT: ModuleId = 'output';

export enum ChangeType {
    Load = 'load',
    AddModule = 'add module',
    RemoveModule = 'remove module',
    UpdateModule = 'update module',
    RearrangeModules = 'rearrange modules',
    SetTitle = 'set title',
    EditParts = 'edit parts',
}

type HistoryChangeDesc =
    | {
          type: ChangeType.UpdateModule;
          module: ModuleId;
      }
    | {
          type: ChangeType.Load;
      }
    | {
          type: ChangeType.RemoveModule;
      }
    | {
          type: ChangeType.AddModule;
      }
    | {
          type: ChangeType.RearrangeModules;
      }
    | {
          type: ChangeType.SetTitle;
      }
    | {
          type: ChangeType.EditParts;
      };

const HISTORY_COALESION_TIME_MS = 5000;

function shouldCoalesceChanges(a: HistoryChangeDesc, b: HistoryChangeDesc) {
    if (a.type === ChangeType.UpdateModule && b.type === ChangeType.UpdateModule) {
        if (a.module === b.module) return true;
    }
    if (a.type === ChangeType.SetTitle && a.type === b.type) return true;
    return false;
}

interface HistoryEntry {
    state: DocumentState;
    desc: HistoryChangeDesc;
    time: number;
}

export interface DocumentState {
    title: string;
    titleInPost: boolean;
    modules: AnyModule[];
    /** The work's parts in publication order (chapters, posts, pages); never empty. */
    parts: Part[];
    /**
     * Per target id: canonical lifted rules saved when a part was marked posted there. Posting
     * state is kept per target so a work can be crossposted (AO3 and a custom site at once).
     */
    skinRecords: Record<string, Record<string, string>>;
    /** Managed CSS module for a pasted AO3 Work Skin, kept wired to newly added parts. */
    importedSkinModuleId: ModuleId | null;
    /** Per target id: imported generated classes kept for chapters not yet brought into eo3. */
    protectedSkinClasses: Record<string, string[]>;
    /** Per target id: the latest imported or marked-posted stylesheet, for the diff before copying. */
    skinBaselines: Record<string, string>;
    /** Modules the author grouped into one card in the graph. */
    groups: ModuleGroup[];
    /**
     * The "All chapters" styles module, wired to every new part. Undefined in works from before
     * it existed (ensureSharedStyles adds it); null once the author deletes it.
     */
    sharedStylesModuleId?: ModuleId | null;
}

/**
 * Modules shown as one card in the graph. The modules stay ordinary modules, wired as before;
 * a group only names them and keeps them together. Every group is independent.
 */
export interface ModuleGroup {
    id: string;
    title: string;
    moduleIds: ModuleId[];
}

/** One unit of the work: a chapter, a post in a thread, a page — whatever the target calls it. */
export interface Part {
    /** Stable and never reused, so renaming or reordering parts never changes what refers to them. */
    id: string;
    title: string;
    /** The pseudo-module modules send to for this part. The first part of a work keeps MOD_OUTPUT. */
    outputId: ModuleId;
    /** The managed "Part styles" module, or null when there is none (never made, or detached). */
    stylesModuleId: ModuleId | null;
    /** Per target id: set when the user marks the part as posted on that site. */
    postedTo: Record<string, PostedSnapshot>;
}

export interface PostedSnapshot {
    /** ISO date of marking. */
    at: string;
    /** `eo3-*` classes the posted HTML references; they must stay in the shared stylesheet. */
    classes: string[];
    /** fnv1a36 of the posted HTML, to tell when the part has changed since. */
    htmlHash: string;
    /** The complete Work Skin at marking time, for a change summary before the next copy. */
    skinCss?: string;
}

export function isPartOutput(id: ModuleId): boolean {
    return id === MOD_OUTPUT || id.startsWith(PART_OUTPUT_PREFIX);
}

const PART_OUTPUT_PREFIX = 'output:';

/** Text-module languages whose contents are HTML (and so can be split at block boundaries). */
const HTML_LANGUAGES = new Set(['html', 'html-contenteditable']);

/** Modules that produce CSS rather than content: CSS text, Sass and Less sources. */
/**
 * A module's generated name. For "All chapters" it counts the parts it reaches, so a chapter
 * unwired from it shows as "3 of 4 chapters".
 */
export function moduleDescription(doc: Document, module: AnyModule, partLabel: string): string {
    if (module.id !== doc.sharedStylesModuleId) return module.plugin.description(module.data);
    const plural = partLabel.toLowerCase() + 's';
    const reach = doc.sharedStylesReach().length;
    const total = doc.parts.length;
    return reach === total ? `All ${plural}` : `${reach} of ${total} ${plural}`;
}

/** Whether a module outputs CSS, judged from its settings (for before it has rendered). */
export function isCssModule(mod: AnyModule): boolean {
    if (['source.sass', 'source.lesscss', 'source.shared-styles'].includes(mod.plugin.id))
        return true;
    return (
        mod.plugin.id === 'source.text' &&
        (mod.data as { language?: unknown } | null)?.language === 'css'
    );
}

function newPart(outputId?: ModuleId): Part {
    const id = Module.genModuleId();
    return {
        id,
        title: '',
        outputId: outputId ?? PART_OUTPUT_PREFIX + id,
        stylesModuleId: null,
        postedTo: {},
    };
}

/** What evaluating the whole work produces, before any target packages it. */
export interface WorkOutput {
    parts: PartOutput[];
    /** CSS from modules that reach every part, in module order. */
    workCss: string;
    /** Each CSS module and the parts it reaches, in module order. */
    cssSources: CssSourceOutput[];
    /** Posting state per target id; see DocumentState. */
    skinRecords: Record<string, Record<string, string>>;
    protectedSkinClasses: Record<string, string[]>;
    skinBaselines: Record<string, string>;
}

export interface CssSourceOutput {
    id: ModuleId;
    css: string;
    partIds: string[];
}

export interface PartOutput {
    id: string;
    title: string;
    /** Content (HTML) sent to this part, joined in module order. */
    content: string;
    /** CSS that reaches this part but not every part, in module order. */
    css: string;
    postedTo: Record<string, PostedSnapshot>;
}

export class Document extends EventTarget {
    history: HistoryEntry[] = [
        {
            state: {
                title: '',
                titleInPost: false,
                modules: [],
                parts: [newPart(MOD_OUTPUT)],
                skinRecords: {},
                importedSkinModuleId: null,
                protectedSkinClasses: {},
                skinBaselines: {},
                groups: [],
            },
            desc: { type: ChangeType.Load },
            time: Date.now(),
        },
    ];
    historyCursor = 0;

    /** Sets the initial state; a state without parts (older files) gets one part on MOD_OUTPUT. */
    init(
        state: Omit<
            DocumentState,
            | 'parts'
            | 'skinRecords'
            | 'importedSkinModuleId'
            | 'protectedSkinClasses'
            | 'skinBaselines'
            | 'groups'
        > & {
            parts?: Part[];
            skinRecords?: Record<string, Record<string, string>>;
            importedSkinModuleId?: ModuleId | null;
            protectedSkinClasses?: Record<string, string[]>;
            skinBaselines?: Record<string, string>;
            groups?: ModuleGroup[];
            sharedStylesModuleId?: ModuleId | null;
        }
    ) {
        if (this.history.length > 1) throw new Error('cannot init in this state');
        this.history[0].state = {
            ...state,
            parts: state.parts?.length ? state.parts : [newPart(MOD_OUTPUT)],
            skinRecords: state.skinRecords ?? {},
            importedSkinModuleId: state.importedSkinModuleId ?? null,
            protectedSkinClasses: state.protectedSkinClasses ?? {},
            skinBaselines: state.skinBaselines ?? {},
            groups: state.groups ?? [],
        };
    }

    get state(): Readonly<DocumentState> {
        return this.history[this.historyCursor].state;
    }

    get title(): string {
        return this.state.title;
    }

    get titleInPost(): boolean {
        return this.state.titleInPost;
    }

    get modules(): Readonly<AnyModule[]> {
        return this.state.modules;
    }

    get parts(): Readonly<Part[]> {
        return this.state.parts;
    }

    /** Lifted rules recorded when parts were marked posted on `targetId`. */
    skinRecordFor(targetId: string): Readonly<Record<string, string>> {
        return this.state.skinRecords[targetId] ?? {};
    }

    get importedSkinModuleId(): ModuleId | null {
        return this.state.importedSkinModuleId;
    }

    /** Imported generated classes kept on `targetId` for chapters not brought into eo3. */
    protectedClassesFor(targetId: string): Readonly<string[]> {
        return this.state.protectedSkinClasses[targetId] ?? [];
    }

    /** The stylesheet last imported or marked posted on `targetId`, for the diff before copying. */
    skinBaselineFor(targetId: string): string | null {
        return this.state.skinBaselines[targetId] ?? null;
    }

    get groups(): Readonly<ModuleGroup[]> {
        return this.state.groups;
    }

    findGroup(id: string) {
        return this.groups.find((group) => group.id === id);
    }

    get sharedStylesModuleId(): ModuleId | null {
        return this.state.sharedStylesModuleId ?? null;
    }

    /** The parts the "All chapters" module is wired to, in part order. */
    sharedStylesReach(): Part[] {
        const module = this.sharedStylesModuleId && this.findModule(this.sharedStylesModuleId);
        return module ? this.parts.filter((part) => module.sends.includes(part.outputId)) : [];
    }

    /**
     * Adds the "All chapters" module to a work that predates it, wired to every part, without
     * an undo step: it's part of opening the work. Existing links are left alone.
     */
    async ensureSharedStyles() {
        if (this.state.sharedStylesModuleId !== undefined) return;
        const plugin = await MODULES['source.shared-styles'].load();
        if (this.state.sharedStylesModuleId !== undefined) return;
        const module = new Module(plugin, plugin.initialData());
        module.sends = this.parts.map((part) => part.outputId);
        const entry = this.history[this.historyCursor];
        entry.state = {
            ...entry.state,
            modules: [...entry.state.modules, module],
            sharedStylesModuleId: module.id,
        };
        this.emitChange();
    }

    findPart(id: string) {
        return this.parts.find((part) => part.id === id);
    }

    get canUndo() {
        return this.historyCursor > 0;
    }

    get canRedo() {
        return this.historyCursor < this.history.length - 1;
    }

    undo() {
        if (this.canUndo) {
            this.historyCursor--;
            this.emitChange();
        }
    }

    redo() {
        if (this.canRedo) {
            this.historyCursor++;
            this.emitChange();
        }
    }

    pushHistoryState(state: DocumentState, desc: HistoryChangeDesc) {
        this.history.splice(this.historyCursor + 1);
        while (this.history.length > MAX_HISTORY_LEN) {
            this.history.shift();
            this.historyCursor--;
        }

        const lastItem = this.history[this.history.length - 1];
        const newItem: HistoryEntry = {
            state,
            desc,
            time: Date.now(),
        };
        if (
            lastItem &&
            shouldCoalesceChanges(lastItem.desc, newItem.desc) &&
            lastItem.time > Date.now() - HISTORY_COALESION_TIME_MS
        ) {
            newItem.time = lastItem.time;
            this.history[this.history.length - 1] = newItem;
        } else {
            this.history.push(newItem);
            this.historyCursor++;
        }

        this.emitChange();
    }

    pushModulesState(modules: AnyModule[], desc: HistoryChangeDesc) {
        return this.pushHistoryState({ ...this.state, modules }, desc);
    }

    emitChange() {
        this.dispatchEvent(new CustomEvent('change'));
    }

    beginBatch(): { end: () => void } {
        const pos = this.historyCursor;
        return {
            end: () => {
                if (this.historyCursor <= pos) return;
                this.history[pos] = this.history[this.historyCursor];
                this.history.splice(pos, this.historyCursor - pos);
                this.historyCursor = pos;
            },
        };
    }

    insertModule(module: AnyModule) {
        const index = this.modules.findIndex((m) => m.id === module.id);
        if (index === -1) {
            this.pushModulesState(this.modules.concat([module]), { type: ChangeType.AddModule });
            return;
        } else {
            const newModules = this.modules.slice();
            newModules[index] = module;
            this.pushModulesState(newModules, {
                type: ChangeType.UpdateModule,
                module: module.id,
            });
        }
    }

    removeModule(moduleId: ModuleId) {
        const modules = this.modules.slice();
        const index = modules.findIndex((module) => module.id === moduleId);
        if (index === -1) return;

        modules.splice(index, 1);
        const parts = this.parts.map((part) =>
            part.stylesModuleId === moduleId ? { ...part, stylesModuleId: null } : part
        );

        for (let i = 0; i < modules.length; i++) {
            if (modules[i].sends.includes(moduleId) || modules[i].namedSends.has(moduleId)) {
                modules[i] = modules[i].shallowClone();
                if (modules[i].sends.includes(moduleId)) {
                    modules[i].sends = modules[i].sends.slice();
                    modules[i].sends.splice(modules[i].sends.indexOf(moduleId), 1);
                }
                modules[i].namedSends = new Map(modules[i].namedSends);
                modules[i].namedSends.delete(moduleId);
            }
        }

        this.pushHistoryState(
            {
                ...this.state,
                modules,
                parts,
                importedSkinModuleId:
                    this.importedSkinModuleId === moduleId ? null : this.importedSkinModuleId,
                ...(this.sharedStylesModuleId === moduleId ? { sharedStylesModuleId: null } : {}),
                // A group of one is just a module again.
                groups: this.groups
                    .map((group) => ({
                        ...group,
                        moduleIds: group.moduleIds.filter((id) => id !== moduleId),
                    }))
                    .filter((group) => group.moduleIds.length > 1),
            },
            { type: ChangeType.RemoveModule }
        );
    }

    private pushParts(parts: Part[], modules = this.modules as AnyModule[]) {
        this.pushHistoryState({ ...this.state, modules, parts }, { type: ChangeType.EditParts });
    }

    /** Whether these modules can become a group: two or more, none already in a group. */
    canGroup(moduleIds: ModuleId[]): boolean {
        const ids = new Set(moduleIds);
        if (ids.size < 2 || ids.size !== moduleIds.length) return false;
        if (moduleIds.some((id) => !this.findModule(id))) return false;
        return !this.groups.some((group) => group.moduleIds.some((id) => ids.has(id)));
    }

    /**
     * Groups modules into one card, keeping their layout: each member without a saved graph
     * position gets its current one from `positions`. One undo step.
     */
    createGroup(
        title: string,
        moduleIds: ModuleId[],
        positions: ReadonlyMap<ModuleId, { x: number; y: number }> = new Map()
    ): ModuleGroup | null {
        if (!this.canGroup(moduleIds)) return null;
        const members = new Set(moduleIds);
        const group: ModuleGroup = { id: Module.genModuleId(), title, moduleIds };
        const modules = this.modules.map((mod) => {
            const position = positions.get(mod.id);
            if (!members.has(mod.id) || mod.graphPos || !position) return mod;
            const pinned = mod.shallowClone();
            pinned.graphPos = { ...position };
            return pinned;
        });
        this.pushHistoryState(
            { ...this.state, modules, groups: [...this.groups, group] },
            { type: ChangeType.EditParts }
        );
        return group;
    }

    renameGroup(id: string, title: string) {
        this.pushHistoryState(
            {
                ...this.state,
                groups: this.groups.map((group) => (group.id === id ? { ...group, title } : group)),
            },
            { type: ChangeType.EditParts }
        );
    }

    /** Dissolves a group; its modules stay where they are, wired as they were. */
    ungroup(id: string) {
        this.pushHistoryState(
            { ...this.state, groups: this.groups.filter((group) => group.id !== id) },
            { type: ChangeType.EditParts }
        );
    }

    /** A group as a file: its modules, their links to each other, and their layout. */
    groupFile(id: string): GroupFile | null {
        const group = this.findGroup(id);
        if (!group) return null;
        const members = group.moduleIds.map((mid) => this.findModule(mid)!);
        const index = new Map(group.moduleIds.map((mid, i) => [mid, i]));
        const placed = members.filter((mod) => mod.graphPos);
        const left = Math.min(...placed.map((mod) => mod.graphPos!.x));
        const top = Math.min(...placed.map((mod) => mod.graphPos!.y));
        return {
            eo3: 'group',
            version: 1,
            title: group.title,
            modules: members.map((mod) => {
                const sends = mod.sends.filter((t) => index.has(t)).map((t) => index.get(t)!);
                const namedSends = [...mod.namedSends].filter(([t]) => index.has(t));
                return {
                    plugin: mod.plugin.id,
                    data: structuredClone(mod.data),
                    ...(mod.title ? { title: mod.title } : {}),
                    ...(sends.length ? { sends } : {}),
                    ...(namedSends.length
                        ? {
                              namedSends: Object.fromEntries(
                                  namedSends.map(([t, names]) => [index.get(t)!, [...names]])
                              ),
                          }
                        : {}),
                    ...(mod.graphPos
                        ? {
                              position: [mod.graphPos.x - left, mod.graphPos.y - top] as [
                                  number,
                                  number
                              ],
                          }
                        : {}),
                };
            }),
        };
    }

    /**
     * Adds a group from a file as new, unwired modules; with `at`, laid out from that graph
     * position. One undo step. Throws when a module type isn't available in this eo3.
     */
    async insertGroupFile(file: GroupFile, at?: { x: number; y: number }): Promise<ModuleGroup> {
        const missing = file.modules.filter((mod) => !MODULES[mod.plugin]);
        if (missing.length) {
            throw new Error(
                `This group uses a module type this version of eo3 doesn’t have: ${missing
                    .map((mod) => mod.plugin)
                    .join(', ')}`
            );
        }
        const plugins = await Promise.all(file.modules.map((mod) => MODULES[mod.plugin].load()));
        const modules = file.modules.map((entry, i) => {
            const mod = new Module(plugins[i], structuredClone(entry.data));
            mod.title = entry.title ?? '';
            if (at && entry.position) {
                mod.graphPos = { x: at.x + entry.position[0], y: at.y + entry.position[1] };
            }
            return mod;
        });
        file.modules.forEach((entry, i) => {
            modules[i].sends = (entry.sends ?? []).map((t) => modules[t].id);
            modules[i].namedSends = new Map(
                Object.entries(entry.namedSends ?? {}).map(([t, names]) => [
                    modules[+t].id,
                    new Set(names),
                ])
            );
        });
        const group: ModuleGroup = {
            id: Module.genModuleId(),
            title: file.title,
            moduleIds: modules.map((mod) => mod.id),
        };
        this.pushHistoryState(
            {
                ...this.state,
                modules: [...this.modules, ...modules],
                groups: modules.length > 1 ? [...this.groups, group] : [...this.groups],
            },
            { type: ChangeType.EditParts }
        );
        return group;
    }

    /** Wires "All chapters" and the imported Work Skin to a new part. */
    private modulesWiredToNewPart(outputId: ModuleId): AnyModule[] {
        const shared = [this.importedSkinModuleId, this.sharedStylesModuleId];
        return this.modules.map((mod) => {
            if (!shared.includes(mod.id) || mod.sends.includes(outputId)) return mod;
            const copy = mod.shallowClone();
            copy.sends = [...mod.sends, outputId];
            return copy;
        });
    }

    /** Adds an empty part at the end (or at `index`) and returns it. */
    addPart(title = '', index = this.parts.length): Part {
        const part = { ...newPart(), title };
        const parts = this.parts.slice();
        parts.splice(index, 0, part);
        this.pushParts(parts, this.modulesWiredToNewPart(part.outputId));
        return part;
    }

    /**
     * The module holding a part's content, when the part can be split in place: exactly one
     * module sends content (anything but CSS) to the part, and it is a Text module holding HTML.
     * Otherwise, why not.
     */
    splittableContent(partId: string): { module: AnyModule } | { reason: string } {
        const part = this.findPart(partId);
        if (!part) return { reason: 'That part no longer exists.' };
        const content = this.modules.filter(
            (mod) => mod.sends.includes(part.outputId) && !isCssModule(mod)
        );
        if (content.length !== 1) {
            return {
                reason:
                    'Its content comes from several modules, so it can’t be split automatically. ' +
                    'Add a new part and move some of the content there.',
            };
        }
        const [mod] = content;
        if (mod.sends.length !== 1 || mod.sends[0] !== part.outputId || mod.namedSends.size) {
            return {
                reason: 'This text is also sent elsewhere. Make a separate copy before splitting it.',
            };
        }
        if (this.groups.some((group) => group.moduleIds.includes(mod.id))) {
            return { reason: 'This text belongs to a group. Ungroup it before splitting.' };
        }
        const language = (mod.data as { language?: unknown } | null)?.language;
        if (mod.plugin.id !== 'source.text' || !HTML_LANGUAGES.has(language as string)) {
            return {
                reason:
                    'Its content is produced by other modules, so it can’t be split ' +
                    'automatically. Add a new part and move some of the content there.',
            };
        }
        return { module: mod };
    }

    /**
     * Splits a part in two at an already chosen point: its content module keeps `first`, and a
     * new part right after it gets a copy of that module holding `second`. Everything else sent
     * to the part (its styles, the Work Skin) is sent to the new part too. One undo step.
     */
    splitPart(partId: string, first: string, second: string): Part | null {
        const found = this.splittableContent(partId);
        const part = this.findPart(partId);
        if (!('module' in found) || !part) return null;
        const added = { ...newPart(), title: part.title ? `${part.title} (continued)` : '' };

        const continued = new Module(found.module.plugin, {
            ...(found.module.data as object),
            contents: second,
        } as JsonValue);
        continued.title = found.module.title;
        continued.sends = [added.outputId];

        const modules = this.modules.map((mod) => {
            if (mod.id === found.module.id) {
                const clone = mod.shallowClone();
                clone.data = { ...(mod.data as object), contents: first } as JsonValue;
                return clone;
            }
            if (!mod.sends.includes(part.outputId)) return mod;
            const clone = mod.shallowClone();
            clone.sends = [...mod.sends, added.outputId];
            return clone;
        });
        const parts = this.parts.slice();
        parts.splice(parts.indexOf(part) + 1, 0, added);
        this.pushHistoryState(
            { ...this.state, modules: [...modules, continued], parts },
            { type: ChangeType.EditParts }
        );
        return added;
    }

    /** Adds a part at the end with a rich-text module wired to it, as one undoable step. */
    async addPartWithText(contentTitle: string): Promise<Part> {
        const plugin = await MODULES['source.text'].load();
        const part = newPart();
        const module = new Module(plugin, { contents: '', language: 'html-contenteditable' });
        module.title = contentTitle;
        module.sends = [part.outputId];
        this.pushHistoryState(
            {
                ...this.state,
                modules: [...this.modulesWiredToNewPart(part.outputId), module],
                parts: [...this.parts, part],
            },
            { type: ChangeType.EditParts }
        );
        return part;
    }

    /** Add or replace the managed imported Work Skin as one undoable CSS module edit. */
    async importWorkSkin(
        targetId: string,
        css: string,
        canonicalCss: string,
        liftedRules: Record<string, string>
    ): Promise<ModuleId> {
        const plugin = await MODULES['source.text'].load();
        const existing = this.modules.find((mod) => mod.id === this.importedSkinModuleId);
        let module: AnyModule;
        let modules: AnyModule[];
        if (existing?.plugin.id === 'source.text') {
            module = existing.shallowClone();
            module.data = { contents: css, language: 'css' };
            module.sends = this.parts.map((part) => part.outputId);
            modules = this.modules.map((mod) => (mod.id === existing.id ? module : mod));
        } else {
            module = new Module(plugin, { contents: css, language: 'css' });
            module.title = 'Imported AO3 Work Skin';
            module.sends = this.parts.map((part) => part.outputId);
            modules = [...this.modules, module];
        }
        this.pushHistoryState(
            {
                ...this.state,
                modules,
                importedSkinModuleId: module.id,
                protectedSkinClasses: {
                    ...this.state.protectedSkinClasses,
                    [targetId]: Object.keys(liftedRules),
                },
                skinRecords: {
                    ...this.state.skinRecords,
                    [targetId]: { ...this.skinRecordFor(targetId), ...liftedRules },
                },
                skinBaselines: { ...this.state.skinBaselines, [targetId]: canonicalCss },
            },
            { type: ChangeType.EditParts }
        );
        return module.id;
    }

    /** Import pasted chapter HTML without running it through the editor or target sanitizer. */
    async importChapter(title: string, html: string): Promise<Part> {
        const plugin = await MODULES['source.text'].load();
        const first = this.parts[0];
        const reuseFirst =
            this.parts.length === 1 &&
            !first.title &&
            !Object.keys(first.postedTo).length &&
            this.modules.every(
                (mod) => mod.id === this.importedSkinModuleId || !mod.sends.includes(first.outputId)
            );
        const part = reuseFirst ? { ...first, title } : { ...newPart(), title };
        const module = new Module(plugin, { contents: html, language: 'html' });
        module.title = title || 'Imported AO3 chapter';
        module.sends = [part.outputId];
        this.pushHistoryState(
            {
                ...this.state,
                parts: reuseFirst ? [part] : [...this.parts, part],
                modules: [...this.modulesWiredToNewPart(part.outputId), module],
            },
            { type: ChangeType.EditParts }
        );
        return part;
    }

    /**
     * Returns the part's managed "Part styles" CSS module, creating it (wired to the part) the
     * first time it's asked for. Detaching it (`updatePart(id, { stylesModuleId: null })`) leaves
     * the module and its wiring to the user; a new one is made on the next request.
     */
    async partStyles(partId: string, title: string): Promise<ModuleId | null> {
        const existing = this.findPart(partId)?.stylesModuleId;
        if (existing) return existing;
        const plugin = await MODULES['source.text'].load();
        const part = this.findPart(partId);
        if (!part) return null;
        const module = new Module(plugin, { contents: '', language: 'css' });
        module.title = title;
        module.sends = [part.outputId];
        this.pushHistoryState(
            {
                ...this.state,
                modules: [...this.modules, module],
                parts: this.parts.map((p) =>
                    p.id === partId ? { ...p, stylesModuleId: module.id } : p
                ),
            },
            { type: ChangeType.EditParts }
        );
        return module.id;
    }

    updatePart(id: string, changes: Partial<Omit<Part, 'id' | 'outputId'>>) {
        this.pushParts(this.parts.map((part) => (part.id === id ? { ...part, ...changes } : part)));
    }

    /**
     * Mark a part posted on `targetId` (or unmark it with null) and save its lifted rules there,
     * in one undoable change.
     */
    setPartPosted(
        targetId: string,
        id: string,
        posted: PostedSnapshot | null,
        skinRules: Record<string, string> = {}
    ) {
        if (!this.findPart(id)) return;
        const parts = this.parts.map((part) => {
            if (part.id !== id) return part;
            const others = { ...part.postedTo };
            delete others[targetId];
            return { ...part, postedTo: posted ? { ...others, [targetId]: posted } : others };
        });
        const baseline = posted?.skinCss ?? this.skinBaselineFor(targetId);
        this.pushHistoryState(
            {
                ...this.state,
                parts,
                skinRecords: {
                    ...this.state.skinRecords,
                    [targetId]: { ...this.skinRecordFor(targetId), ...skinRules },
                },
                skinBaselines:
                    baseline === null
                        ? this.state.skinBaselines
                        : { ...this.state.skinBaselines, [targetId]: baseline },
            },
            { type: ChangeType.EditParts }
        );
    }

    /** Remove one retired site's marks and style history from this work, in one undo step. */
    forgetTargetPostingState(targetId: string) {
        const omit = <T>(record: Record<string, T>): Record<string, T> =>
            Object.fromEntries(Object.entries(record).filter(([id]) => id !== targetId));
        const parts = this.parts.map((part) => ({
            ...part,
            postedTo: omit(part.postedTo),
        }));
        if (
            !this.parts.some((part) => targetId in part.postedTo) &&
            !(targetId in this.state.skinRecords) &&
            !(targetId in this.state.skinBaselines) &&
            !(targetId in this.state.protectedSkinClasses)
        )
            return;
        this.pushHistoryState(
            {
                ...this.state,
                parts,
                skinRecords: omit(this.state.skinRecords),
                skinBaselines: omit(this.state.skinBaselines),
                protectedSkinClasses: omit(this.state.protectedSkinClasses),
            },
            { type: ChangeType.EditParts }
        );
    }

    /** Classes the parts posted on `targetId` reference. */
    private postedClasses(targetId: string): Set<string> {
        return new Set(this.parts.flatMap((part) => part.postedTo[targetId]?.classes ?? []));
    }

    /** Drop recorded rules no posted part references; currently authored rules export as usual. */
    cleanupUnusedSkinRules(targetId: string) {
        const referenced = new Set([
            ...this.postedClasses(targetId),
            ...this.protectedClassesFor(targetId),
        ]);
        const record = this.skinRecordFor(targetId);
        const kept = Object.fromEntries(
            Object.entries(record).filter(([name]) => referenced.has(name))
        );
        if (Object.keys(kept).length === Object.keys(record).length) return;
        this.pushHistoryState(
            { ...this.state, skinRecords: { ...this.state.skinRecords, [targetId]: kept } },
            { type: ChangeType.EditParts }
        );
    }

    /** Explicitly prune imported generated rules after the user has reviewed their text. */
    pruneImportedSkinRules(targetId: string, names: string[], updatedCss: string) {
        const protectedNow = this.protectedClassesFor(targetId);
        const selected = new Set(names.filter((name) => protectedNow.includes(name)));
        if (!selected.size) return;
        const module = this.modules.find((mod) => mod.id === this.importedSkinModuleId);
        const modules = this.modules.map((mod) => {
            if (mod !== module) return mod;
            const copy = mod.shallowClone();
            copy.data = { contents: updatedCss, language: 'css' };
            return copy;
        });
        const posted = this.postedClasses(targetId);
        const record = Object.fromEntries(
            Object.entries(this.skinRecordFor(targetId)).filter(
                ([name]) => !selected.has(name) || posted.has(name)
            )
        );
        this.pushHistoryState(
            {
                ...this.state,
                modules,
                skinRecords: { ...this.state.skinRecords, [targetId]: record },
                protectedSkinClasses: {
                    ...this.state.protectedSkinClasses,
                    [targetId]: protectedNow.filter((name) => !selected.has(name)),
                },
            },
            { type: ChangeType.EditParts }
        );
    }

    movePart(id: string, index: number) {
        const parts = this.parts.slice();
        const from = parts.findIndex((part) => part.id === id);
        if (from === -1) return;
        const [part] = parts.splice(from, 1);
        parts.splice(Math.max(0, Math.min(index, parts.length)), 0, part);
        this.pushParts(parts);
    }

    /**
     * Removes a part and every send to its output. Its managed styles module is removed too;
     * a detached one is left alone. The last part can't be removed.
     */
    removePart(id: string) {
        const part = this.findPart(id);
        if (!part || this.parts.length <= 1) return;
        const modules = this.modules
            .filter((mod) => mod.id !== part.stylesModuleId)
            .map((mod) => {
                if (!mod.sends.includes(part.outputId)) return mod;
                const clone = mod.shallowClone();
                clone.sends = mod.sends.filter((target) => target !== part.outputId);
                return clone;
            });
        this.pushHistoryState(
            {
                ...this.state,
                parts: this.parts.filter((p) => p.id !== id),
                modules,
            },
            { type: ChangeType.EditParts }
        );
    }

    setTitle(title: string) {
        this.pushHistoryState(
            {
                ...this.state,
                title,
            },
            { type: ChangeType.SetTitle }
        );
    }

    /** Lazily evaluates the output of the given module. */
    cacheEvalModule<T extends JsonValue>(mod: Module<T>, state: DocEvalState) {
        if (!state.asyncCache.has(mod.id)) {
            if (++state.steps > MAX_EVAL_STEPS) throw new Error('exceeded max eval step limit');

            const { inputs, namedInputs } = this.evalModuleInputs(mod.id, state);
            state.asyncCache.set(
                mod.id,
                (async () => {
                    const resInputs = await Promise.all(inputs);
                    const resNamedInputs = new Map();
                    for (const [k, v] of namedInputs) {
                        resNamedInputs.set(k, await v);
                    }

                    try {
                        const options: EvalOptions = {
                            userData: {},
                        };
                        const output = await mod.plugin.eval(
                            mod.data,
                            resInputs,
                            resNamedInputs,
                            options
                        );
                        state.cache.set(mod.id, output);
                        state.userData.set(mod.id, options.userData);
                        return output;
                    } catch (err) {
                        throw new ModuleError(err, mod.id);
                    }
                })()
            );
        }
        return state.asyncCache.get(mod.id)!;
    }

    findModule(id: ModuleId) {
        return this.modules.find((mod) => mod.id === id);
    }

    findModuleInputIds(id: ModuleId) {
        const inputs = [];
        const namedInputs = new Map();
        for (const mod of this.modules) {
            if (mod.sends.includes(id)) {
                inputs.push(mod.id);
            }
            const names = mod.namedSends.get(id);
            if (names) {
                for (const name of names) {
                    namedInputs.set(name, mod.id);
                }
            }
        }
        return { inputs, namedInputs };
    }

    /** Evaluates all inputs for a given module ID. */
    evalModuleInputs(id: ModuleId, state: DocEvalState) {
        const inputs = [];
        const namedInputs = new Map();
        for (const mod of this.modules) {
            for (const item of mod.sends) {
                if (item === id) {
                    inputs.push(this.cacheEvalModule(mod, state));
                }
            }
            const names = mod.namedSends.get(id);
            if (names) {
                for (const name of names) {
                    namedInputs.set(name, this.cacheEvalModule(mod, state));
                }
            }
        }
        return { inputs, namedInputs };
    }

    wantsDebounce(): boolean {
        for (const mod of this.modules) if (mod.plugin.wantsDebounce) return true;
        return false;
    }

    /**
     * Evaluates every part with one shared cache, so a module sent to several parts runs once.
     * CSS is split by reach: a module whose CSS reaches every part is work CSS, the rest belongs to
     * the parts it reaches. Content and CSS keep module order.
     */
    async evalWork(): Promise<{
        work: WorkOutput;
        nodes: Map<ModuleId, Data>;
        userData: Map<ModuleId, UserData>;
    }> {
        const state: DocEvalState = {
            steps: 0,
            asyncCache: new Map(),
            cache: new Map(),
            userData: new Map(),
        };
        const pending = this.parts.map((part) =>
            this.modules.flatMap((mod) =>
                mod.sends
                    .filter((target) => target === part.outputId)
                    .map(() => ({ source: mod.id, data: this.cacheEvalModule(mod, state) }))
            )
        );
        const resolved = await Promise.all(
            pending.map((inputs) =>
                Promise.all(inputs.map(async ({ source, data }) => ({ source, data: await data })))
            )
        );

        const cssBySource = new Map<ModuleId, string>();
        const partsReached = new Map<ModuleId, Set<string>>();
        const contents = resolved.map((inputs, partIndex) => {
            const contentParts: string[] = [];
            const cssSources = new Set<ModuleId>();
            inputs.forEach(({ source, data }, i) => {
                const cssData = data.into(CssData);
                if (cssData && !cssData.contents.trim()) return;
                if (cssData) {
                    cssBySource.set(source, cssData.contents);
                    cssSources.add(source);
                    return;
                }
                const output = data.asMdOutput();
                if (output === null) {
                    const where = this.parts.length > 1 ? `, part ${partIndex + 1}` : '';
                    throw new Error(
                        'output received data type that could not be converted to markdown: ' +
                            data.constructor.name +
                            ` (item ${i + 1}${where})`
                    );
                }
                contentParts.push(output);
            });
            for (const source of cssSources) {
                const reached = partsReached.get(source) ?? new Set<string>();
                reached.add(this.parts[partIndex].id);
                partsReached.set(source, reached);
            }
            return { content: contentParts.join('\n'), cssSources };
        });

        const inModuleOrder = (sources: Set<ModuleId>) =>
            this.modules
                .filter((mod) => sources.has(mod.id))
                .map((mod) => cssBySource.get(mod.id)!)
                .join('\n');
        const workSources = new Set(
            [...partsReached]
                .filter(([, reached]) => reached.size === this.parts.length)
                .map(([id]) => id)
        );

        return {
            work: {
                workCss: inModuleOrder(workSources),
                skinRecords: this.state.skinRecords,
                protectedSkinClasses: this.state.protectedSkinClasses,
                skinBaselines: this.state.skinBaselines,
                cssSources: this.modules
                    .filter((mod) => partsReached.has(mod.id))
                    .map((mod) => ({
                        id: mod.id,
                        css: cssBySource.get(mod.id)!,
                        partIds: this.parts
                            .filter((part) => partsReached.get(mod.id)!.has(part.id))
                            .map((part) => part.id),
                    })),
                parts: this.parts.map((part, i) => ({
                    id: part.id,
                    title: part.title,
                    content: contents[i].content,
                    css: inModuleOrder(
                        new Set([...contents[i].cssSources].filter((id) => !workSources.has(id)))
                    ),
                    postedTo: part.postedTo,
                })),
            },
            nodes: state.cache,
            userData: state.userData,
        };
    }

    async eval(target: ModuleId | null): Promise<RenderOutput | RenderError> {
        try {
            let nodes = new Map();
            let userData = new Map();
            let work: WorkOutput | null = null;
            if (!target) {
                const output = await this.evalWork();
                work = output.work;
                nodes = output.nodes;
                userData = output.userData;
            } else {
                const module = this.findModule(target);
                if (!module) throw new Error('Invalid render target: module not found');
                await this.cacheEvalModule(module, {
                    steps: 0,
                    asyncCache: new Map(),
                    cache: nodes,
                    userData,
                });
            }

            return {
                type: 'output',
                target,
                outputs: nodes,
                work,
                userData,
                drop() {
                    for (const data of this.outputs.values()) data.drop();
                },
            } as RenderOutput;
        } catch (err) {
            if (err instanceof ModuleError) {
                console.error(err.error);
                return {
                    type: 'error',
                    target,
                    source: err.source,
                    error: err.error,
                };
            } else {
                console.error(err);
                return {
                    type: 'error',
                    target,
                    source: null,
                    error: err,
                };
            }
        }
    }

    async resolveUnloaded() {
        for (const module of this.modules) {
            if (module.plugin instanceof UnloadedPlugin) {
                if (MODULES[module.plugin.id]) {
                    module.plugin = await MODULES[module.plugin.id].load();
                } else {
                    throw new Error(`Unknown plugin ${module.plugin.id}`);
                }
            }
        }
    }

    loadFrom(doc: Document) {
        this.pushHistoryState(doc.state, { type: ChangeType.Load });
    }
}

class ModuleError extends Error {
    error: unknown;
    source: ModuleId;

    constructor(error: unknown, source: ModuleId) {
        super((error as any).toString());
        this.error = error;
        this.source = source;
        this.name = 'ModuleError';
    }
}

/** The render output target. null means output. */
export type RenderTarget = ModuleId | null;

export interface RenderState {
    /** Unique render ID */
    id: string;
    /** Current render target. */
    target: RenderTarget;
    /** If true, we are currently rendering. */
    rendering: boolean;
    /** If true, we should render live. */
    live: boolean;
    /** Last render output */
    output: RenderOutput | null;
    /** Last render error. */
    error: RenderError | null;
}

export interface RenderOutput {
    type: 'output';
    /** The render target this was rendered for */
    target: ModuleId | null;
    /** Every module’s output */
    outputs: Map<ModuleId, Data>;
    /** Every part's content and CSS, if the render target is the output. */
    work: WorkOutput | null;
    /** Evaluated module user data */
    userData: Map<ModuleId, UserData>;

    /** Drops all resources allocated by the render output */
    drop(): void;
}

export interface RenderError {
    type: 'error';
    /** The render target this error was produced for, if any. */
    target?: ModuleId | null;
    source: ModuleId | null;
    error: unknown;
}

export class Module<T extends JsonValue> {
    /** The module ID; used to refer to this module from elsewhere. */
    id: ModuleId = Module.genModuleId();
    /** The data for this module plugin. */
    data: T;
    /** The plugin that's handling this module. */
    plugin: ModulePlugin<T>;
    /** Specifies where the module data will be sent. */
    sends: ModuleId[] = [];
    /** Specifies where the module data will be sent as a named input. */
    namedSends: NamedSends = new Map();
    /** Manually set location in the graph */
    graphPos: { x: number; y: number } | null = null;
    /** Customizable module title */
    title: string = '';

    static genModuleId(): string {
        const bytes = window.crypto.getRandomValues(new Uint8Array(8));
        return [...bytes].map((x) => ('00' + x.toString(16)).substr(-2)).join('');
    }

    constructor(plugin: ModulePlugin<T>, data = plugin.initialData()) {
        this.plugin = plugin;
        this.data = data;
    }

    shallowClone(): this {
        const mod = new Module(this.plugin, this.data);
        mod.id = this.id;
        mod.sends = this.sends;
        mod.namedSends = this.namedSends;
        mod.graphPos = this.graphPos;
        mod.title = this.title;
        return mod as this;
    }
}

export type ModuleId = string;
export type AnyModule = Module<JsonValue>;

export type NamedSends = Map<ModuleId, Set<string>>;
export type NamedInputData = Map<string, Data>;

export interface ModulePlugin<T> {
    /** Unique plugin ID. */
    id: string;

    acceptsInputs: boolean;
    acceptsNamedInputs: boolean;

    wantsDebounce?: boolean;

    /** The component that renders the GUI for this module. */
    component: Component<ModulePluginProps<T>> | FunctionComponent<ModulePluginProps<T>>;

    /** Returns a default initial value. */
    initialData(): T;

    /** Returns a text description of the module. */
    description(data: T): string;

    eval(data: T, inputs: Data[], namedInputs: NamedInputData, options: EvalOptions): Promise<Data>;
}

export interface EvalOptions {
    userData: UserData;
}

export class UnloadedPlugin implements ModulePlugin<JsonValue> {
    id: string;
    acceptsInputs = false;
    acceptsNamedInputs = false;
    document: Document;

    constructor(id: string, document: Document) {
        this.id = id;
        this.document = document;
    }

    component() {
        return null;
    }

    initialData(): JsonValue {
        throw new Error('plugin not loaded');
    }

    description() {
        return 'Loading';
    }

    eval(): Promise<Data> {
        throw new Error('plugin not loaded');
    }
}

export interface ModulePluginProps<T> {
    document: Document;
    id: ModuleId;
    data: T;
    userData: UserData;
    namedInputKeys: Set<string>;
    onChange: (v: T) => void;
}

export type Class<T> = { new (...args: any[]): T };

export abstract class Data {
    typeId = 'NULL';

    into<T extends Data>(type: Class<T>): T | null {
        if (this instanceof type) return this as unknown as T;
        return null;
    }

    /** Converts this data to a markdown output string, if possible. */
    asMdOutput(): string | null {
        return null;
    }

    abstract typeDescription(): string;

    /** Drops any resources allocated or associated with this data. */
    drop(): void {}
}

export class ByteSliceData extends Data {
    type = 'application/octet-stream';
    contents: Uint8Array;

    constructor(contents: Uint8Array) {
        super();
        this.contents = contents;
    }

    typeDescription() {
        return '[u8]';
    }
}

export class PlainTextData extends Data {
    typeId = 'text/plain';
    contents: string;

    constructor(contents: string) {
        super();
        this.contents = contents;
    }

    into<T extends Data>(type: Class<T>): T | null {
        if (this instanceof type) {
            return this as unknown as T;
        }
        if (type === (ByteSliceData as Class<unknown> as Class<T>)) {
            return new ByteSliceData(new TextEncoder().encode(this.contents)) as unknown as T;
        }
        return null;
    }

    typeDescription() {
        return 'text';
    }
}

export class HtmlData extends PlainTextData {
    typeId = 'text/html';

    asMdOutput() {
        return this.contents;
    }

    typeDescription() {
        return 'HTML';
    }
}

export class CssData extends PlainTextData {
    typeId = 'text/css';

    typeDescription() {
        return 'CSS';
    }
}

export class JavascriptData extends PlainTextData {
    typeId = 'application/javascript';

    typeDescription() {
        return 'Javascript';
    }
}

export class BlobData extends ByteSliceData {
    typeId = 'application/blob';
    objectUrl: string;
    blob: Blob;

    constructor(contents: Uint8Array<ArrayBufferLike>, type: string) {
        super(contents);
        // Callers pass fresh ArrayBuffer-backed arrays (base64js / TextEncoder); eo3 never
        // uses SharedArrayBuffer, so this narrowing to the BlobPart-accepted form is safe.
        this.blob = new Blob([contents as Uint8Array<ArrayBuffer>], { type });
        this.objectUrl = URL.createObjectURL(this.blob);
    }

    drop() {
        URL.revokeObjectURL(this.objectUrl);
    }

    typeDescription() {
        return 'Blob';
    }

    into<T extends Data>(type: Class<T>): T | null {
        if (this instanceof type) {
            return this as unknown as T;
        }
        if (type === (PlainTextData as Class<unknown> as Class<T>)) {
            return new PlainTextData(this.objectUrl) as unknown as T;
        }
        return null;
    }
}
