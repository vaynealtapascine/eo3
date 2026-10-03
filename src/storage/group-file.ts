import type { JsonValue } from '../document';

/**
 * A group saved on its own, to share or reuse in another work: its modules, the links between
 * them, and their layout. Links to anything outside the group are not saved; an imported group
 * arrives unwired.
 */
export interface GroupFile {
    eo3: 'group';
    version: 1;
    title: string;
    modules: GroupFileModule[];
    /** Members filled in when the group is used as a block in the simple editor, by index. */
    inputs?: GroupFileInput[];
}

export interface GroupFileInput {
    module: number;
    label: string;
}

export interface GroupFileModule {
    plugin: string;
    data: JsonValue;
    title?: string;
    /** Indices of the group's modules this one sends to. */
    sends?: number[];
    /** Named sends, by index of the receiving module. */
    namedSends?: Record<string, string[]>;
    /** Position relative to the group's top-left module. */
    position?: [number, number];
}

export const GROUP_FILE_EXTENSION = '.eo3group.json';

/** Reads a group file, throwing an error that explains what's wrong with it. */
export function parseGroupFile(text: string): GroupFile {
    let data: any;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('This isn’t a group file: it couldn’t be read as JSON.');
    }
    if (data?.eo3 !== 'group') throw new Error('This isn’t an eo3 group file.');
    if (data.version !== 1) {
        throw new Error('This group file was made by a newer version of eo3.');
    }
    if (!Array.isArray(data.modules) || !data.modules.length) {
        throw new Error('This group file has no modules in it.');
    }
    const count = data.modules.length;
    const index = (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;
    const modules = data.modules.map((mod: any, i: number): GroupFileModule => {
        if (typeof mod?.plugin !== 'string') {
            throw new Error(`Module ${i + 1} in this group file has no type.`);
        }
        const result: GroupFileModule = { plugin: mod.plugin, data: mod.data ?? null };
        if (typeof mod.title === 'string' && mod.title) result.title = mod.title;
        if (Array.isArray(mod.sends)) result.sends = mod.sends.filter(index);
        if (mod.namedSends && typeof mod.namedSends === 'object') {
            result.namedSends = Object.fromEntries(
                Object.entries(mod.namedSends)
                    .filter(([target, names]) => index(+target) && Array.isArray(names))
                    .map(([target, names]) => [target, (names as unknown[]).map(String)])
            );
        }
        if (
            Array.isArray(mod.position) &&
            mod.position.length === 2 &&
            mod.position.every((n: unknown) => typeof n === 'number' && isFinite(n))
        ) {
            result.position = [mod.position[0], mod.position[1]];
        }
        return result;
    });
    const inputs = parseGroupInputs(data.inputs, count);
    return {
        eo3: 'group',
        version: 1,
        title: typeof data.title === 'string' && data.title ? data.title : 'Group',
        modules,
        ...(inputs.length ? { inputs } : {}),
    };
}

/** Group inputs from a file or a saved work, skipping entries that don't name a member. */
export function parseGroupInputs(value: unknown, count: number): GroupFileInput[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<number>();
    return value.flatMap((input: any) => {
        const module = input?.module;
        if (!Number.isInteger(module) || module < 0 || module >= count || seen.has(module)) {
            return [];
        }
        seen.add(module);
        return [{ module, label: typeof input.label === 'string' ? input.label : '' }];
    });
}

export function stringifyGroupFile(file: GroupFile): string {
    return JSON.stringify(file, null, 2);
}

/** A file name for a group, from its title. */
export function groupFileName(title: string): string {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return (slug || 'group') + GROUP_FILE_EXTENSION;
}
