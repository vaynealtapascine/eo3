import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AnyModule,
    Document,
    instantiateGroupFile,
    JsonValue,
    Module,
    ModuleGroup,
    ModuleId,
    ModulePlugin,
    ModulePluginProps,
    moduleDescription,
    UserData,
} from '../../document';
import {
    isTransformModule,
    itemKey,
    LinearItem,
    LinearOrderError,
    managedModuleIds,
} from '../../linear';
import { MODULES } from '../../plugins';
import { SettingsForm } from '../../plugins/source/settings';
import type { SettingsData } from '../../plugins/source/settings-values';
import { EXAMPLE_GROUPS } from '../../groups/examples';
import { listLibraryGroups } from '../../storage/group-library';
import { GroupFile } from '../../storage/group-file';
import { DirPopover } from '../../uikit/dir-popover';
import { useSiteTarget } from '../../targets/context';
import { showAlert, showConfirm } from '../dialogs';
import { setEditorView } from '../editor-view';
import { ActionMenu, MenuAction } from './action-menu';
import { EditIcon } from './icons';
import { TextField } from '../../uikit/text-field';
import { ModulePicker } from './module-picker';
import './simple-editor.css';

/**
 * The simple editor: the selected part as a list of items, top to bottom, with the wiring
 * following from the order (see `linear.ts`). Works it can't show as a list get a notice and a
 * way into the nodes view instead.
 */
