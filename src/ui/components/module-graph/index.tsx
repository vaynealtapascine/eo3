import { createRef, lazy, PureComponent, Suspense } from 'react';
import {
    ChangeType,
    Document,
    Module,
    ModuleId,
    RenderState,
    isPartOutput,
} from '../../../document';
import {
    Connection,
    EdgeChange,
    NodeChange,
    NodePositionChange,
    NodeRemoveChange,
    OnConnectStartParams,
    ReactFlowInstance,
} from 'reactflow';
import { collapsedStyles, getNodeHeight, GROUP_HEADER_HEIGHT, layoutNodes } from './auto-layout';
import {
    connectionId,
    groupCards,
    isGroupNode,
    routeEdge,
    translateGroupMembers,
} from './group-cards';
import { GRID_SIZE, MIN_COL_GAP, MIN_ROW_GAP, MOD_BASE_WIDTH } from './consts';
import { ModulePicker } from '../module-picker';
import 'reactflow/dist/style.css';
import './index.css';
import { Button } from '../../../uikit/button';

export type EdgeId = string;

const GROUP_FRAME_PADDING = 8;

const ReactFlow = lazy(() => import('./reactflow'));

export class ModuleGraph extends PureComponent<ModuleGraph.Props> {
    state = {
        draggingNode: false,
        addingModule: false,
        modulePickerAnchor: null,
        groupSelection: [] as ModuleId[],
        groupDragPosition: null as {
            nodeId: string;
            position: { x: number; y: number };
        } | null,
        /** Group instances shown as their member nodes; the rest are one card each. */
        expandedGroups: [] as string[],
    };

    toggleGroup(instanceId: string) {
        const expanded = this.state.expandedGroups;
        this.setState({
            expandedGroups: expanded.includes(instanceId)
                ? expanded.filter((id) => id !== instanceId)
                : [...expanded, instanceId],
        });
    }

    private selectionChangeFromGraph: ModuleId | EdgeId | null = null;

    componentDidUpdate(previous: ModuleGraph.Props) {
        if (previous.selected === this.props.selected) return;
        if (
            this.selectionChangeFromGraph !== this.props.selected &&
            this.state.groupSelection.length
        ) {
            this.setState({ groupSelection: [] });
        }
        this.selectionChangeFromGraph = null;
    }

    containerNode = createRef<HTMLDivElement>();
    addModuleButton = createRef<Button>();
    reactFlow: ReactFlowInstance | null = null;
    modulePositions = new Map<ModuleId, { x: number; y: number }>();
    groupDrag: {
        nodeId: string;
        origin: { x: number; y: number };
        members: ModuleId[];
        positions: Map<ModuleId, { x: number; y: number }>;
    } | null = null;

    onNodeDragStart = (node: { id: string; position: { x: number; y: number } }) => {
        if (isGroupNode(node.id)) {
            const hidden = collapsedStyles(this.props.document);
            const { cards } = groupCards(this.props.document, hidden, this.state.expandedGroups);
            const card = cards.find((item) => item.nodeId === node.id);
            if (card && !card.expanded) {
                this.groupDrag = {
                    nodeId: node.id,
                    origin: { ...node.position },
                    members: card.members,
                    positions: new Map(this.modulePositions),
                };
            }
        }
        this.setState({
            draggingNode: true,
            groupDragPosition: this.groupDrag
                ? { nodeId: node.id, position: { ...node.position } }
                : null,
        });
    };

    onNodeDragStop = (node: { id: string; position: { x: number; y: number } }) => {
        const drag = this.groupDrag;
        this.groupDrag = null;
        if (drag?.nodeId === node.id) {
            const delta = {
                x: node.position.x - drag.origin.x,
                y: node.position.y - drag.origin.y,
            };
            if (delta.x || delta.y) {
                this.props.document.pushModulesState(
                    translateGroupMembers(
                        this.props.document.modules,
                        drag.members,
                        drag.positions,
                        delta
                    ),
                    { type: ChangeType.RearrangeModules }
                );
            }
        }
        this.setState({ draggingNode: false, groupDragPosition: null });
    };

    onReactFlowInit = (instance: ReactFlowInstance) => {
        this.reactFlow = instance;
    };

    onConnect = ({ source, target, targetHandle }: Connection) => {
        if (!source || !target || !targetHandle) return;

        if (targetHandle === 'in') {
            this.insertConnection(source, target);
        } else if (targetHandle === 'named-new') {
            this.insertNewNamedConnection(source, target);
        } else if (targetHandle.startsWith('named-in-')) {
            // duplicate named inputs make no sense
            return;
        }
    };

