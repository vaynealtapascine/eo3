import { Component, FunctionComponent } from 'react';
import { MODULES } from './plugins';
import { EFFECTS, EffectKey } from './effects';

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
    /** Canonical lifted Work Skin rules saved when a part was marked posted. */
    skinRecord: Record<string, string>;
    /** Managed CSS module for a pasted AO3 Work Skin, kept wired to newly added parts. */
    importedSkinModuleId: ModuleId | null;
    /** Imported generated classes kept for chapters not yet brought into eo3. */
    protectedSkinClasses: string[];
    /** Latest imported or marked-posted Work Skin for the diff shown before copying. */
    skinBaseline: string | null;
    /** Named reusable groups; each instance contains ordinary modules in the graph. */
    groupDefinitions: GroupDefinition[];
    groupInstances: GroupInstance[];
}

export interface GroupDefinition {
    id: string;
    title: string;
    /** Built-in shelf entry, when this definition came from one. */
    shelfKey?: string;
}

export interface GroupInstance {
    id: string;
    definitionId: string;
    partId: string;
    /** Module IDs in corresponding order across instances of a definition. */
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
    /** Set when the user marks the part as posted. */
    posted: PostedSnapshot | null;
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
function isCssModule(mod: AnyModule): boolean {
    if (mod.plugin.id === 'source.sass' || mod.plugin.id === 'source.lesscss') return true;
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
        posted: null,
    };
}

/** What evaluating the whole work produces, before any target packages it. */
export interface WorkOutput {
    parts: PartOutput[];
    /** CSS from modules that reach every part, in module order. */
    workCss: string;
    /** Each CSS module and the parts it reaches, in module order. */
    cssSources: CssSourceOutput[];
    skinRecord: Record<string, string>;
    protectedSkinClasses: string[];
    skinBaseline: string | null;
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
    posted: PostedSnapshot | null;
}