export function SimpleEditor({ document, partId, userData }: SimpleEditor.Props) {
    const target = useSiteTarget();
    const label = target.plugin?.partLabel ?? 'Part';
    const part = document.findPart(partId ?? '') ?? document.parts[0];
    const partIndex = document.parts.indexOf(part);
    const result = document.linear;

    if (!('layout' in result)) {
        return (
            <section className="simple-editor" aria-label="Simple editor">
                <div className="i-notice">
                    <p>
                        This work is connected in a way the simple view can’t show as a list, so it
                        can only be edited in the nodes view.
                    </p>
                    <p className="i-reason">{result.reason}</p>
                    <button className="i-button is-primary" onClick={() => setEditorView('nodes')}>
                        Switch to nodes view
                    </button>
                </div>
            </section>
        );
    }

    const layout = result.layout;
    const items = layout.parts[part.id] ?? [];
    /** Applies changed lists (this part's and any others); explains an impossible order. */
    const apply = (lists: Record<string, LinearItem[]>, added?: Added) => {
        try {
            document.applyLinearLayout({ parts: { ...layout.parts, ...lists } }, added);
        } catch (error) {
            if (!(error instanceof LinearOrderError)) throw error;
            showAlert(error.message, { title: 'Can’t put it there' });
        }
    };
    const setItems = (next: LinearItem[], added?: Added, other?: Record<string, LinearItem[]>) =>
        apply({ ...other, [part.id]: next }, added);

    /** The parts listing an item, by index. */
    const partsWith = (item: LinearItem) =>
        document.parts
            .map((p, j) => ({ p, j }))
            .filter(({ p }) =>
                (layout.parts[p.id] ?? []).some((other) => itemKey(other) === itemKey(item))
            );
    const isEffect = (item: LinearItem) => {
        const mod = item.kind === 'module' ? document.findModule(item.moduleId) : undefined;
        return !!mod && isTransformModule(mod);
    };

    const move = (index: number, to: number) => {
        const next = items.slice();
        const [item] = next.splice(index, 1);
        next.splice(to, 0, item);
        setItems(next);
    };
    const moveToPart = (index: number, partId: string) => {
        const next = items.slice();
        const [item] = next.splice(index, 1);
        setItems(next, undefined, { [partId]: [...(layout.parts[partId] ?? []), item] });
    };
    const mirrorTo = (item: LinearItem, partId: string) =>
        apply({ [partId]: [...(layout.parts[partId] ?? []), item] });
    /** Replaces a mirror in this part with its own copy, to edit separately. */
    const separate = async (index: number) => {
        const item = items[index];
        let copy: LinearItem;
        let added: Added;
        if (item.kind === 'module') {
            const original = document.findModule(item.moduleId)!;
            const mod = new Module(original.plugin, structuredClone(original.data));
            mod.title = original.title;
            copy = { kind: 'module', moduleId: mod.id };
            added = { modules: [mod] };
        } else {
            const { modules, group } = await instantiateGroupFile(
                document.groupFile(item.groupId)!
            );
            copy = { kind: 'block', groupId: group.id };
            added = { modules, groups: [group] };
        }
        setItems(
            items.map((other, i) => (i === index ? copy : other)),
            added
        );
    };
    const remove = async (index: number, name: string, mirrored: boolean) => {
        const message = mirrored
            ? `Remove “${name}” from this ${label.toLowerCase()}? It stays in the others.`
            : `Remove “${name}” from this ${label.toLowerCase()}?`;
        const yes = await showConfirm(message, { confirmLabel: 'Remove', danger: true });
        if (yes) setItems(items.filter((_, i) => i !== index));
    };
    const add = (item: LinearItem, added?: Added) => setItems([...items, item], added);

    const pinned = pinnedModules(document, part.outputId, part.stylesModuleId);
    const partName = (i: number) => {
        const p = document.parts[i];
        return `${label} ${i + 1}${p.title ? `: ${p.title}` : ''}`;
    };
    const shortPartNames = (indices: number[]) =>
        `${label}${indices.length > 1 ? 's' : ''} ${indices.map((j) => j + 1).join(', ')}`;

    // Items in other parts that could be mirrored here, each once.
    const listedHere = new Set(items.map(itemKey));
    const elsewhere = new Map<string, { item: LinearItem; parts: number[] }>();
    document.parts.forEach((p, j) => {
        if (p.id === part.id) return;
        for (const item of layout.parts[p.id] ?? []) {
            const key = itemKey(item);
            if (listedHere.has(key) || isEffect(item)) continue;
            if (!elsewhere.has(key)) elsewhere.set(key, { item, parts: [] });
            elsewhere.get(key)!.parts.push(j);
        }
    });
    const mirrorChoices = [...elsewhere.values()].map(({ item, parts }) => ({
        title: itemName(document, item),
        description: `In ${shortPartNames(parts)}`,
        add: () => add(item),
    }));

    return (
        <section className="simple-editor" aria-label={`${partName(partIndex)} contents`}>
            {pinned.map((mod) => (
                <PinnedStyles
                    key={mod.id}
                    document={document}
                    module={mod}
                    partLabel={label}
                    userData={userData?.get(mod.id)}
                />
            ))}
            {items.length ? (
                <ItemList
                    document={document}
                    items={items}
                    userData={userData}
                    onMove={move}
                    onRename={(item, name) => {
                        if (item.kind === 'block') {
                            // A block keeps its name rather than having none.
                            if (name) document.renameGroup(item.groupId, name);
                            return;
                        }
                        const mod = document.findModule(item.moduleId)!.shallowClone();
                        mod.title = name;
                        document.insertModule(mod);
                    }}
                    mirroredIn={(item) => {
                        const shown = partsWith(item);
                        return shown.length > 1 ? shortPartNames(shown.map(({ j }) => j)) : null;
                    }}
                    actions={(i, name) => {
                        const item = items[i];
                        const shown = new Set(partsWith(item).map(({ p }) => p.id));
                        const others = document.parts
                            .map((p, j) => ({ p, j }))
                            .filter(({ p }) => !shown.has(p.id));
                        const mirrored = shown.size > 1;
                        return [
                            ...(isEffect(item)
                                ? []
                                : others.map(({ p, j }) => ({
                                      label: `Mirror in ${partName(j)}`,
                                      run: () => mirrorTo(item, p.id),
                                  }))),
                            ...others.map(({ p, j }) => ({
                                label: `Move to ${partName(j)}`,
                                run: () => moveToPart(i, p.id),
                            })),
                            ...(mirrored
                                ? [{ label: 'Make a separate copy here', run: () => separate(i) }]
                                : []),
                            {
                                label: mirrored
                                    ? `Remove from this ${label.toLowerCase()}`
                                    : 'Remove',
                                danger: true,
                                run: () => remove(i, name, mirrored),
                            },
                        ];
                    }}
                />
            ) : (
                <p className="i-empty">
                    This {label.toLowerCase()} is empty. Add your text, or a ready-made block like a
                    letter or a text-message thread.
                </p>
            )}
            <AddMenu onAdd={add} mirrorChoices={mirrorChoices} />
        </section>
    );
}

