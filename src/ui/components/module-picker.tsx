import { useEffect, useMemo, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { ModuleDef, MODULES } from '../../plugins';
import { ModulePlugin, JsonValue } from '../../document';
import { GroupFile } from '../../storage/group-file';
import {
    LibraryGroup,
    listLibraryGroups,
    moveLibraryGroup,
    removeLibraryGroup,
    subscribeLibraryGroups,
} from '../../storage/group-library';
import { EXAMPLE_GROUPS } from '../../groups/examples';
import { downloadGroupFile, pickGroupFile } from '../group-files';
import { ActionMenu } from './action-menu';
import './module-picker.css';

/**
 * "add node": module types, plus a "Groups" entry that opens a second level with the
 * author's saved groups, examples, and importing a group file, so the first level stays short.
 */
export function ModulePicker({ open, anchor, onClose, onPick, onPickGroup }: ModulePicker.Props) {
    const [level, setLevel] = useState<'modules' | 'groups'>('modules');
    useEffect(() => {
        if (!open) setLevel('modules');
    }, [open]);

    const pickGroup = async (file: GroupFile) => {
        onClose();
        try {
            await onPickGroup?.(file);
        } catch (error) {
            window.alert((error as Error).message);
        }
    };

    return (
        <DirPopover open={open} onClose={onClose} anchor={anchor}>
            <div className="module-picker-items">
                {level === 'groups' && onPickGroup ? (
                    <GroupsLevel onBack={() => setLevel('modules')} onPick={pickGroup} />
                ) : (
                    <>
                        {onPickGroup && (
                            <Module
                                module={{
                                    title: 'Groups',
                                    description:
                                        'Your saved groups, examples, or a group file to import.',
                                }}
                                opensLevel
                                onPick={() => setLevel('groups')}
                            />
                        )}
                        {Object.keys(MODULES)
                            .filter((moduleId) => !MODULES[moduleId].managed)
                            .map((moduleId) => (
                                <Module
                                    key={moduleId}
                                    module={MODULES[moduleId]}
                                    onPick={async () => {
                                        onPick(await MODULES[moduleId].load());
                                    }}
                                />
                            ))}
                    </>
                )}
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

function GroupsLevel({ onBack, onPick }: { onBack: () => void; onPick: (f: GroupFile) => void }) {
    const library = useLibraryGroups();
    return (
        <>
            <div className="i-level-header">
                <button className="i-back" onClick={onBack} aria-label="Back to all nodes">
                    ‹
                </button>
                <h2>Groups</h2>
                <button
                    className="i-import"
                    onClick={async () => {
                        try {
                            const file = await pickGroupFile();
                            if (file) onPick(file);
                        } catch (error) {
                            window.alert((error as Error).message);
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
                <Module
                    key={entry.id}
                    module={{ title: entry.file.title, description: moduleCount(entry.file) }}
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
                                        if (window.confirm(`Remove “${entry.file.title}”?`))
                                            removeLibraryGroup(entry.id);
                                    },
                                },
                            ]}
                        />
                    }
                />
            ))}
            <h3 className="i-section">Examples</h3>
            {EXAMPLE_GROUPS.map((file) => (
                <Module
                    key={file.title}
                    module={{ title: file.title, description: moduleCount(file) }}
                    onPick={() => onPick(file)}
                />
            ))}
        </>
    );
}

function Module({
    module,
    onPick,
    opensLevel = false,
    menu,
}: {
    module: Pick<ModuleDef, 'title' | 'description'>;
    onPick: () => void;
    /** Opens a further list instead of adding something. */
    opensLevel?: boolean;
    menu?: React.ReactNode;
}) {
    const [titleId] = useMemo(() => Math.random().toString(36), []);

    return (
        <div className="module-picker-item" aria-labelledby={titleId}>
            <div className="i-details">
                <h3 id={titleId}>{module.title}</h3>
                <p>{module.description}</p>
            </div>
            {menu}
            <button
                className={'i-add-button' + (opensLevel ? ' is-level' : '')}
                onClick={onPick}
                aria-label={opensLevel ? `Show ${module.title}` : `Select ${module.title}`}
            />
        </div>
    );
}