    insertConnection(source: ModuleId, target: ModuleId) {
        const { document } = this.props;

        let sourceModule = document.findModule(source);
        const targetModule = document.findModule(target);
        if (!sourceModule || (!isPartOutput(target) && !targetModule)) return;
        if (sourceModule.sends.includes(target)) return;
        if (!isPartOutput(target) && !targetModule?.plugin?.acceptsInputs) return;

        sourceModule = sourceModule.shallowClone();
        sourceModule.sends = [...sourceModule.sends];
        sourceModule.sends.push(target);
        document.insertModule(sourceModule);
    }

    insertNewNamedConnection(source: ModuleId, target: ModuleId) {
        const { document } = this.props;
        let sourceModule = document.findModule(source);
        const targetModule = document.findModule(target);
        if (!sourceModule || !targetModule) return;
        if (!targetModule.plugin.acceptsNamedInputs) return;

        const name = prompt('Enter side input name');
        if (!name) return;

        sourceModule = sourceModule.shallowClone();
        if (!sourceModule.namedSends.has(target)) {
            sourceModule.namedSends = new Map(sourceModule.namedSends);
            sourceModule.namedSends.set(target, new Set());
        }
        sourceModule.namedSends.set(target, new Set(sourceModule.namedSends.get(target)));
        sourceModule.namedSends.get(target)!.add(name);
        document.insertModule(sourceModule);
    }

    currentConnectionParams: OnConnectStartParams | null = null;
    graphPosForNextAdd: [number, number] | null = null;
    connectionForNextAdd: [string, ModuleId] | null = null;

    onConnectStart = (_e: unknown, params: OnConnectStartParams) => {
        this.currentConnectionParams = params;
    };

    onConnectEnd = (e: any) => {
        const isPaneDrop = e.target.classList?.contains('react-flow__pane');
        if (!isPaneDrop) return;

        const params = this.currentConnectionParams;
        if (!params?.nodeId) return;
        if (params.handleId === 'out') {
            this.connectionForNextAdd = ['out', params.nodeId];
        } else if (params.handleId === 'in') {
            this.connectionForNextAdd = ['in', params.nodeId];
        } else if (params.handleId === 'named-new') {
            this.connectionForNextAdd = ['named', params.nodeId];
        } else {
            // invalid: cannot create a new connection
            return;
        }

        const { top, left } = this.containerNode.current!.getBoundingClientRect();
        const projected = this.reactFlow!.project({
            x: e.clientX - left,
            y: e.clientY - top,
        });

        const nodeX = Math.floor((projected.x - MOD_BASE_WIDTH / 2) / GRID_SIZE) * GRID_SIZE;
        const nodeY = Math.floor(projected.y / GRID_SIZE) * GRID_SIZE;
        this.graphPosForNextAdd = [nodeX, nodeY];
        this.setState({
            addingModule: true,
            modulePickerAnchor: [e.clientX, e.clientY],
        });
    };

    getNewCenteredNodePos = () => {
        const { width, height } = this.containerNode.current!.getBoundingClientRect();
        const projected = this.reactFlow!.project({
            x: width / 2,
            y: height / 2,
        });
        const nodeX = Math.floor((projected.x - MOD_BASE_WIDTH / 2) / GRID_SIZE) * GRID_SIZE;
        const nodeY = Math.floor(projected.y / GRID_SIZE) * GRID_SIZE;
        return [nodeX, nodeY] as [number, number];
    };

    onAddModule = (plugin: any) => {
        const { document } = this.props;

        this.setState({ addingModule: false });

        const module = new Module(plugin);
        if (this.graphPosForNextAdd) {
            module.graphPos = {
                x: this.graphPosForNextAdd[0],
                y: this.graphPosForNextAdd[1],
            };
            this.graphPosForNextAdd = null;
        }
        document.insertModule(module);

        if (this.connectionForNextAdd) {
            const [type, otherModuleId] = this.connectionForNextAdd;
            this.connectionForNextAdd = null;

            const batch = document.beginBatch();
            if (type === 'out') {
                this.insertConnection(otherModuleId, module.id);
            } else if (type === 'in') {
                this.insertConnection(module.id, otherModuleId);
            } else if (type === 'named') {
                this.insertNewNamedConnection(module.id, otherModuleId);
            }
            batch.end();
        }

        this.props.onSelect(module.id);
    };

