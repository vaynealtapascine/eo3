import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals } from 'reactflow';
import { Data } from '../../../document';
import { MOD_BASE_WIDTH, MOD_HEADER_HEIGHT, MOD_INPUT_HEIGHT, MOD_OUTPUT_HEIGHT } from './consts';
import { GroupPort } from './group-cards';
import { ActionMenu } from '../action-menu';
import { useSiteTarget } from '../../../targets/context';
const HEIGHT_PROP = '--height' as any;

/** A collapsed group, drawn like a module: its rows are the links crossing the group's edge. */
export function GroupNode({ id, data }: { id: string; data: GroupNode.NodeData }) {
    const { title, memberCount, inputs, outputs, outputData, selected, sharing, onToggle } = data;
    const updateNodeInternals = useUpdateNodeInternals();
    const handles = [...inputs, ...outputs].map((port) => port.handle).join(' ');
    useEffect(() => updateNodeInternals(id), [handles]);

    return (
        <div
            className={'i-module-item is-group' + (selected ? ' is-selected' : '')}
            aria-label={
                `${title}, group of ${memberCount} modules` + (selected ? ', selected' : '')
            }
            style={{ width: MOD_BASE_WIDTH }}
        >
            <div className="i-header" style={{ [HEIGHT_PROP]: MOD_HEADER_HEIGHT }}>
                <GroupToggle title={title} expanded={false} onToggle={onToggle} />
                <span className="i-label">{title}</span>
                <GroupMenu title={title} sharing={sharing} />
            </div>
            {inputs.map((port) => (
                <div
                    key={port.handle}
                    className="i-input"
                    style={{ [HEIGHT_PROP]: MOD_INPUT_HEIGHT }}
                    title={`Input to ${port.label}`}
                >
                    <span className="i-label">{port.label}</span>
                    <Handle
                        id={port.handle}
                        type="target"
                        position={Position.Left}
                        isConnectable={false}
                    />
                </div>
            ))}
            {outputs.map((port) => {
                const type = outputData.get(port.memberId)?.typeDescription();
                const label =
                    type && type.toLowerCase() !== port.label.toLowerCase()
                        ? `${port.label} · ${type}`
                        : port.label;
                return (
                    <div
                        key={port.handle}
                        className="i-output"
                        style={{ [HEIGHT_PROP]: MOD_OUTPUT_HEIGHT }}
                        title={`Output of ${port.label}`}
                    >
                        <span className="i-label">{label}</span>
                        <Handle
                            id={port.handle}
                            type="source"
                            position={Position.Right}
                            isConnectable={false}
                        />
                    </div>
                );
            })}
            {!outputs.length && (
                <div className="i-output is-empty" style={{ [HEIGHT_PROP]: MOD_OUTPUT_HEIGHT }}>
                    <span className="i-label">not connected</span>
                </div>
            )}
        </div>
    );
}
export namespace GroupNode {
    export interface NodeData {
        title: string;
        memberCount: number;
        inputs: GroupPort[];
        outputs: GroupPort[];
        outputData: Map<string, Data>;
        selected: boolean;
        sharing: GroupSharing;
        onToggle(): void;
    }
}

/** How a group instance shares its definition, and the actions for that. */
export interface GroupSharing {
    /** Instances using the same definition, this one included. */
    count: number;
    /** Indices of the parts it can be copied to. */
    otherParts: { id: string; index: number }[];
    onCopy(partId: string): void;
    onDetach(): void;
}

function GroupMenu({ title, sharing }: { title: string; sharing: GroupSharing }) {
    const partLabel = useSiteTarget().plugin?.partLabel ?? 'Part';
    return (
        <ActionMenu
            className="i-group-menu nodrag"
            label={`${title} actions`}
            note={
                sharing.count > 1
                    ? `Shared by ${sharing.count} uses: editing one edits all.`
                    : 'Not shared with other uses.'
            }
            actions={[
                ...sharing.otherParts.map((part) => ({
                    label: `Use in ${partLabel} ${part.index + 1}`,
                    run: () => sharing.onCopy(part.id),
                })),
                sharing.count > 1 && {
                    label: 'Detach: edit this one separately',
                    run: sharing.onDetach,
                },
            ]}
        />
    );
}

/** An expanded group: a frame behind its members, with a header to collapse it again. */
export function GroupFrame({ data }: { data: GroupFrame.NodeData }) {
    const { title, width, height, sharing, onToggle } = data;
    return (
        <div className="i-group-frame" style={{ width, height }}>
            <div className="i-group-header">
                <GroupToggle title={title} expanded onToggle={onToggle} />
                <span className="i-label">{title}</span>
                <GroupMenu title={title} sharing={sharing} />
            </div>
        </div>
    );
}
export namespace GroupFrame {
    export interface NodeData {
        title: string;
        width: number;
        height: number;
        sharing: GroupSharing;
        onToggle(): void;
    }
}

function GroupToggle({
    title,
    expanded,
    onToggle,
}: {
    title: string;
    expanded: boolean;
    onToggle(): void;
}) {
    return (
        <button
            className="i-group-toggle nodrag"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${title}` : `Show the modules in ${title}`}
            title={expanded ? 'Collapse into one card' : 'Show the modules inside'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
        >
            {expanded ? '▾' : '▸'}
        </button>
    );
}
