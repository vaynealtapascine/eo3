import { useMemo } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { ModuleDef, MODULES } from '../../plugins';
import { EFFECTS, EffectKey } from '../../effects';
import { Document, ModuleId, ModulePlugin, JsonValue } from '../../document';
import { useSiteTarget } from '../../targets/context';
import './module-picker.css';

export function ModulePicker({ open, anchor, onClose, onPick, effects }: ModulePicker.Props) {
    const partLabel = useSiteTarget().plugin?.partLabel ?? 'Part';
    const partIndex = effects
        ? effects.document.parts.findIndex((p) => p.id === effects.partId)
        : -1;
    const partName =
        effects && effects.document.parts.length > 1
            ? `${partLabel} ${partIndex + 1}`
            : `this ${partLabel.toLowerCase()}`;
    return (
        <DirPopover open={open} onClose={onClose} anchor={anchor}>
            <div className="module-picker-items">
                {effects && partIndex !== -1 && (
                    <>
                        <h2 className="i-section">Effects</h2>
                        {Object.entries(EFFECTS).map(([key, effect]) => (
                            <Module
                                key={key}
                                module={{
                                    title: effect.title,
                                    description: `Editable HTML and CSS, added to ${partName}.`,
                                }}
                                onPick={async () => {
                                    const instance = await effects.document.addPackagedEffect(
                                        key as EffectKey,
                                        effects.partId
                                    );
                                    onClose();
                                    if (instance) effects.onAdded(instance.moduleIds[0]);
                                }}
                            />
                        ))}
                        <h2 className="i-section">Nodes</h2>
                    </>
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
        /** Offer packaged effects first, added to this part as a group. */
        effects?: { document: Document; partId: string; onAdded: (first: ModuleId) => void };
    }
}

function Module({
    module,
    onPick,
}: {
    module: Pick<ModuleDef, 'title' | 'description'>;
    onPick: () => void;
}) {
    const [titleId] = useMemo(() => Math.random().toString(36), []);

    return (
        <div className="module-picker-item" aria-labelledby={titleId}>
            <div className="i-details">
                <h3 id={titleId}>{module.title}</h3>
                <p>{module.description}</p>
            </div>
            <button
                className="i-add-button"
                onClick={onPick}
                aria-label={`Select ${module.title}`}
            />
        </div>
    );
}