    onNodesChange = (changes: NodeChange[]) => {
        let newSelected = this.props.selected;
        const groupSelection = new Set(this.state.groupSelection);
        let groupSelectionChanged = false;
        const nodePositionChanges: NodePositionChange[] = [];
        const nodeRemoveChanges: NodeRemoveChange[] = [];

        for (const change of changes) {
            if ('id' in change && isGroupNode(change.id)) {
                if (
                    change.type === 'position' &&
                    change.position &&
                    this.groupDrag?.nodeId === change.id
                ) {
                    this.setState({
                        groupDragPosition: { nodeId: change.id, position: change.position },
                    });
                }
                continue;
            }
            if (change.type === 'select') {
                if (change.selected && !isPartOutput(change.id)) {
                    newSelected = change.id;
                    groupSelection.add(change.id);
                    groupSelectionChanged = true;
                } else if (!change.selected && newSelected === change.id) {
                    newSelected = null;
                    groupSelection.delete(change.id);
                    groupSelectionChanged = true;
                } else if (!change.selected) {
                    groupSelection.delete(change.id);
                    groupSelectionChanged = true;
                }
            } else if (change.type === 'position') {
                nodePositionChanges.push(change);
            } else if (change.type === 'remove') {
                nodeRemoveChanges.push(change);
                groupSelection.delete(change.id);
                groupSelectionChanged = true;
            }
        }

        if (groupSelectionChanged) this.setState({ groupSelection: [...groupSelection] });
        if (newSelected !== this.props.selected) {
            this.selectionChangeFromGraph = newSelected;
            this.props.onSelect(newSelected);
        }

        if (nodePositionChanges.length || nodeRemoveChanges.length) {
            const { document } = this.props;

            for (const change of nodePositionChanges) {
                const module = document.findModule(change.id);
                if (!module || !change.position) continue;
                const newModule = module.shallowClone();
                newModule.graphPos = change.position;
                document.insertModule(newModule);
            }

            for (const change of nodeRemoveChanges) {
                document.removeModule(change.id);
            }
        }
    };

    onEdgesChange = (changes: EdgeChange[]) => {
        let newSelected = this.props.selected;
        const edgesToRemove: EdgeId[] = [];

        for (const change of changes) {
            if (change.type !== 'select' && change.type !== 'remove') continue;
            const id = connectionId(change.id);
            if (change.type === 'select') {
                if (change.selected) {
                    newSelected = id;
                } else if (!change.selected && newSelected === id) {
                    newSelected = null;
                }
            } else {
                edgesToRemove.push(id);
            }
        }

        if (newSelected !== this.props.selected) this.props.onSelect(newSelected);

        const { document } = this.props;
        if (edgesToRemove.length) {
            const edges = getConnections(document, null);

            for (const edgeId of edgesToRemove) {
                const edge = edges.find((item) => item.id === edgeId);
                if (!edge) continue;

                let module = document.findModule(edge.source);
                if (!module) continue;
                module = module.shallowClone();
                document.insertModule(module);

                if (edge.targetHandle === 'in') {
                    module.sends = [...module.sends];
                    const targetIndex = module.sends.indexOf(edge.target);
                    if (targetIndex > -1) module.sends.splice(targetIndex, 1);
                } else if (edge.targetHandle.startsWith('named-in-')) {
                    const { name } = edge.data;
                    if (!module.namedSends.has(edge.target)) continue;
                    module.namedSends.set(edge.target, new Set(module.namedSends.get(edge.target)));
                    module.namedSends.get(edge.target)!.delete(name);

                    if (!module.namedSends.get(edge.target)!.size) {
                        module.namedSends = new Map(module.namedSends);
                        module.namedSends.delete(edge.target);
                    }
                }
            }
        }
    };

    runAutoLayout = () => {
        const { document } = this.props;

        const hasManualLayout = document.modules.find((m) => !!m.graphPos);
        if (!hasManualLayout) return;

        document.pushModulesState(
            document.modules.map((m) => {
                m = m.shallowClone();
                m.graphPos = null;
                return m;
            }),
            { type: ChangeType.RearrangeModules }
        );
    };

