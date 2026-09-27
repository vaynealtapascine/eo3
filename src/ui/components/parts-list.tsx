import { Document, ModuleId } from '../../document';
import { copiedKey, targetTitle, useSiteTarget } from '../../targets/context';
import { Ao3Import } from './ao3-import';
import { ActionMenu } from './action-menu';
import { SPLIT_MARKER, splitHtmlAtMarker } from '../../util/split-html';
import './parts-list.css';

/**
 * The work's parts (chapters, posts) in order. Selecting a part shows it in the preview; each
 * part's menu opens its styles, created and wired on first use.
 */
export function PartsList({
    document,
    partId,
    copiedParts,
    onSelectPart,
    onSelectModule,
}: PartsList.Props) {
    const target = useSiteTarget();
    const label = target.plugin?.partLabel ?? 'Part';
    const parts = document.parts;
    const selectedId = parts.find((p) => p.id === partId)?.id ?? parts[0].id;
    // e.g. a detached part-styles module whose part was removed
    const unsentStyles = document.modules.filter(
        (mod) =>
            (mod.data as { language?: unknown } | null)?.language === 'css' &&
            !mod.sends.length &&
            !mod.namedSends.size
    );

    const addPart = async () => {
        const part = await document.addPartWithText(`${label} text`);
        onSelectPart(part.id);
    };

    const openStyles = async (id: string) => {
        const moduleId = await document.partStyles(id, `${label} styles`);
        if (moduleId) onSelectModule(moduleId);
    };

    const removePart = (id: string, index: number) => {
        const message =
            `Remove ${label} ${index + 1}? Its managed styles are removed too; ` +
            'other modules stay, unwired from it.';
        if (window.confirm(message)) document.removePart(id);
    };

    const splitAtBreak = (id: string) => {
        const found = document.splittableContent(id);
        if ('reason' in found) {
            window.alert(found.reason);
            return;
        }
        const split = splitHtmlAtMarker((found.module.data as { contents: string }).contents);
        if (!split) {
            window.alert('Place the break between content on both sides.');
            return;
        }
        const added = document.splitPart(id, split.first, split.second);
        if (added) onSelectPart(added.id);
    };

    const hasBreak = (outputId: string) =>
        document.modules.some(
            (module) =>
                module.sends.includes(outputId) &&
                (module.data as { contents?: unknown } | null)?.contents
                    ?.toString()
                    .includes(SPLIT_MARKER)
        );

    return (
        <section className="parts-list" aria-label={`${label}s`}>
            <header className="i-heading">
                <h2>{label}s</h2>
                <button className="i-add" onClick={addPart}>
                    + add {label.toLowerCase()}
                </button>
            </header>
            <ol className="i-parts">
                {parts.map((part, i) => {
                    const name = `${label} ${i + 1}`;
                    const elsewhere = Object.keys(part.postedTo)
                        .filter((id) => id !== target.id)
                        .map(targetTitle);
                    return (
                        <li
                            key={part.id}
                            className={'i-part' + (part.id === selectedId ? ' is-selected' : '')}
                            onClick={() => onSelectPart(part.id)}
                        >
                            <button
                                className="i-select"
                                aria-pressed={part.id === selectedId}
                                aria-label={`Preview ${name}`}
                                onClick={() => onSelectPart(part.id)}
                            >
                                {i + 1}
                            </button>
                            <input
                                className="i-title"
                                placeholder={`${name} title`}
                                aria-label={`${name} title`}
                                value={part.title}
                                onFocus={() => onSelectPart(part.id)}
                                onChange={(e) =>
                                    document.updatePart(part.id, { title: e.target.value })
                                }
                            />
                            {part.postedTo[target.id] ? (
                                <span
                                    className="i-badge"
                                    title={
                                        `Marked as posted on ${part.postedTo[target.id].at}` +
                                        (elsewhere.length
                                            ? `; also on ${elsewhere.join(', ')}`
                                            : '')
                                    }
                                >
                                    posted
                                </span>
                            ) : copiedParts.includes(copiedKey(target.id, part.id)) ? (
                                <span
                                    className="i-badge is-warning"
                                    title="Copied but not marked as posted; mark it in the preview once it is up"
                                >
                                    not marked
                                </span>
                            ) : elsewhere.length ? (
                                <span
                                    className="i-badge"
                                    title={`Marked as posted on ${elsewhere.join(', ')}`}
                                >
                                    on {elsewhere.join(', ')}
                                </span>
                            ) : null}
                            <ActionMenu
                                label={`${name} actions`}
                                actions={[
                                    {
                                        label: part.stylesModuleId ? 'Edit styles' : 'Add styles',
                                        run: () => openStyles(part.id),
                                    },
                                    !!part.stylesModuleId && {
                                        label: 'Detach styles',
                                        run: () =>
                                            document.updatePart(part.id, { stylesModuleId: null }),
                                    },
                                    hasBreak(part.outputId) && {
                                        label: 'Split at chapter break',
                                        run: () => splitAtBreak(part.id),
                                    },
                                    {
                                        label: 'Move up',
                                        disabled: i === 0,
                                        run: () => document.movePart(part.id, i - 1),
                                    },
                                    {
                                        label: 'Move down',
                                        disabled: i === parts.length - 1,
                                        run: () => document.movePart(part.id, i + 1),
                                    },
                                    {
                                        label: `Remove ${label.toLowerCase()}`,
                                        danger: true,
                                        disabled: parts.length === 1,
                                        run: () => removePart(part.id, i),
                                    },
                                ]}
                            />
                        </li>
                    );
                })}
            </ol>
            {unsentStyles.length > 0 && (
                <p className="i-unsent">
                    {unsentStyles.length === 1
                        ? `A styles module isn’t connected to any ${label.toLowerCase()}, so it does nothing:`
                        : `${
                              unsentStyles.length
                          } styles modules aren’t connected to any ${label.toLowerCase()}, so they do nothing:`}{' '}
                    {unsentStyles.map((mod) => (
                        <button key={mod.id} onClick={() => onSelectModule(mod.id)}>
                            {mod.title || 'CSS'}
                        </button>
                    ))}
                </p>
            )}
            {target.id === 'ao3' && (
                <Ao3Import
                    document={document}
                    onSelectPart={onSelectPart}
                    onSelectModule={onSelectModule}
                />
            )}
        </section>
    );
}

namespace PartsList {
    export interface Props {
        document: Document;
        partId: string | null;
        /** Parts copied this session; unposted ones get a reminder badge. */
        copiedParts: string[];
        onSelectPart: (partId: string) => void;
        onSelectModule: (moduleId: ModuleId) => void;
    }
}
