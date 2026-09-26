import { Document, ModuleId } from '../../document';
import { useSiteTarget } from '../../targets/context';
import { Ao3Import } from './ao3-import';
import './parts-list.css';

/**
 * The work's parts (chapters, posts) in order. Selecting a part shows it in the preview; each
 * part links to its styles module, which is created and wired on first use.
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
    const selectedId = parts.some((p) => p.id === partId) ? partId : parts[0].id;

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

    return (
        <section className="parts-list" aria-label={`${label}s`}>
            <ol className="i-parts">
                {parts.map((part, i) => (
                    <li
                        key={part.id}
                        className={'i-part' + (part.id === selectedId ? ' is-selected' : '')}
                    >
                        <button
                            className="i-select"
                            aria-pressed={part.id === selectedId}
                            aria-label={`Preview ${label} ${i + 1}`}
                            onClick={() => onSelectPart(part.id)}
                        >
                            {label} {i + 1}
                        </button>
                        <input
                            className="i-title"
                            placeholder="title"
                            aria-label={`${label} ${i + 1} title`}
                            value={part.title}
                            onFocus={() => onSelectPart(part.id)}
                            onChange={(e) =>
                                document.updatePart(part.id, { title: e.target.value })
                            }
                        />
                        {part.posted ? (
                            <span
                                className="i-badge"
                                title={`Marked as posted on ${part.posted.at}`}
                            >
                                posted
                            </span>
                        ) : copiedParts.includes(part.id) ? (
                            <span
                                className="i-badge is-warning"
                                title="Copied but not marked as posted; mark it in the preview once it's up"
                            >
                                not marked posted
                            </span>
                        ) : null}
                        <span className="i-actions">
                            <button
                                onClick={() => openStyles(part.id)}
                                title={`CSS that applies to this ${label.toLowerCase()} only`}
                            >
                                styles
                            </button>
                            {part.stylesModuleId && (
                                <button
                                    onClick={() =>
                                        document.updatePart(part.id, { stylesModuleId: null })
                                    }
                                    title="Stop managing the styles module; it stays in the graph for you to rewire"
                                >
                                    detach
                                </button>
                            )}
                            <button
                                aria-label={`Move ${label} ${i + 1} up`}
                                disabled={i === 0}
                                onClick={() => document.movePart(part.id, i - 1)}
                            >
                                ↑
                            </button>
                            <button
                                aria-label={`Move ${label} ${i + 1} down`}
                                disabled={i === parts.length - 1}
                                onClick={() => document.movePart(part.id, i + 1)}
                            >
                                ↓
                            </button>
                            <button
                                aria-label={`Remove ${label} ${i + 1}`}
                                disabled={parts.length === 1}
                                onClick={() => removePart(part.id, i)}
                            >
                                ×
                            </button>
                        </span>
                    </li>
                ))}
            </ol>
            <button className="i-add" onClick={addPart}>
                + add {label.toLowerCase()}
            </button>
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