    render() {
        const { document, selected, render } = this.props;
        const hidden = collapsedStyles(document);
        const groups = groupCards(document, hidden, this.state.expandedGroups);
        const { cards, collapsedInto } = groups;
        const layout = layoutNodes(document, groups);
        const nodes: any[] = [];
        const groupablePart = document.groupablePart(this.state.groupSelection);

        const colStride = Math.ceil((MOD_BASE_WIDTH + MIN_COL_GAP) / GRID_SIZE) * GRID_SIZE;
        const maxLayoutX = (layout.columns.length - 1) * colStride;
        const autoLayoutPos = (id: string) => {
            const nodeLayout = layout.layouts.get(id)!;
            return { x: nodeLayout.column * colStride - maxLayoutX, y: nodeLayout.y };
        };
        const positions = new Map<ModuleId, { x: number; y: number }>();

        for (const module of document.modules) {
            if (hidden.has(module.id) || collapsedInto.has(module.id)) continue;
            const nodeLayout = layout.layouts.get(module.id)!;
            const output = render?.output ? render.output.outputs.get(module.id) || null : null;
            const error =
                render?.error && render.error.source === module.id ? render.error.error : null;
            const selected =
                this.state.groupSelection.includes(module.id) || module.id === this.props.selected;

            const autoPos = autoLayoutPos(module.id);
            if (module.graphPos?.x === autoPos.x && module.graphPos?.y === autoPos.y) {
                module.graphPos = null;
            }
            positions.set(module.id, module.graphPos || autoPos);

            nodes.push({
                id: module.id,
                position: module.graphPos || autoPos,
                type: 'module',
                selected,
                data: {
                    index: layout.indices.get(module.id)!,
                    module,
                    namedInputs: nodeLayout.namedInputs,
                    selected,
                    currentOutput: output,
                    currentError: error,
                },
            });
        }

        for (const card of cards) {
            const { instanceId, members, nodeId, title } = card;
            const onToggle = () => this.toggleGroup(instanceId);

            if (card.expanded) {
                // A frame around the members, with its header in the room layout left above them.
                const boxes = members.map((id) => ({
                    ...positions.get(id)!,
                    bottom: positions.get(id)!.y + layout.layouts.get(id)!.height,
                }));
                const left = Math.min(...boxes.map((b) => b.x)) - GROUP_FRAME_PADDING;
                const top = Math.min(...boxes.map((b) => b.y)) - GROUP_HEADER_HEIGHT;
                const right =
                    Math.max(...boxes.map((b) => b.x)) + MOD_BASE_WIDTH + GROUP_FRAME_PADDING;
                const bottom = Math.max(...boxes.map((b) => b.bottom)) + GROUP_FRAME_PADDING;
                nodes.push({
                    id: nodeId,
                    position: { x: left, y: top },
                    type: 'groupFrame',
                    zIndex: -1,
                    draggable: false,
                    selectable: false,
                    deletable: false,
                    data: { title, width: right - left, height: bottom - top, onToggle },
                });
                continue;
            }

            // The card sits where its first member is, so dragging it moves them all together.
            const anchor = document.findModule(members[0])!;
            const cardPos = anchor.graphPos ?? autoLayoutPos(nodeId);
            let memberY = cardPos.y;
            for (const id of members) {
                const module = document.findModule(id)!;
                positions.set(id, module.graphPos ?? { x: cardPos.x, y: memberY });
                memberY += getNodeHeight(document, module) + MIN_ROW_GAP;
            }
            const transient = this.state.groupDragPosition;
            const outputData = new Map(
                members.flatMap((id) => {
                    const data = render?.output?.outputs.get(id);
                    return data ? [[id, data] as const] : [];
                })
            );
            nodes.push({
                id: nodeId,
                position: transient?.nodeId === nodeId ? transient.position : cardPos,
                type: 'group',
                deletable: false,
                data: {
                    title,
                    memberCount: members.length,
                    inputs: card.inputs,
                    outputs: card.outputs,
                    outputData,
                    selected: !!selected && members.includes(selected),
                    onToggle,
                },
            });
        }
        this.modulePositions = positions;

        const renderedParts = render.output?.work?.parts;
        document.parts.forEach((part, i) => {
            const outputLayout = layout.layouts.get(part.outputId)!;
            nodes.push({
                id: part.outputId,
                position: { x: 0, y: outputLayout.y },
                type: 'modOutput',
                data: {
                    hasOutput: !!renderedParts?.find((p) => p.id === part.id)?.content,
                    partIndex: i,
                    partTitle: part.title,
                    partCount: document.parts.length,
                    hasStyles: !!part.stylesModuleId,
                    openStyles: async (title: string) => {
                        const id = await document.partStyles(part.id, title);
                        if (id) this.props.onSelect(id);
                    },
                },
            });
        });

        const edges = getConnections(document, selected).flatMap((edge) => {
            if (hidden.has(edge.source) || hidden.has(edge.target)) return [];
            return routeEdge(edge, collapsedInto) ?? [];
        });

        return (
            <div
                className={'module-graph' + (this.state.draggingNode ? ' is-dragging-node' : '')}
                aria-label="Module Graph"
                ref={this.containerNode}
            >
                <Suspense fallback={<div>Loading…</div>}>
                    <ReactFlow
                        fitView
                        snapToGrid
                        snapGrid={[GRID_SIZE, GRID_SIZE]}
                        panOnScroll
                        panOnScrollSpeed={1}
                        nodes={nodes}
                        edges={edges}
                        onInit={this.onReactFlowInit}
                        onNodesChange={this.onNodesChange}
                        onEdgesChange={this.onEdgesChange}
                        onConnect={this.onConnect}
                        onConnectStart={this.onConnectStart}
                        onConnectEnd={this.onConnectEnd}
                        onNodeDragStart={(_event, node) => this.onNodeDragStart(node)}
                        onNodeDragStop={(_event, node) => this.onNodeDragStop(node)}
                        multiSelectionKeyCode={['Meta', 'Control']}
                    />
                </Suspense>
                <div className="i-actions">
                    <Button run={this.runAutoLayout}>auto layout</Button>{' '}
                    {this.state.groupSelection.length > 1 && (
                        <Button
                            disabled={!groupablePart}
                            title={
                                groupablePart
                                    ? 'Make these nodes reusable in other parts'
                                    : 'Select nodes that connect only to each other and one part output'
                            }
                            run={() => {
                                if (!groupablePart) return;
                                const title = window.prompt('Name this reusable group');
                                if (!title?.trim()) return;
                                document.createGroup(
                                    title.trim(),
                                    groupablePart.id,
                                    this.state.groupSelection
                                );
                                this.setState({ groupSelection: [] });
                            }}
                        >
                            group {this.state.groupSelection.length} nodes
                        </Button>
                    )}{' '}
                    <Button
                        ref={this.addModuleButton}
                        run={() => {
                            this.graphPosForNextAdd = this.getNewCenteredNodePos();
                            this.setState({ addingModule: true, modulePickerAnchor: null });
                        }}
                    >
                        add node
                    </Button>
                    <ModulePicker
                        anchor={this.state.modulePickerAnchor || this.addModuleButton.current?.node}
                        open={this.state.addingModule}
                        onClose={() => this.setState({ addingModule: false })}
                        onPick={this.onAddModule}
                    />
                </div>
            </div>
        );
    }
}

