import { useEffect, useId, useRef, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { ModuleCategory, MODULES } from '../../plugins';
import { ModulePlugin, JsonValue } from '../../document';
import { GroupFile } from '../../storage/group-file';
import {
    LibraryGroup,
    listLibraryGroups,
    moveLibraryGroup,
    removeLibraryGroup,
    subscribeLibraryGroups,
} from '../../storage/group-library';
import { EXAMPLE_GROUPS, exampleGroupDescription } from '../../groups/examples';
import { downloadGroupFile, pickGroupFile } from '../group-files';
import { ActionMenu } from './action-menu';
import { isCoarsePointer, useFocusWhenShown } from '../focus-when-shown';
import './module-picker.css';
import { showAlert, showConfirm } from '../dialogs';

const LOAD_FAILED = 'This couldn’t be loaded. Check your connection, then try again.';

/** The categories module types are listed under, in order. */
const MODULE_CATEGORIES: Record<ModuleCategory, string> = {
    writing: 'Writing',
    styles: 'Styles',
    media: 'Files and images',
    advanced: 'Advanced',
};

const MODULE_IDS = Object.keys(MODULES).filter((id) => !MODULES[id].managed);
const categoryOf = (id: string): ModuleCategory => MODULES[id].category ?? 'advanced';

/**
 * "add node": a search field over everything that can be added, module types by category, and
 * a "Groups and templates" entry that opens a second level with the author's saved groups, the
 * built-in templates, and importing a group file, so the first level stays short.
 */
export function ModulePicker({ open, anchor, onClose, onPick, onPickGroup }: ModulePicker.Props) {
    const [level, setLevel] = useState<'modules' | 'groups'>('modules');
    const [query, setQuery] = useState('');
    /** The module type being fetched; its code is loaded on first use. */
    const [loading, setLoading] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const library = useLibraryGroups();
    const container = useRef<HTMLDivElement | null>(null);
    const search = useRef<HTMLInputElement | null>(null);
    const isOpen = useRef(open);
    isOpen.current = open;

    useEffect(() => {
        if (open) return;
        setLevel('modules');
        setQuery('');
        setFailed(null);
    }, [open]);

    // Typing filters straight away, except on touch screens, where focusing the field would
    // cover half the list with the on-screen keyboard before anything was asked for.
    useFocusWhenShown(open, () => (isCoarsePointer() ? container.current : search.current));

    const pickModule = async (id: string) => {
        if (loading) return;
        setLoading(id);
        setFailed(null);
        let plugin: ModulePlugin<JsonValue>;
        try {
            plugin = await MODULES[id].load();
        } catch (error) {
            console.error('could not load module ' + id, error);
            if (isOpen.current) setFailed(id);
            else void showAlert(LOAD_FAILED, { title: `Couldn’t add ${MODULES[id].title}` });
            return;
        } finally {
            setLoading(null);
        }
        onPick(plugin);
    };

    const pickGroup = async (file: GroupFile) => {
        onClose();
        try {
            await onPickGroup?.(file);
        } catch (error) {
            showAlert((error as Error).message, { title: 'Couldn’t add the group' });
        }
    };

    const moduleRow = (id: string) => (
        <Item
            key={id}
            title={MODULES[id].title}
            description={MODULES[id].description}
            busy={loading === id}
            disabled={loading !== null && loading !== id}
            error={failed === id ? LOAD_FAILED : undefined}
            onPick={() => void pickModule(id)}
        />
    );
    const groupRow = (file: GroupFile, key: string, description: string) => (
        <Item
            key={key}
            title={file.title}
            description={description}
            disabled={loading !== null}
            onPick={() => void pickGroup(file)}
        />
    );

    const needle = query.trim().toLowerCase();
    const matches = (...texts: (string | undefined)[]) =>
        texts.some((text) => text?.toLowerCase().includes(needle));

    let contents: React.ReactNode;
    if (level === 'groups' && onPickGroup) {
        contents = (
            <GroupsLevel
                library={library}
                onBack={() => setLevel('modules')}
                onPick={(file) => void pickGroup(file)}
            />
        );
    } else if (needle) {
        const modules = MODULE_IDS.filter((id) =>
            matches(MODULES[id].title, MODULES[id].description, MODULE_CATEGORIES[categoryOf(id)])
        );
        const saved = onPickGroup ? library.filter((entry) => matches(entry.file.title)) : [];
        const templates = onPickGroup
            ? EXAMPLE_GROUPS.filter((file) => matches(file.title, exampleGroupDescription(file)))
            : [];
        contents = (
            <>
                {modules.map(moduleRow)}
                {saved.length > 0 && <h3 className="i-section">My groups</h3>}
                {saved.map((entry) => groupRow(entry.file, entry.id, moduleCount(entry.file)))}
                {templates.length > 0 && <h3 className="i-section">Templates</h3>}
                {templates.map((file) => groupRow(file, file.title, templateDescription(file)))}
                {!modules.length && !saved.length && !templates.length && (
                    <p className="i-empty" role="status">
                        Nothing matches “{query.trim()}”.
                    </p>
                )}
            </>
        );
    } else {
        contents = (
            <>
                {onPickGroup && (
                    <Item
                        title="Groups and templates"
                        description="Ready-made letters, chats and AO3 work skins, and groups you saved."
                        opensLevel
                        disabled={loading !== null}
                        onPick={() => setLevel('groups')}
                    />
                )}
                {(Object.keys(MODULE_CATEGORIES) as ModuleCategory[]).map((category) => {
                    const ids = MODULE_IDS.filter((id) => categoryOf(id) === category);
                    if (!ids.length) return null;
                    return (
                        <section key={category} aria-label={MODULE_CATEGORIES[category]}>
                            <h3 className="i-section">{MODULE_CATEGORIES[category]}</h3>
                            {ids.map(moduleRow)}
                        </section>
                    );
                })}
            </>
        );
    }

    /** Arrow keys walk the rows; Enter in the search field adds the first match. */
    const onKeyDown = (event: React.KeyboardEvent) => {
        const root = container.current;
        // keys pressed inside a row's own "⋯" menu belong to that menu
        if (!root || (event.target as Element).closest('[role="menu"]')) return;
        const buttons = [
            ...root.querySelectorAll<HTMLButtonElement>('.i-add-button:not(:disabled)'),
        ];
        if (event.key === 'Enter' && event.target === search.current) {
            event.preventDefault();
            if (needle) buttons[0]?.click();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const at = buttons.indexOf(window.document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
        if (next < 0) search.current?.focus();
        else buttons[Math.min(next, buttons.length - 1)]?.focus();
    };

    return (
        <DirPopover portal open={open} onClose={onClose} anchor={anchor}>
            <div
                className="module-picker-items"
                tabIndex={-1}
                onKeyDown={onKeyDown}
                ref={(node) => {
                    container.current = node;
                    // where the dialog puts focus when it opens (see useFocusWhenShown above)
                    node?.toggleAttribute('autofocus', isCoarsePointer());
                }}
            >
                {level === 'modules' && (
                    <div className="i-search">
                        <input
                            type="search"
                            placeholder={
                                onPickGroup ? 'Search nodes and templates' : 'Search nodes'
                            }
                            aria-label={onPickGroup ? 'Search nodes and templates' : 'Search nodes'}
                            autoComplete="off"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            ref={(node) => {
                                search.current = node;
                                node?.toggleAttribute('autofocus', !isCoarsePointer());
                            }}
                        />
                    </div>
                )}
                {contents}
            </div>
        </DirPopover>
    );
}
export namespace ModulePicker {
    export interface Props {
        open: boolean;
        anchor?: HTMLElement | [number, number] | null;
        onClose: () => void;
        onPick: (m: ModulePlugin<JsonValue>) => void;
        /** Adds a group to the work; enables the "Groups" level. May throw to report a problem. */
        onPickGroup?: (file: GroupFile) => Promise<void> | void;
    }
}

function useLibraryGroups(): LibraryGroup[] {
    const [groups, setGroups] = useState(listLibraryGroups);
    useEffect(() => subscribeLibraryGroups(() => setGroups(listLibraryGroups())), []);
    return groups;
}

const moduleCount = (file: GroupFile) =>
    file.modules.length === 1 ? '1 module' : `${file.modules.length} modules`;

const templateDescription = (file: GroupFile) => exampleGroupDescription(file) ?? moduleCount(file);

function GroupsLevel({
    library,
    onBack,
    onPick,
}: {
    library: LibraryGroup[];
    onBack: () => void;
    onPick: (f: GroupFile) => void;
}) {
    return (
        <>
            <div className="i-level-header">
                <button className="i-back" onClick={onBack} aria-label="Back to all nodes">
                    ‹
                </button>
                <h2>Groups and templates</h2>
                <button
                    className="i-import"
                    onClick={async () => {
                        try {
                            const file = await pickGroupFile();
                            if (file) onPick(file);
                        } catch (error) {
                            showAlert((error as Error).message, {
                                title: 'Couldn’t add the group',
                            });
                        }
                    }}
                >
                    Import file…
                </button>
            </div>
            <h3 className="i-section">My groups</h3>
            {!library.length && (
                <p className="i-empty">
                    Save a group from its ⋯ menu in the graph to reuse it in any work.
                </p>
            )}
            {library.map((entry, i) => (
                <Item
                    key={entry.id}
                    title={entry.file.title}
                    description={moduleCount(entry.file)}
                    onPick={() => onPick(entry.file)}
                    menu={
                        <ActionMenu
                            label={`${entry.file.title} options`}
                            actions={[
                                {
                                    label: 'Move up',
                                    disabled: i === 0,
                                    run: () => moveLibraryGroup(entry.id, i - 1),
                                },
                                {
                                    label: 'Move down',
                                    disabled: i === library.length - 1,
                                    run: () => moveLibraryGroup(entry.id, i + 1),
                                },
                                {
                                    label: 'Export to file…',
                                    run: () => downloadGroupFile(entry.file),
                                },
                                {
                                    label: 'Remove from my groups',
                                    danger: true,
                                    run: () => {
                                        return showConfirm(
                                            `Remove “${entry.file.title}” from My groups? Works that use it keep their copy.`,
                                            { confirmLabel: 'Remove', danger: true }
                                        ).then((yes) => yes && removeLibraryGroup(entry.id));
                                    },
                                },
                            ]}
                        />
                    }
                />
            ))}
            <h3 className="i-section">Templates</h3>
            <p className="i-empty">Ready-made pieces to add to this work, then make your own.</p>
            {EXAMPLE_GROUPS.map((file) => (
                <Item
                    key={file.title}
                    title={file.title}
                    description={templateDescription(file)}
                    onPick={() => onPick(file)}
                />
            ))}
        </>
    );
}

/** One thing that can be added (or a row that opens a further list). The whole row is a target. */
function Item({
    title,
    description,
    onPick,
    opensLevel = false,
    menu,
    busy = false,
    disabled = false,
    error,
}: {
    title: string;
    description: string;
    onPick: () => void;
    /** Opens a further list instead of adding something. */
    opensLevel?: boolean;
    menu?: React.ReactNode;
    /** Being loaded after it was picked. */
    busy?: boolean;
    disabled?: boolean;
    /** Why picking it failed; the row stays, to try again. */
    error?: string;
}) {
    const titleId = useId();

    let buttonLabel = `Add ${title}`;
    if (opensLevel) buttonLabel = `Show ${title}`;
    else if (busy) buttonLabel = `Adding ${title}…`;
    else if (error) buttonLabel = `Try adding ${title} again`;

    return (
        <div
            className={
                'module-picker-item' + (busy ? ' is-busy' : '') + (disabled ? ' is-disabled' : '')
            }
            role="group"
            aria-labelledby={titleId}
            onClick={(event) => {
                const target = event.target as Element;
                // The row's own buttons handle themselves, and so does its "⋯" menu: a dialog
                // inside the row (the picker itself is in a dialog too, around the row).
                const dialog = target.closest('dialog');
                const inOwnMenu = !!dialog && event.currentTarget.contains(dialog);
                if (disabled || inOwnMenu || target.closest('button')) return;
                onPick();
            }}
        >
            <div className="i-details">
                <h4 id={titleId}>{title}</h4>
                <p>{description}</p>
                {error && (
                    <p className="i-error" role="alert">
                        {error}
                    </p>
                )}
            </div>
            {menu}
            <button
                className={'i-add-button' + (opensLevel ? ' is-level' : '')}
                onClick={onPick}
                disabled={disabled}
                aria-busy={busy}
                aria-label={buttonLabel}
            />
        </div>
    );
}