export namespace SimpleEditor {
    export interface Props {
        document: Document;
        partId: string | null;
        userData?: Map<ModuleId, UserData>;
    }
}

/** Managed styles that reach this part: "All chapters", an imported skin, its own styles. */
function pinnedModules(doc: Document, outputId: ModuleId, stylesId: ModuleId | null) {
    const managed = managedModuleIds(doc.state);
    return doc.modules.filter(
        (mod) =>
            managed.has(mod.id) &&
            (mod.id === stylesId ||
                (mod.sends.includes(outputId) &&
                    !doc.parts.some((p) => p.stylesModuleId === mod.id)))
    );
}

function itemName(doc: Document, item: LinearItem): string {
    if (item.kind === 'block') return doc.findGroup(item.groupId)?.title ?? 'Block';
    const mod = doc.findModule(item.moduleId);
    return mod ? moduleName(mod) : 'Module';
}

function moduleName(mod: AnyModule): string {
    return mod.title || defaultName(mod);
}

/** What a module is called when it has no title of its own. */
function defaultName(mod: AnyModule): string {
    if (mod.plugin.id === 'source.text') {
        const language = (mod.data as { language?: string }).language;
        if (language === 'css') return 'Styles';
        if (language === 'html' || language === 'html-contenteditable' || language === 'text') {
            return 'Text';
        }
    }
    return mod.plugin.description(mod.data);
}

function kindLabel(doc: Document, item: LinearItem): string {
    if (item.kind === 'block') return 'Block';
    const mod = doc.findModule(item.moduleId);
    if (!mod) return '';
    if (isTransformModule(mod)) return 'Effect';
    return Object.hasOwn(MODULES, mod.plugin.id) ? MODULES[mod.plugin.id].title : '';
}

/** A module's own editor, as its plugin draws it. */
function ModuleEditor({
    document,
    module,
    userData,
}: {
    document: Document;
    module: AnyModule;
    userData?: UserData;
}) {
    const Editor = module.plugin.component as React.FunctionComponent<ModulePluginProps<JsonValue>>;
    return (
        <Editor
            document={document}
            id={module.id}
            data={module.data}
            namedInputKeys={new Set(document.findModuleInputIds(module.id).namedInputs.keys())}
            onChange={(data) => {
                const mod = module.shallowClone();
                mod.data = data;
                document.insertModule(mod);
            }}
            userData={userData ?? {}}
        />
    );
}

interface DragState {
    index: number;
    startY: number;
    dy: number;
    /** Each card's height folded to its header, and the gap between cards. */
    heights: number[];
    gap: number;
    /** Moves the folded list so the dragged card stays under the pointer. */
    shift: number;
    /** The list's height before folding, kept so nothing below it jumps. */
    listHeight: number;
}

/** Where the dragged card would land, and how far each folded card moves for that order. */
function dragLayout({ index, heights, gap, dy }: DragState) {
    const tops: number[] = [];
    let y = 0;
    for (const h of heights) {
        tops.push(y);
        y += h + gap;
    }
    const center = tops[index] + dy + heights[index] / 2;
    const order = heights.map((_, k) => k).filter((k) => k !== index);
    let insertion = order.length;
    y = 0;
    for (let n = 0; n < order.length; n++) {
        if (center < y + heights[order[n]] / 2) {
            insertion = n;
            break;
        }
        y += heights[order[n]] + gap;
    }
    order.splice(insertion, 0, index);
    const offsets = new Map<number, number>();
    y = 0;
    for (const k of order) {
        offsets.set(k, y - tops[k]);
        y += heights[k] + gap;
    }
    return { insertion, offsets };
}

/**
 * The part's items. Drag a card's handle to move it (the cards fold to their headers while
 * dragging, as in the nodes view's list), or focus the handle and use the arrow keys.
 */
