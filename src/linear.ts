import type { AnyModule, DocumentState, ModuleGroup, ModuleId } from './document';

/**
 * The simple editor's view of a work: each part is an ordered list of items, and the wiring
 * follows from the order instead of being drawn.
 *
 * -   A source (text, CSS, Sass…) sends to its part.
 * -   A transform (`transform.*`) takes everything above it in the part, back to the previous
 *     transform (which it takes too), and sends its result on. Whatever is below the last
 *     transform goes straight to the part.
 * -   A block is a group of modules used as one item. Its wiring inside stays as it is; its
 *     sinks (members that send to no other member) are what the rules above wire.
 * -   An item can be mirrored: the same source or block listed in several parts. It is still
 *     one module (or group) in the graph, sending to each of those parts, so editing it changes
 *     them all and its CSS reaches them once. Transforms can't be mirrored.
 * -   Managed modules ("All chapters", an imported Work Skin, a part's own styles) keep their
 *     wiring and are not items. Transforms never take them.
 *
 * A part's content follows the work's single module order, so mirrored items keep the same
 * order relative to each other in every part they share.
 *
 * Nothing about this is saved: the layout is read from the graph, and editing it rewrites the
 * graph. A graph that these rules can't produce has no layout, and the simple editor says why.
 */

export type LinearItem =
    | { kind: 'module'; moduleId: ModuleId }
    | { kind: 'block'; groupId: string };

export interface LinearLayout {
    /** Per part id, the part's items from top to bottom. */
    parts: Record<string, LinearItem[]>;
}

export type LinearResult = { layout: LinearLayout } | { reason: string; moduleId?: ModuleId };

type LinearState = Pick<
    DocumentState,
    'modules' | 'parts' | 'groups' | 'importedSkinModuleId' | 'sharedStylesModuleId'
>;

/** A layout that no single module order can produce: mirrored items in different orders. */
export class LinearOrderError extends Error {}

export function isTransformModule(mod: AnyModule): boolean {
    return mod.plugin.id.startsWith('transform.');
}

/** Modules eo3 creates and wires itself; the simple editor pins them instead of listing them. */
export function managedModuleIds(state: LinearState): Set<ModuleId> {
    const ids = new Set<ModuleId>();
    if (state.sharedStylesModuleId) ids.add(state.sharedStylesModuleId);
    if (state.importedSkinModuleId) ids.add(state.importedSkinModuleId);
    for (const part of state.parts) if (part.stylesModuleId) ids.add(part.stylesModuleId);
    return ids;
}

/** A group's sinks: members that send to no other member, in module order. */
export function blockSinks(group: ModuleGroup, modules: readonly AnyModule[]): AnyModule[] {
    const members = new Set(group.moduleIds);
    return modules.filter(
        (mod) =>
            members.has(mod.id) &&
            !mod.sends.some((t) => members.has(t)) &&
            ![...mod.namedSends.keys()].some((t) => members.has(t))
    );
}

export const itemKey = (item: LinearItem) =>
    item.kind === 'module' ? item.moduleId : item.groupId;

const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

