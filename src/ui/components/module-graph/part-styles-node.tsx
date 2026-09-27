import { Handle, Position } from 'reactflow';
import { useSiteTarget } from '../../../targets/context';
import { MOD_BASE_WIDTH, MOD_HEADER_HEIGHT, MOD_OUTPUT_HEIGHT } from './consts';
const HEIGHT_PROP = '--height' as any;

/**
 * A part's own styles, docked to the right of its output and feeding its CSS input from there.
 * Until the part has styles it is a "+ styles" placeholder that creates them.
 */
export function PartStylesNode({ data }: { data: PartStylesNode.NodeData }) {
    const { partIndex, partCount, selected, hasModule, onCreate } = data;
    const partLabel = useSiteTarget().plugin?.partLabel ?? 'Part';
    const partName =
        partCount > 1 ? `${partLabel} ${partIndex + 1}` : `this ${partLabel.toLowerCase()}`;
    // Named for its part rather than by its module title, which is the same for every part.
    const title = `${partCount > 1 ? partName : partLabel} styles`;

    if (!hasModule) {
        return (
            <button
                className="i-docked-styles-placeholder nodrag"
                style={{ width: MOD_BASE_WIDTH }}
                title={`Add CSS that applies to ${partName} only`}
                onClick={(event) => {
                    event.stopPropagation();
                    onCreate(`${partLabel} styles`);
                }}
            >
                + styles
            </button>
        );
    }

    return (
        <div
            className={'i-module-item is-docked-styles' + (selected ? ' is-selected' : '')}
            aria-label={`${title}, module` + (selected ? ', selected' : '')}
            style={{ width: MOD_BASE_WIDTH }}
        >
            <div className="i-header" style={{ [HEIGHT_PROP]: MOD_HEADER_HEIGHT }}>
                <span className="i-label">{title}</span>
            </div>
            <div className="i-output is-docked" style={{ [HEIGHT_PROP]: MOD_OUTPUT_HEIGHT }}>
                <span className="i-label">CSS</span>
                <Handle id="out" type="source" position={Position.Left} isConnectable={false} />
            </div>
        </div>
    );
}
export namespace PartStylesNode {
    export interface NodeData {
        partIndex: number;
        partCount: number;
        selected: boolean;
        hasModule: boolean;
        onCreate(title: string): void;
    }
}