export class Document extends EventTarget {
    history: HistoryEntry[] = [
        {
            state: {
                title: '',
                titleInPost: false,
                modules: [],
                parts: [newPart(MOD_OUTPUT)],
                skinRecord: {},
                importedSkinModuleId: null,
                protectedSkinClasses: [],
                skinBaseline: null,
                groupDefinitions: [],
                groupInstances: [],
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
            | 'skinRecord'
            | 'importedSkinModuleId'
            | 'protectedSkinClasses'
            | 'skinBaseline'
            | 'groupDefinitions'
            | 'groupInstances'
        > & {
            parts?: Part[];
            skinRecord?: Record<string, string>;
            importedSkinModuleId?: ModuleId | null;
            protectedSkinClasses?: string[];
            skinBaseline?: string | null;
            groupDefinitions?: GroupDefinition[];
            groupInstances?: GroupInstance[];
        }
    ) {
        if (this.history.length > 1) throw new Error('cannot init in this state');
        this.history[0].state = {
            ...state,
            parts: state.parts?.length ? state.parts : [newPart(MOD_OUTPUT)],
            skinRecord: state.skinRecord ?? {},
            importedSkinModuleId: state.importedSkinModuleId ?? null,
            protectedSkinClasses: state.protectedSkinClasses ?? [],
            skinBaseline: state.skinBaseline ?? null,
            groupDefinitions: state.groupDefinitions ?? [],
            groupInstances: state.groupInstances ?? [],
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

    get skinRecord(): Readonly<Record<string, string>> {
        return this.state.skinRecord;
    }

    get importedSkinModuleId(): ModuleId | null {
        return this.state.importedSkinModuleId;
    }

    get protectedSkinClasses(): Readonly<string[]> {
        return this.state.protectedSkinClasses;
    }

    get skinBaseline(): string | null {
        return this.state.skinBaseline;
    }

    get groupDefinitions(): Readonly<GroupDefinition[]> {
        return this.state.groupDefinitions;
    }

    get groupInstances(): Readonly<GroupInstance[]> {
        return this.state.groupInstances;
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
            const instance = this.groupInstances.find((group) =>
                group.moduleIds.includes(module.id)
            );
            if (instance) {
                const slot = instance.moduleIds.indexOf(module.id);
                const siblings = new Set(
                    this.groupInstances
                        .filter((group) => group.definitionId === instance.definitionId)
                        .map((group) => group.moduleIds[slot])
                );
                for (let i = 0; i < newModules.length; i++) {
                    if (newModules[i].id === module.id || !siblings.has(newModules[i].id)) continue;
                    const copy = newModules[i].shallowClone();
                    copy.data = structuredClone(module.data);
                    copy.title = module.title;
                    newModules[i] = copy;
                }
            }
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
                groupInstances: this.groupInstances.filter(
                    (instance) => !instance.moduleIds.includes(moduleId)
                ),
            },
            { type: ChangeType.RemoveModule }
        );
    }

    private pushParts(parts: Part[], modules = this.modules as AnyModule[]) {
        this.pushHistoryState({ ...this.state, modules, parts }, { type: ChangeType.EditParts });
    }

    /** Turn modules wired within one part into a reusable shared definition. */
    createGroup(title: string, partId: string, moduleIds: ModuleId[], shelfKey?: string) {
        const part = this.findPart(partId);
        const ids = new Set(moduleIds);
        if (!part || !ids.size || ids.size !== moduleIds.length) return null;
        if (this.groupInstances.some((instance) => instance.moduleIds.some((id) => ids.has(id))))
            return null;
        const modules = moduleIds.map((id) => this.findModule(id));
        if (modules.some((mod) => !mod)) return null;
        for (const mod of modules as AnyModule[]) {
            if (mod.sends.some((target) => !ids.has(target) && target !== part.outputId))
                return null;
            if ([...mod.namedSends.keys()].some((target) => !ids.has(target))) return null;
        }
        const definition: GroupDefinition = {
            id: Module.genModuleId(),
            title,
            ...(shelfKey ? { shelfKey } : {}),
        };
        const instance: GroupInstance = {
            id: Module.genModuleId(),
            definitionId: definition.id,
            partId,
            moduleIds,
        };
        this.pushHistoryState(
            {
                ...this.state,
                groupDefinitions: [...this.groupDefinitions, definition],
                groupInstances: [...this.groupInstances, instance],
            },
            { type: ChangeType.EditParts }
        );
        return instance;
    }

    /** Clone a group's ordinary graph modules, remapping its internal links and part output. */
    duplicateGroup(instanceId: string, targetPartId: string): GroupInstance | null {
        const source = this.groupInstances.find((instance) => instance.id === instanceId);
        const fromPart = source && this.findPart(source.partId);
        const toPart = this.findPart(targetPartId);
        if (!source || !fromPart || !toPart) return null;
        const originals = source.moduleIds.map((id) => this.findModule(id));
        if (originals.some((mod) => !mod)) return null;
        const copies = (originals as AnyModule[]).map((mod) => {
            const copy = new Module(mod.plugin, structuredClone(mod.data));
            copy.title = mod.title;
            return copy;
        });
        const remap = new Map(source.moduleIds.map((id, i) => [id, copies[i].id]));
        for (let i = 0; i < copies.length; i++) {
            const original = originals[i]!;
            copies[i].sends = original.sends.map((target) =>
                target === fromPart.outputId ? toPart.outputId : remap.get(target) ?? target
            );
            copies[i].namedSends = new Map(
                [...original.namedSends].map(([target, names]) => [
                    remap.get(target) ?? target,
                    new Set(names),
                ])
            );
        }
        const instance: GroupInstance = {
            id: Module.genModuleId(),
            definitionId: source.definitionId,
            partId: targetPartId,
            moduleIds: copies.map((mod) => mod.id),
        };
        this.pushHistoryState(
            {
                ...this.state,
                modules: [...this.modules, ...copies],
                groupInstances: [...this.groupInstances, instance],
            },
            { type: ChangeType.EditParts }
        );
        return instance;
    }

    /** Give one instance its own definition; subsequent edits no longer change its siblings. */
    detachGroup(instanceId: string) {
        const instance = this.groupInstances.find((group) => group.id === instanceId);
        const definition = this.groupDefinitions.find(
            (group) => group.id === instance?.definitionId
        );
        if (!instance || !definition) return;
        const copy: GroupDefinition = {
            id: Module.genModuleId(),
            title: `${definition.title} copy`,
        };
        this.pushHistoryState(
            {
                ...this.state,
                groupDefinitions: [...this.groupDefinitions, copy],
                groupInstances: this.groupInstances.map((group) =>
                    group.id === instanceId ? { ...group, definitionId: copy.id } : group
                ),
            },
            { type: ChangeType.EditParts }
        );
    }

    /** Add a shelf effect as a group of ordinary HTML and CSS modules. */
    async addPackagedEffect(key: EffectKey, partId: string): Promise<GroupInstance | null> {
        const part = this.findPart(partId);
        if (!part) return null;
        const existing = this.groupDefinitions.find((definition) => definition.shelfKey === key);
        const source =
            existing &&
            this.groupInstances.find((instance) => instance.definitionId === existing.id);
        if (source) return this.duplicateGroup(source.id, partId);

        const plugin = await MODULES['source.text'].load();
        const effect = EFFECTS[key];
        const html = new Module(plugin, { contents: effect.html, language: 'html' });
        html.title = `${effect.title} HTML`;
        html.sends = [part.outputId];
        const css = new Module(plugin, { contents: effect.css, language: 'css' });
        css.title = `${effect.title} styles`;
        css.sends = [part.outputId];
        const definition: GroupDefinition = {
            id: Module.genModuleId(),
            title: effect.title,
            shelfKey: key,
        };
        const instance: GroupInstance = {
            id: Module.genModuleId(),
            definitionId: definition.id,
            partId,
            moduleIds: [html.id, css.id],
        };
        this.pushHistoryState(
            {
                ...this.state,
                modules: [...this.modules, html, css],
                groupDefinitions: [...this.groupDefinitions, definition],
                groupInstances: [...this.groupInstances, instance],
            },
            { type: ChangeType.EditParts }
        );
        return instance;
    }

    /** Keep the imported Work Skin shared when a new part is added. */
    private modulesWithImportedSkinFor(outputId: ModuleId): AnyModule[] {
        return this.modules.map((mod) => {
            if (mod.id !== this.importedSkinModuleId || mod.sends.includes(outputId)) return mod;
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
        this.pushParts(parts, this.modulesWithImportedSkinFor(part.outputId));
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
                modules: [...this.modulesWithImportedSkinFor(part.outputId), module],
                parts: [...this.parts, part],
            },
            { type: ChangeType.EditParts }
        );
        return part;
    }

    /** Add or replace the managed imported Work Skin as one undoable CSS module edit. */
    async importWorkSkin(
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
                protectedSkinClasses: Object.keys(liftedRules),
                skinRecord: { ...this.skinRecord, ...liftedRules },
                skinBaseline: canonicalCss,
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
            !first.posted &&
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
                modules: [...this.modulesWithImportedSkinFor(part.outputId), module],
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

    /** Mark a part posted and save its lifted rules in one undoable change. */
    setPartPosted(
        id: string,
        posted: PostedSnapshot | null,
        skinRules: Record<string, string> = {}
    ) {
        if (!this.findPart(id)) return;
        this.pushHistoryState(
            {
                ...this.state,
                parts: this.parts.map((part) => (part.id === id ? { ...part, posted } : part)),
                skinRecord: { ...this.skinRecord, ...skinRules },
                skinBaseline: posted?.skinCss ?? this.skinBaseline,
            },
            { type: ChangeType.EditParts }
        );
    }

    /** Drop recorded rules no posted part references; currently authored rules export as usual. */
    cleanupUnusedSkinRules() {
        const referenced = new Set([
            ...this.parts.flatMap((part) => part.posted?.classes ?? []),
            ...this.protectedSkinClasses,
        ]);
        const skinRecord = Object.fromEntries(
            Object.entries(this.skinRecord).filter(([name]) => referenced.has(name))
        );
        if (Object.keys(skinRecord).length === Object.keys(this.skinRecord).length) return;
        this.pushHistoryState({ ...this.state, skinRecord }, { type: ChangeType.EditParts });
    }

    /** Explicitly prune imported generated rules after the user has reviewed their text. */
    pruneImportedSkinRules(names: string[], updatedCss: string) {
        const selected = new Set(names.filter((name) => this.protectedSkinClasses.includes(name)));
        if (!selected.size) return;
        const module = this.modules.find((mod) => mod.id === this.importedSkinModuleId);
        const modules = this.modules.map((mod) => {
            if (mod !== module) return mod;
            const copy = mod.shallowClone();
            copy.data = { contents: updatedCss, language: 'css' };
            return copy;
        });
        const posted = new Set(this.parts.flatMap((part) => part.posted?.classes ?? []));
        const skinRecord = Object.fromEntries(
            Object.entries(this.skinRecord).filter(
                ([name]) => !selected.has(name) || posted.has(name)
            )
        );
        this.pushHistoryState(
            {
                ...this.state,
                modules,
                skinRecord,
                protectedSkinClasses: this.protectedSkinClasses.filter(
                    (name) => !selected.has(name)
                ),
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
                groupInstances: this.groupInstances.filter((instance) => instance.partId !== id),
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
                skinRecord: this.skinRecord as Record<string, string>,
                protectedSkinClasses: this.protectedSkinClasses as string[],
                skinBaseline: this.skinBaseline,
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
                    posted: part.posted,
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