/** Reads the simple editor's layout from a work's graph, or explains why there is none. */
export function linearLayout(state: LinearState): LinearResult {
    const { modules, parts, groups } = state;
    const managed = managedModuleIds(state);
    const index = new Map(modules.map((mod, i) => [mod.id, i]));
    const byId = new Map(modules.map((mod) => [mod.id, mod]));
    const name = (mod: AnyModule) => mod.title || mod.plugin.description(mod.data);
    const outputs = new Map(parts.map((part) => [part.outputId, part.id]));

    /** Every item with what it sends to and the module index that orders it. */
    const items = new Map<string, { item: LinearItem; targets: ModuleId[]; order: number }>();
    const memberOf = new Map<ModuleId, ModuleGroup>();

    for (const group of groups) {
        const members = new Set(group.moduleIds);
        for (const id of group.moduleIds) {
            if (managed.has(id)) {
                return {
                    reason: `“${group.title}” holds styles eo3 manages itself.`,
                    moduleId: id,
                };
            }
            memberOf.set(id, group);
        }
        const sinks = blockSinks(group, modules);
        let targets: ModuleId[] | null = null;
        for (const id of group.moduleIds) {
            const mod = byId.get(id);
            if (!mod) continue;
            if ([...mod.namedSends.keys()].some((t) => !members.has(t))) {
                return {
                    reason: `“${group.title}” sends a named input outside itself.`,
                    moduleId: id,
                };
            }
            const outside = mod.sends.filter((t) => !members.has(t));
            if (!sinks.includes(mod)) {
                if (outside.length) {
                    return {
                        reason: `“${group.title}” sends to other places from inside it.`,
                        moduleId: id,
                    };
                }
                continue;
            }
            if (!outside.length) {
                return {
                    reason: `Part of “${group.title}” isn’t connected to anything.`,
                    moduleId: id,
                };
            }
            if (targets && !sameSet(targets, outside)) {
                return {
                    reason: `The parts of “${group.title}” go to different places.`,
                    moduleId: id,
                };
            }
            targets = outside;
        }
        if (!targets) {
            return { reason: `“${group.title}” isn’t connected to anything.` };
        }
        items.set(group.id, {
            item: { kind: 'block', groupId: group.id },
            targets,
            order: Math.min(...sinks.map((mod) => index.get(mod.id)!)),
        });
    }

    for (const mod of modules) {
        if (managed.has(mod.id) || memberOf.has(mod.id)) continue;
        if (mod.namedSends.size) {
            return { reason: `“${name(mod)}” sends a named input.`, moduleId: mod.id };
        }
        if (!mod.sends.length) {
            return { reason: `“${name(mod)}” isn’t connected to anything.`, moduleId: mod.id };
        }
        if (isTransformModule(mod) && mod.sends.length > 1) {
            return {
                reason: `“${name(mod)}” goes to more than one place; effects can’t be mirrored.`,
                moduleId: mod.id,
            };
        }
        items.set(mod.id, {
            item: { kind: 'module', moduleId: mod.id },
            targets: mod.sends,
            order: index.get(mod.id)!,
        });
    }

    const firstModule = (key: string) =>
        byId.get(key)?.id ??
        memberOf.get(key)?.moduleIds[0] ??
        groups.find((g) => g.id === key)?.moduleIds[0];

    // The part each target belongs to: a part's output, or a transform listed in a part.
    const partOf = (target: ModuleId, seen = new Set<ModuleId>()): string | null => {
        if (outputs.has(target)) return outputs.get(target)!;
        const receiver = byId.get(target);
        if (!receiver || !isTransformModule(receiver) || !items.has(target)) return null;
        if (seen.has(target)) return null;
        seen.add(target);
        return partOf(items.get(target)!.targets[0], seen);
    };

    // What each target receives, in module order.
    const inputs = new Map<ModuleId, LinearItem[]>();
    for (const [key, entry] of [...items].sort((a, b) => a[1].order - b[1].order)) {
        const reached = new Set<string>();
        for (const target of entry.targets) {
            const part = partOf(target);
            if (!part) {
                const receiver = byId.get(target);
                return {
                    reason: receiver
                        ? `Something goes into “${name(receiver)}”, which a list can’t show.`
                        : 'Something is connected to a chapter that no longer exists.',
                    moduleId: firstModule(key),
                };
            }
            if (reached.has(part)) {
                return {
                    reason: 'Something reaches the same chapter twice.',
                    moduleId: firstModule(key),
                };
            }
            reached.add(part);
            if (!inputs.has(target)) inputs.set(target, []);
            inputs.get(target)!.push(entry.item);
        }
    }

    // A part's list: each transform comes right after what it takes.
    const layout: LinearLayout = { parts: {} };
    const placedCount = new Map<string, number>();
    const sequence = (target: ModuleId, list: LinearItem[], placed: Set<string>): boolean => {
        for (const item of inputs.get(target) ?? []) {
            const key = itemKey(item);
            if (placed.has(key)) return false;
            placed.add(key);
            placedCount.set(key, (placedCount.get(key) ?? 0) + 1);
            if (item.kind === 'module' && inputs.has(item.moduleId)) {
                if (!sequence(item.moduleId, list, placed)) return false;
            }
            list.push(item);
        }
        return true;
    };
    for (const part of parts) {
        const list: LinearItem[] = [];
        if (!sequence(part.outputId, list, new Set())) {
            return { reason: 'Some modules feed into each other in a loop.' };
        }
        layout.parts[part.id] = list;
    }
    for (const [key, entry] of items) {
        if ((placedCount.get(key) ?? 0) !== entry.targets.length) {
            const mod = byId.get(key);
            return {
                reason: `“${mod ? name(mod) : 'A transform'}” doesn’t lead to any chapter.`,
                moduleId: mod?.id,
            };
        }
    }

    // The list is only right if its order would wire everything exactly as it is now.
    const expected = wiring(layout, state, modules);
    for (const [id, sends] of expected) {
        const mod = byId.get(id)!;
        const actual = mod.sends.filter((t) => !memberOf.get(id)?.moduleIds.includes(t));
        if (!sameSet(actual, sends)) {
            const transform = [...sends, ...actual]
                .map((t) => byId.get(t))
                .find((m) => m && isTransformModule(m));
            return {
                reason: transform
                    ? `“${name(transform)}” takes only some of what’s above it.`
                    : `“${name(mod)}” is wired in a way a list can’t show.`,
                moduleId: transform?.id ?? id,
            };
        }
    }
    return { layout };
}

