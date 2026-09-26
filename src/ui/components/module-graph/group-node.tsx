import { Handle, Position } from 'reactflow';
import { MOD_BASE_WIDTH, MOD_HEADER_HEIGHT, MOD_OUTPUT_HEIGHT } from './consts';
const HEIGHT_PROP = '--height' as any;

/** A group instance: one card while collapsed, or a label above its members while expanded. */
export function GroupNode({ data }: { data: GroupNode.NodeData }) {
    const { title, memberCount, expanded, selected, onToggle } = data;
    const toggle = (
        <button
            className="i-group-toggle nodrag"
            aria-expanded={expanded}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
        >
            {expanded ? `▾ ${title}` : `show ${memberCount} nodes`}
        </button>
    );

    if (expanded) return <div className="i-group-label">{toggle}</div>;

    return (
        <div
            className={'i-module-item is-group' + (selected ? ' is-selected' : '')}
            aria-label={`${title}, group of ${memberCount} nodes` + (selected ? ', selected' : '')}
            style={{ width: MOD_BASE_WIDTH }}
        >
            <div className="i-header" style={{ [HEIGHT_PROP]: MOD_HEADER_HEIGHT }}>
                <span className="i-label">{title}</span>
            </div>
            <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
            <div className="i-output" style={{ [HEIGHT_PROP]: MOD_OUTPUT_HEIGHT }}>
                {toggle}
                <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
            </div>
        </div>
    );
}
export namespace GroupNode {
    export interface NodeData {
        title: string;
        memberCount: number;
        expanded: boolean;
        selected: boolean;
        onToggle(): void;
    }
}