function ItemList({
    document,
    items,
    userData,
    onMove,
    onRename,
    mirroredIn,
    actions,
}: {
    document: Document;
    items: LinearItem[];
    userData?: Map<ModuleId, UserData>;
    onMove: (from: number, to: number) => void;
    onRename: (item: LinearItem, name: string) => void;
    /** Where an item is mirrored ("Chapters 1, 3"), or null when only this part lists it. */
    mirroredIn: (item: LinearItem) => string | null;
    actions: (index: number, name: string) => MenuAction[];
}) {
    const list = useRef<HTMLOListElement>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [focusKey, setFocusKey] = useState<string | null>(null);

    // Moving a card moves its handle in the page, which drops focus; put it back.
    useEffect(() => {
        if (!focusKey) return;
        list.current
            ?.querySelector<HTMLElement>(`[data-key="${focusKey}"] .i-drag-handle`)
            ?.focus();
        setFocusKey(null);
    }, [focusKey, items]);

    const startDrag = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
        const ol = list.current;
        if (!ol || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const cards = [...ol.children] as HTMLElement[];
        const heights = cards.map(
            (li) => li.querySelector<HTMLElement>('.i-header')?.offsetHeight ?? 0
        );
        const gap = parseFloat(getComputedStyle(ol).rowGap) || 0;
        const top = cards[index].getBoundingClientRect().top - ol.getBoundingClientRect().top;
        const foldedTop = heights.slice(0, index).reduce((sum, h) => sum + h + gap, 0);
        updateDrag({
            index,
            startY: event.clientY,
            dy: 0,
            heights,
            gap,
            shift: top - foldedTop,
            listHeight: ol.offsetHeight,
        });
    };
    // Pointer events can arrive faster than renders, so they read the drag from a ref.
    const dragRef = useRef<DragState | null>(null);
    const updateDrag = (next: DragState | null) => {
        dragRef.current = next;
        setDrag(next);
    };
    const moveDrag = (clientY: number) => {
        const current = dragRef.current;
        if (current) updateDrag({ ...current, dy: clientY - current.startY });
    };
    const endDrag = (clientY: number, commit: boolean) => {
        const current = dragRef.current;
        if (!current) return;
        const { insertion } = dragLayout({ ...current, dy: clientY - current.startY });
        updateDrag(null);
        if (commit && insertion !== current.index) onMove(current.index, insertion);
    };

    const offsets = drag ? dragLayout(drag).offsets : null;

    return (
        <>
            <ol
                ref={list}
                className={'i-items' + (drag ? ' is-dragging' : '')}
                style={drag ? { height: drag.listHeight } : undefined}
            >
                {items.map((item, i) => {
                    const name = itemName(document, item);
                    const key = itemKey(item);
                    const offset = drag
                        ? drag.shift + (i === drag.index ? drag.dy : offsets!.get(i)!)
                        : 0;
                    return (
                        <li
                            key={key}
                            data-key={key}
                            className={drag?.index === i ? 'is-being-dragged' : undefined}
                            style={drag ? { transform: `translateY(${offset}px)` } : undefined}
                        >
                            <ItemCard
                                document={document}
                                item={item}
                                name={name}
                                folded={!!drag}
                                mirroredIn={mirroredIn(item)}
                                userData={userData}
                                controls={
                                    <>
                                        <button
                                            className="i-drag-handle"
                                            aria-label={`Move “${name}”`}
                                            title="Drag to move, or use the arrow keys"
                                            role="slider"
                                            aria-valuemin={1}
                                            aria-valuenow={i + 1}
                                            aria-valuemax={items.length}
                                            aria-valuetext={`${i + 1} of ${items.length}`}
                                            onKeyDown={(e) => {
                                                const delta = ['ArrowUp', 'ArrowLeft'].includes(
                                                    e.key
                                                )
                                                    ? -1
                                                    : ['ArrowDown', 'ArrowRight'].includes(e.key)
                                                    ? 1
                                                    : 0;
                                                if (!delta) return;
                                                e.preventDefault();
                                                const to = i + delta;
                                                if (to < 0 || to >= items.length) return;
                                                onMove(i, to);
                                                setFocusKey(key);
                                            }}
                                            onPointerDown={(e) => startDrag(i, e)}
                                            onPointerMove={(e) => moveDrag(e.clientY)}
                                            onPointerUp={(e) => endDrag(e.clientY, true)}
                                            onPointerCancel={(e) => endDrag(e.clientY, false)}
                                        >
                                            <span className="i-drag-icon" aria-hidden>
                                                <span className="i-line" />
                                                <span className="i-line" />
                                                <span className="i-line" />
                                            </span>
                                        </button>
                                        <ActionMenu
                                            label={`${name} actions`}
                                            actions={actions(i, name)}
                                        />
                                    </>
                                }
                                onRename={(name) => onRename(item, name)}
                            />
                        </li>
                    );
                })}
            </ol>
        </>
    );
}