namespace ModuleGraph {
    export interface Props {
        document: Document;
        selected: ModuleId | EdgeId | null;
        render: RenderState;
        onSelect: (m: ModuleId | EdgeId | null) => void;
    }
}

function getConnections(document: Document, selected: ModuleId | EdgeId | null) {
    const connections: any[] = [];

    const modDescriptions = new Map<ModuleId, string>();
    document.parts.forEach((part, i) => {
        modDescriptions.set(
            part.outputId,
            document.parts.length > 1 ? `part ${i + 1} output` : 'output'
        );
    });

    let modIndex = 1;
    for (const mod of document.modules) {
        modDescriptions.set(mod.id, modIndex + ' ' + mod.plugin.description(mod.data));
        modIndex++;
    }

    for (const mod of document.modules) {
        const ownDesc = modDescriptions.get(mod.id);

        for (const target of mod.sends) {
            const highlighted = selected === mod.id || selected === target;
            const edgeId = `${mod.id}->${target}`;
            connections.push({
                id: edgeId,
                source: mod.id,
                target,
                sourceHandle: 'out',
                targetHandle: 'in',
                className: 'i-connection' + (highlighted ? ' is-highlighted' : ''),
                selected: selected === edgeId,
                ariaLabel:
                    `Send ${ownDesc} to ${modDescriptions.get(target)} input` +
                    (selected === edgeId ? ', selected' : ''),
            });
        }

        for (const [target, names] of mod.namedSends) {
            for (const name of names) {
                const highlighted = selected === mod.id || selected === target;
                const edgeId = `${mod.id}-(${name})>${target}`;
                connections.push({
                    id: edgeId,
                    source: mod.id,
                    target,
                    sourceHandle: 'out',
                    targetHandle: `named-in-${name}`,
                    className: 'i-connection' + (highlighted ? ' is-highlighted' : ''),
                    selected: selected === edgeId,
                    data: { name },
                    ariaLabel:
                        `Provide ${ownDesc} to ${modDescriptions.get(
                            target
                        )} named input “${name}”` + (selected === edgeId ? ', selected' : ''),
                });
            }
        }
    }

    return connections;
}
