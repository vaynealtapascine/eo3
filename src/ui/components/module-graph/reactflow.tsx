import InnerReactFlow, { Controls, Background, ReactFlowProps } from 'reactflow';
import { GRID_SIZE } from './consts';
import { ModuleNode } from './module-node';
import { OutputNode } from './output-node';
import { GroupFrame, GroupNode } from './group-node';
import { PartStylesNode } from './part-styles-node';

const nodeTypes = {
    module: ModuleNode,
    modOutput: OutputNode,
    groupCard: GroupNode,
    groupFrame: GroupFrame,
    partStyles: PartStylesNode,
};

export default function ReactFlow(props: ReactFlowProps) {
    return (
        <InnerReactFlow nodeTypes={nodeTypes} {...props}>
            <Controls />
            <Background gap={GRID_SIZE} />
        </InnerReactFlow>
    );
}