/**
 * A name edited in place, like module titles in the nodes view's list: click it (or its pencil)
 * for a text field; Enter or leaving the field keeps the edit, Escape drops it. `value` is the
 * custom name, empty when there is none; `fallback` is what shows then.
 */
function EditableName({
    value,
    fallback,
    onRename,
    className = '',
}: {
    value: string;
    fallback: string;
    onRename: (name: string) => void;
    className?: string;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const cancelled = useRef(false);
    const field = useRef<TextField>(null);
    useEffect(() => {
        if (!editing) return;
        field.current?.focus();
        field.current?.input.current?.select();
    }, [editing]);

    const shown = value || fallback;
    if (editing) {
        return (
            <TextField
                ref={field}
                className={'i-name-field ' + className}
                aria-label="Name"
                placeholder={fallback}
                value={draft}
                onChange={setDraft}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelled.current = true;
                    if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={() => {
                    if (!cancelled.current && draft.trim() !== value) onRename(draft.trim());
                    setEditing(false);
                }}
            />
        );
    }
    const start = (e: React.MouseEvent) => {
        e.stopPropagation();
        cancelled.current = false;
        setDraft(value);
        setEditing(true);
    };
    return (
        <span className={'i-editable-name ' + className} onClick={start}>
            <span className="i-name-text">{shown}</span>
            <button className="i-edit-icon" aria-label={`Rename “${shown}”`} onClick={start}>
                <EditIcon />
            </button>
        </span>
    );
}

function ItemCard({
    document,
    item,
    name,
    controls,
    onRename,
    mirroredIn = null,
    folded = false,
    userData,
}: {
    document: Document;
    item: LinearItem;
    name: string;
    controls: React.ReactNode;
    onRename: (name: string) => void;
    mirroredIn?: string | null;
    /** Shows only the header, as while dragging. */
    folded?: boolean;
    userData?: Map<ModuleId, UserData>;
}) {
    const [open, setOpen] = useState(true);
    const bodyId = useMemo(() => 'simple-item-' + Math.random().toString(36).slice(2), []);
    const mod = item.kind === 'module' ? document.findModule(item.moduleId) : undefined;
    const group = item.kind === 'block' ? document.findGroup(item.groupId) : undefined;
    const transform = mod && isTransformModule(mod);
    const kind = kindLabel(document, item);

    return (
        <article className={'simple-item' + (transform ? ' is-effect' : '')} aria-label={name}>
            <header className="i-header">
                <button
                    className="i-collapse"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    aria-label={open ? `Hide “${name}”` : `Show “${name}”`}
                    onClick={() => setOpen(!open)}
                >
                    <span className="i-arrow" aria-hidden>
                        {open ? '▾' : '▸'}
                    </span>
                </button>
                <div className="i-title">
                    <EditableName
                        className="i-name"
                        value={item.kind === 'block' ? group?.title ?? '' : mod?.title ?? ''}
                        fallback={item.kind === 'block' ? 'Block' : mod ? defaultName(mod) : name}
                        onRename={onRename}
                    />
                    {kind !== name ? <span className="i-kind">{kind}</span> : null}
                    {mirroredIn ? (
                        <span
                            className="i-mirrored"
                            title={`The same ${
                                kind.toLowerCase() || 'item'
                            } is in ${mirroredIn}; editing it here changes it there too.`}
                        >
                            mirrored · {mirroredIn}
                        </span>
                    ) : null}
                </div>
                <div className="i-controls">{controls}</div>
            </header>
            {transform && !folded ? (
                <p className="i-effect-note">
                    Applies to everything above it, up to the previous effect.
                </p>
            ) : null}
            <div className="i-body" id={bodyId} hidden={!open || folded}>
                {mod ? (
                    <ModuleEditor
                        document={document}
                        module={mod}
                        userData={userData?.get(mod.id)}
                    />
                ) : group ? (
                    <BlockBody document={document} group={group} userData={userData} />
                ) : null}
            </div>
        </article>
    );
}

/** A block: its inputs up front, everything else folded under "Customize". */
function BlockBody({
    document,
    group,
    userData,
}: {
    document: Document;
    group: ModuleGroup;
    userData?: Map<ModuleId, UserData>;
}) {
    const inputs = (group.inputs ?? [])
        .map((input) => ({ ...input, module: document.findModule(input.moduleId) }))
        .filter((input): input is typeof input & { module: AnyModule } => !!input.module);
    const inputIds = new Set(inputs.map((input) => input.moduleId));
    const setInputs = (next: { moduleId: ModuleId; label: string }[]) =>
        document.setGroupInputs(group.id, next);
    const rest = group.moduleIds
        .filter((id) => !inputIds.has(id))
        .map((id) => document.findModule(id))
        .filter((mod): mod is AnyModule => !!mod);

    return (
        <div className="i-block">
            {inputs.map(({ module, label }) => (
                <div className="i-input" key={module.id}>
                    <div className="i-input-header">
                        <h4>
                            <EditableName
                                value={label}
                                fallback={moduleName(module)}
                                onRename={(name) =>
                                    setInputs(
                                        (group.inputs ?? []).map((i) =>
                                            i.moduleId === module.id ? { ...i, label: name } : i
                                        )
                                    )
                                }
                            />
                        </h4>
                        <button
                            className="i-fold"
                            title="Move this into Customize"
                            onClick={() =>
                                setInputs(
                                    (group.inputs ?? []).filter((i) => i.moduleId !== module.id)
                                )
                            }
                        >
                            fold away
                        </button>
                    </div>
                    {module.plugin.id === 'source.settings' ? (
                        <SettingsForm
                            data={module.data as unknown as SettingsData}
                            onChange={(data) => {
                                const mod = module.shallowClone();
                                mod.data = data as unknown as JsonValue;
                                document.insertModule(mod);
                            }}
                        />
                    ) : (
                        <ModuleEditor
                            document={document}
                            module={module}
                            userData={userData?.get(module.id)}
                        />
                    )}
                </div>
            ))}
            {rest.length ? (
                <details className="i-customize">
                    <summary>
                        Customize ({rest.length} {rest.length === 1 ? 'part' : 'parts'})
                    </summary>
                    {rest.map((mod) => (
                        <div className="i-input" key={mod.id}>
                            <div className="i-input-header">
                                <h4>
                                    <EditableName
                                        value={mod.title}
                                        fallback={defaultName(mod)}
                                        onRename={(name) => {
                                            const renamed = mod.shallowClone();
                                            renamed.title = name;
                                            document.insertModule(renamed);
                                        }}
                                    />
                                </h4>
                                <button
                                    className="i-fold"
                                    title="Show this above Customize, where it's always in view"
                                    onClick={() =>
                                        setInputs([
                                            ...(group.inputs ?? []),
                                            { moduleId: mod.id, label: '' },
                                        ])
                                    }
                                >
                                    show up front
                                </button>
                            </div>
                            <ModuleEditor
                                document={document}
                                module={mod}
                                userData={userData?.get(mod.id)}
                            />
                        </div>
                    ))}
                </details>
            ) : null}
        </div>
    );
}

function PinnedStyles({
    document,
    module,
    partLabel,
    userData,
}: {
    document: Document;
    module: AnyModule;
    partLabel: string;
    userData?: UserData;
}) {
    const [open, setOpen] = useState(false);
    const name = module.title || moduleDescription(document, module, partLabel);
    return (
        <article className="simple-item is-pinned" aria-label={name}>
            <header className="i-header">
                <button
                    className="i-collapse is-wide"
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                >
                    <span className="i-arrow" aria-hidden>
                        {open ? '▾' : '▸'}
                    </span>
                    <span className="i-name">
                        <span className="i-name-text">{name}</span>
                    </span>
                    <span className="i-kind">Styles</span>
                </button>
            </header>
            {open ? (
                <div className="i-body">
                    <ModuleEditor document={document} module={module} userData={userData} />
                </div>
            ) : null}
        </article>
    );
}

type Added = { modules?: AnyModule[]; groups?: ModuleGroup[] };

/** "Add": text and styles first, then ready-made blocks, then every module type. */
function AddMenu({
    onAdd,
    mirrorChoices,
}: {
    onAdd: (item: LinearItem, added: Added) => void;
    /** Items listed in other parts, to mirror here. */
    mirrorChoices: { title: string; description: string; add: () => void }[];
}) {
    const button = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [allTypes, setAllTypes] = useState(false);
    const library = open ? listLibraryGroups() : [];

    const addModule = (plugin: ModulePlugin<JsonValue>, data?: JsonValue) => {
        const mod = new Module(plugin, data ?? plugin.initialData());
        onAdd({ kind: 'module', moduleId: mod.id }, { modules: [mod] });
    };
    const addText = async (language: string) => {
        setOpen(false);
        addModule(await MODULES['source.text'].load(), { contents: '', language });
    };
    const addGroup = async (file: GroupFile) => {
        setOpen(false);
        try {
            const { modules, group } = await instantiateGroupFile(file);
            if (modules.length === 1) {
                onAdd({ kind: 'module', moduleId: modules[0].id }, { modules });
            } else {
                onAdd({ kind: 'block', groupId: group.id }, { modules, groups: [group] });
            }
        } catch (error) {
            showAlert((error as Error).message, { title: 'Couldn’t add the block' });
        }
    };

    return (
        <>
            <button ref={button} className="i-add-button" onClick={() => setOpen(true)}>
                + add
            </button>
            <DirPopover anchor={button.current} open={open} onClose={() => setOpen(false)}>
                <div className="simple-add-menu" role="menu" aria-label="Add">
                    <h3>Write</h3>
                    <AddEntry
                        title="Text"
                        description="Your writing, with formatting."
                        onClick={() => addText('html-contenteditable')}
                    />
                    <AddEntry
                        title="Styles"
                        description="CSS for this chapter."
                        onClick={() => addText('css')}
                    />
                    {library.length ? <h3>My groups</h3> : null}
                    {library.map((entry) => (
                        <AddEntry
                            key={entry.id}
                            title={entry.file.title}
                            onClick={() => addGroup(entry.file)}
                        />
                    ))}
                    <h3>Blocks</h3>
                    {EXAMPLE_GROUPS.map((file) => (
                        <AddEntry
                            key={file.title}
                            title={file.title.replace(/^AO3 · /, '')}
                            onClick={() => addGroup(file)}
                        />
                    ))}
                    {mirrorChoices.length ? <h3>Mirror from other chapters</h3> : null}
                    {mirrorChoices.map((choice, i) => (
                        <AddEntry
                            key={i}
                            title={choice.title}
                            description={choice.description}
                            onClick={() => {
                                setOpen(false);
                                choice.add();
                            }}
                        />
                    ))}
                    <h3>More</h3>
                    <AddEntry
                        title="Other module types…"
                        description="Sass, Svelte, effects and more."
                        onClick={() => {
                            setOpen(false);
                            setAllTypes(true);
                        }}
                    />
                </div>
            </DirPopover>
            <ModulePicker
                open={allTypes}
                anchor={button.current}
                onClose={() => setAllTypes(false)}
                onPick={(plugin) => {
                    setAllTypes(false);
                    addModule(plugin);
                }}
                onPickGroup={addGroup}
            />
        </>
    );
}

function AddEntry({
    title,
    description,
    onClick,
}: {
    title: string;
    description?: string;
    onClick: () => void;
}) {
    return (
        <button className="i-entry" role="menuitem" onClick={onClick}>
            <span className="i-title">{title}</span>
            {description ? <span className="i-description">{description}</span> : null}
        </button>
    );
}