/** Where each item's sinks send, by the rules at the top of this file: one target per part. */
function wiring(
    layout: LinearLayout,
    state: Pick<LinearState, 'parts' | 'groups'>,
    modules: readonly AnyModule[]
): Map<ModuleId, ModuleId[]> {
    const byId = new Map(modules.map((mod) => [mod.id, mod]));
    const sends = new Map<ModuleId, ModuleId[]>();
    const send = (item: LinearItem, target: ModuleId) => {
        let sinks: ModuleId[] = [];
        if (item.kind === 'module') sinks = [item.moduleId];
        else {
            const group = state.groups.find((g) => g.id === item.groupId);
            if (group) sinks = blockSinks(group, modules).map((mod) => mod.id);
        }
        for (const id of sinks) {
            if (!sends.has(id)) sends.set(id, []);
            sends.get(id)!.push(target);
        }
    };
    for (const part of state.parts) {
        let pending: LinearItem[] = [];
        for (const item of layout.parts[part.id] ?? []) {
            const mod = item.kind === 'module' ? byId.get(item.moduleId) : undefined;
            if (mod && isTransformModule(mod)) {
                for (const before of pending) send(before, mod.id);
                pending = [item];
            } else {
                pending.push(item);
            }
        }
        for (const item of pending) send(item, part.outputId);
    }
    return sends;
}

/**
 * One module order that keeps every part's list in order (a part's styles first): each part
 * lists its items top to bottom, and mirrored items tie the parts' orders together. Throws a
 * LinearOrderError when no order can (mirrored items in different orders in two parts).
 */
function itemOrder(keyLists: string[][]): string[] {
    const rank = new Map<string, number>();
    const after = new Map<string, Set<string>>();
    const before = new Map<string, number>();
    for (const list of keyLists) {
        list.forEach((key, i) => {
            if (!rank.has(key)) rank.set(key, rank.size);
            if (!after.has(key)) after.set(key, new Set());
            if (!before.has(key)) before.set(key, 0);
            const next = list[i + 1];
            if (next !== undefined && !after.get(key)!.has(next)) {
                after.get(key)!.add(next);
                before.set(next, (before.get(next) ?? 0) + 1);
            }
        });
    }
    const order: string[] = [];
    const ready = [...rank.keys()].filter((key) => !before.get(key));
    while (ready.length) {
        // Of everything that can come next, take what appears first in the parts.
        ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
        const key = ready.shift()!;
        order.push(key);
        for (const next of after.get(key)!) {
            before.set(next, before.get(next)! - 1);
            if (!before.get(next)) ready.push(next);
        }
    }
    if (order.length < rank.size) {
        throw new LinearOrderError(
            'Mirrored items have to stay in the same order in every chapter that shows them.'
        );
    }
    return order;
}

/**
 * Rewrites a work's modules to match a layout: module order follows the lists (pinned modules
 * first), item sinks are rewired, and any module that is neither pinned nor in the layout is
 * removed. `added` are new modules and groups the layout refers to. Throws a LinearOrderError
 * for a layout no module order can produce.
 */
export function applyLinearLayout(
    state: LinearState,
    layout: LinearLayout,
    added: { modules?: AnyModule[]; groups?: ModuleGroup[] } = {}
): { modules: AnyModule[]; groups: ModuleGroup[] } {
    const all = [...state.modules, ...(added.modules ?? [])];
    const groups = [...state.groups, ...(added.groups ?? [])];
    const byId = new Map(all.map((mod) => [mod.id, mod]));
    const position = new Map(all.map((mod, i) => [mod.id, i]));
    const managed = managedModuleIds(state);
    const partStyles = new Set(state.parts.map((part) => part.stylesModuleId));

    const listed = new Map<string, LinearItem>();
    const keyLists = state.parts.map((part) => {
        const keys: string[] = [];
        if (part.stylesModuleId && byId.has(part.stylesModuleId)) keys.push(part.stylesModuleId);
        for (const item of layout.parts[part.id] ?? []) {
            const exists =
                item.kind === 'module'
                    ? byId.has(item.moduleId)
                    : groups.some((g) => g.id === item.groupId);
            if (!exists) continue;
            listed.set(itemKey(item), item);
            keys.push(itemKey(item));
        }
        return keys;
    });

    const order: ModuleId[] = all
        .filter((mod) => managed.has(mod.id) && !partStyles.has(mod.id))
        .map((mod) => mod.id);
    const usedGroups = new Set<string>();
    for (const key of itemOrder(keyLists)) {
        const item = listed.get(key);
        if (!item || item.kind === 'module') {
            order.push(key);
            continue;
        }
        const group = groups.find((g) => g.id === item.groupId)!;
        usedGroups.add(group.id);
        order.push(
            ...group.moduleIds
                .filter((id) => byId.has(id))
                .sort((a, b) => position.get(a)! - position.get(b)!)
        );
    }
    const kept = new Set(order);

    const keptGroups = groups.filter((group) => usedGroups.has(group.id));
    const sends = wiring(
        layout,
        { parts: state.parts, groups: keptGroups },
        order.map((id) => byId.get(id)!)
    );
    const modules = order.map((id) => {
        const mod = byId.get(id)!;
        const group = keptGroups.find((g) => g.moduleIds.includes(id));
        let next = mod.sends.filter((t) => kept.has(t) || !byId.has(t));
        if (sends.has(id)) {
            next = [...next.filter((t) => group?.moduleIds.includes(t)), ...sends.get(id)!];
        }
        const named = [...mod.namedSends].filter(([t]) => kept.has(t) || !byId.has(t));
        const sameSends =
            next.length === mod.sends.length && next.every((t, i) => t === mod.sends[i]);
        if (sameSends && named.length === mod.namedSends.size) return mod;
        const copy = mod.shallowClone();
        copy.sends = next;
        copy.namedSends = new Map(named);
        return copy;
    });
    return { modules, groups: keptGroups };
}
