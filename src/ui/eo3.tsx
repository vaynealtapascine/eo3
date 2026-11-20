import { createRef, PureComponent } from 'react';
import { SplitPanel } from './components/split-panel';
import { ModuleList } from './components/module-list';
import { partListing, revealSimpleItem, SimpleEditor } from './components/simple-editor';
import type { EditorView } from './editor-view';
import { PartsList } from './components/parts-list';
import { ModuleGraph, EdgeId } from './components/module-graph';
import { Preview } from './components/preview';
import { Document, ModuleId, RenderOutput, RenderState } from '../document';
import { RenderContext } from './render-context';
import { EditorCanvasContext, type EditorCanvasContextValue } from './editor-canvas-context';
import { collectPartLiveCss, ensurePieceCssInDocument } from '../editor/work-styles';
import type { CssPiece } from '../editor/css-pieces';
import { renderInputs, sameRenderInputs } from './render-inputs';
import { SiteTargetProvider } from '../targets/context';
// @ts-ignore
import { homepage as sourceLink } from '../../package.json';
import './eo3.scss';

interface Eo3State {
    render: RenderState;
    clickToRender: boolean;
    /** With Live Update off: the work changed since the render on screen. */
    stale: boolean;
    selected: ModuleId | EdgeId | null;
    /** The part shown in the post preview; null = the first part. */
    partId: string | null;
    /** Parts whose output was copied this session; unmarked ones get a reminder. */
    copiedParts: string[];
    /** Phone-sized viewport: show one pane at a time instead of split panels. */
    compact: boolean;
    /** The pane shown in compact mode. */
    pane: CompactPane;
    /** In Simple view on desktop: whether the left technical panel is expanded. */
    simplePanelOpen: boolean;
}

type CompactPane = 'edit' | 'preview' | 'graph';

const compactQuery = window.matchMedia('(max-width: 700px)');

export class Eo3 extends PureComponent<Eo3.Props, Eo3State> {
    state = {
        render: {
            id: '',
            target: null,
            live: true,
            rendering: false,
            output: null as RenderOutput | null,
            error: null,
        },
        clickToRender: false,
        stale: false,
        selected: null,
        partId: null,
        copiedParts: [] as string[],
        compact: compactQuery.matches,
        pane: (this.props.view === 'simple' ? 'preview' : 'edit') as CompactPane,
        simplePanelOpen: false,
    };

    onCompactChange = () => this.setState({ compact: compactQuery.matches });

    componentDidMount() {
        compactQuery.addEventListener('change', this.onCompactChange);
        this.props.document.addEventListener('change', this.onDocumentChange);
        if (this.props.initWithoutRender) {
            const renderId = ++this.renderId;
            this.setState({ render: { ...this.state.render, rendering: true } });
            this.props.document
                .resolveUnloaded()
                .then(() => {
                    if (renderId !== this.renderId) return;
                    (this.state.render as RenderState).output?.drop();

                    this.setState({
                        render: {
                            ...this.state.render,
                            rendering: false,
                            id: this.renderId.toString(),
                        },
                        clickToRender: true,
                    });
                })
                .catch((err) => {
                    if (renderId !== this.renderId) return;
                    console.error(err);
                    (this.state.render as RenderState).output?.drop();

                    this.setState({
                        render: {
                            ...this.state.render,
                            rendering: false,
                            output: null,
                            error: {
                                type: 'error',
                                source: null,
                                error: err,
                            },
                        },
                    });
                });
        } else {
            this.renderPreview();
        }
    }
    componentDidUpdate(prevProps: Eo3.Props) {
        if (this.props.document !== prevProps.document) {
            prevProps.document.removeEventListener('change', this.onDocumentChange);
            this.props.document.addEventListener('change', this.onDocumentChange);
            this.scheduleRender();
        }
    }
    componentWillUnmount() {
        clearTimeout(this.renderTimeout);
        compactQuery.removeEventListener('change', this.onCompactChange);
        this.props.document.removeEventListener('change', this.onDocumentChange);
    }

    onDocumentChange = () => {
        if (this.state.render.live) {
            this.scheduleRender();
        } else {
            this.setState({ stale: this.isStale() });
        }
        this.forceUpdate();
    };

    /** What the render on screen (or its error) was made from; null before the first one. */
    renderedInputs: readonly unknown[] | null = null;
    isStale() {
        return (
            !!this.renderedInputs &&
            !sameRenderInputs(this.renderedInputs, renderInputs(this.props.document))
        );
    }

    renderTimeout: any = null;
    scheduleRender() {
        if (this.state.clickToRender) return;

        const debounceTime = this.props.document.wantsDebounce() ? 300 : 180;
        clearTimeout(this.renderTimeout);
        this.renderTimeout = setTimeout(() => {
            this.renderTimeout = null;
            this.renderPreview();
        }, debounceTime);
    }

    renderNow() {
        if (this.state.clickToRender || !this.state.render.live) return;
        clearTimeout(this.renderTimeout);
        this.renderTimeout = null;
        this.renderPreview();
    }

    renderId = 0;
    async renderPreview() {
        const renderId = ++this.renderId;
        this.setState({
            render: {
                ...this.state.render,
                rendering: true,
            },
        });

        let inputs: readonly unknown[] | null = null;
        try {
            await this.props.document.resolveUnloaded();
            // eval() reads the state as it is right now; later edits don't reach this render
            inputs = renderInputs(this.props.document);
            const result = await this.props.document.eval(this.state.render.target);
            let output = null;
            let error = null;
            if (result.type === 'output') {
                output = result;
            } else if (result.type === 'error') {
                error = result;
            }

            if (renderId !== this.renderId) return;
            (this.state.render as RenderState).output?.drop();

            this.renderedInputs = inputs;
            this.setState({
                stale: !this.state.render.live && this.isStale(),
                render: {
                    ...this.state.render,
                    rendering: false,
                    output,
                    error,
                    id: this.renderId.toString(),
                },
            });
        } catch (err) {
            if (renderId !== this.renderId) return;
            console.error(err);

            (this.state.render as RenderState).output?.drop();

            this.renderedInputs = inputs;
            this.setState({
                stale: !this.state.render.live && this.isStale(),
                render: {
                    ...this.state.render,
                    rendering: false,
                    output: null,
                    error: {
                        type: 'error',
                        source: null,
                        error: err,
                    },
                },
            });
        }
    }

    renderContext = {
        scheduleRender: () => this.scheduleRender(),
        renderNow: () => this.renderNow(),
    };

    moduleList = createRef<ModuleList>();
    leftPanelNode = createRef<HTMLDivElement>();
    toggleSimplePanel = () => this.setState((s) => ({ simplePanelOpen: !s.simplePanelOpen }));
    openSimplePanel = () => {
        if (!this.state.simplePanelOpen) this.setState({ simplePanelOpen: true });
    };
    toggleCompactPanel = () =>
        this.setState((s) => ({ pane: s.pane === 'edit' ? 'preview' : 'edit' }));
    openCompactPanel = () => {
        if (this.state.pane !== 'edit') this.setState({ pane: 'edit' });
    };

    /** Brings a module's editor on screen, e.g. from a render error. */
    openModule = (id: ModuleId) => {
        if (this.props.view === 'simple') {
            // the simple view lists one chapter at a time: show the one holding the module
            const partId = partListing(this.props.document, id, this.state.partId);
            this.setState(
                { partId: partId ?? this.state.partId, simplePanelOpen: true, pane: 'edit' },
                () => {
                    if (this.leftPanelNode.current)
                        revealSimpleItem(this.leftPanelNode.current, id);
                }
            );
            return;
        }
        this.setState({ selected: id, pane: 'edit' }, () => this.moduleList.current?.reveal(id));
    };

    leftPanel() {
        const doc = this.props.document;
        return (
            <div className="eo3-left-panel" ref={this.leftPanelNode}>
                <DocumentSettings doc={doc} />
                <PartsList
                    document={doc}
                    partId={this.state.partId}
                    onSelectPart={(partId) => this.setState({ partId })}
                    copiedParts={this.state.copiedParts}
                    onSelectModule={(selected) => this.setState({ selected })}
                    removesContent={this.props.view === 'simple'}
                />
                {this.props.view === 'simple' ? (
                    <SimpleEditor
                        document={doc}
                        partId={this.state.partId}
                        userData={this.state.render.output?.userData}
                    />
                ) : (
                    <ModuleList
                        ref={this.moduleList}
                        document={doc}
                        selected={this.state.selected}
                        onSelect={(selected) => this.setState({ selected })}
                        userData={this.state.render.output?.userData}
                    />
                )}
            </div>
        );
    }

    previewPane() {
        const isSimpleView = this.props.view === 'simple';
        return (
            <Preview
                document={this.props.document}
                render={this.state.render}
                partId={this.state.partId}
                onPartChange={(partId) => this.setState({ partId })}
                copiedParts={this.state.copiedParts}
                onPartCopied={(id) =>
                    this.setState({
                        copiedParts: [...this.state.copiedParts.filter((p) => p !== id), id],
                    })
                }
                clickToRender={
                    this.state.clickToRender
                        ? () => {
                              this.setState({ clickToRender: false }, () => {
                                  this.renderPreview();
                              });
                          }
                        : null
                }
                stale={this.state.stale}
                onLiveChange={(live) => {
                    this.setState(
                        { render: { ...this.state.render, live }, stale: !live && this.isStale() },
                        () => {
                            if (live) this.renderPreview();
                        }
                    );
                }}
                onRender={() => this.renderPreview()}
                onOpenModule={this.openModule}
                onTargetChange={(target) => {
                    this.setState({ render: { ...this.state.render, target } }, () => {
                        this.renderPreview();
                    });
                }}
                isSimpleView={isSimpleView}
                panelOpen={
                    this.state.compact ? this.state.pane === 'edit' : this.state.simplePanelOpen
                }
                onTogglePanel={
                    isSimpleView
                        ? this.state.compact
                            ? this.toggleCompactPanel
                            : this.toggleSimplePanel
                        : undefined
                }
                onOpenPanel={
                    isSimpleView
                        ? this.state.compact
                            ? this.openCompactPanel
                            : this.openSimplePanel
                        : undefined
                }
            />
        );
    }

    graphPane() {
        return (
            <ModuleGraph
                document={this.props.document}
                selected={this.state.selected}
                render={this.state.render}
                onSelect={(selected) => this.setState({ selected })}
            />
        );
    }

    /** Phone layout: one full-size pane at a time, switched from a bottom tab bar. */
    compactLayout() {
        const graphOpen = this.props.view === 'nodes';
        const current = this.state.pane === 'graph' && !graphOpen ? 'edit' : this.state.pane;
        const panes: CompactPane[] = graphOpen ? ['edit', 'preview', 'graph'] : ['edit', 'preview'];
        const pane = (id: CompactPane, contents: React.ReactNode) => (
            <div
                className={'i-pane' + (current === id ? ' is-active' : '')}
                role="tabpanel"
                id={`eo3-pane-${id}`}
            >
                {contents}
            </div>
        );

        return (
            <div className="eo3-compact">
                {pane('edit', this.leftPanel())}
                {pane('preview', this.previewPane())}
                {graphOpen ? pane('graph', this.graphPane()) : null}
                <nav className="i-pane-tabs" role="tablist">
                    {panes.map((id) => (
                        <button
                            key={id}
                            role="tab"
                            aria-selected={current === id}
                            aria-controls={`eo3-pane-${id}`}
                            className={'i-pane-tab' + (current === id ? ' is-active' : '')}
                            onClick={() => this.setState({ pane: id })}
                        >
                            {id}
                        </button>
                    ))}
                </nav>
            </div>
        );
    }

    ensurePieceCss = (piece: CssPiece) =>
        ensurePieceCssInDocument(this.props.document, this.state.partId, piece);

    lastCanvasContext: EditorCanvasContextValue | null = null;
    getCanvasContext(): EditorCanvasContextValue {
        const canvasCss = collectPartLiveCss(
            this.props.document,
            this.state.partId,
            this.state.render.output?.work
        );
        const isSimpleView = this.props.view === 'simple';
        const prev = this.lastCanvasContext;
        if (prev && prev.canvasCss === canvasCss && prev.isSimpleView === isSimpleView) {
            return prev;
        }
        const next: EditorCanvasContextValue = {
            canvasCss,
            ensurePieceCss: this.ensurePieceCss,
            isSimpleView,
        };
        this.lastCanvasContext = next;
        return next;
    }

    render() {
        const showLeftPanel = this.props.view === 'nodes' || this.state.simplePanelOpen;
        return (
            <RenderContext.Provider value={this.renderContext}>
                <EditorCanvasContext.Provider value={this.getCanvasContext()}>
                    <SiteTargetProvider>
                        <div className="eo3">
                            {this.state.compact ? (
                                this.compactLayout()
                            ) : (
                                <SplitPanel
                                    initialPos={Math.min(
                                        0.7,
                                        Math.max(500 / innerWidth, 1 - 700 / innerWidth)
                                    )}
                                >
                                    {showLeftPanel ? this.leftPanel() : null}
                                    <SplitPanel
                                        vertical
                                        initialPos={Math.max(0.6, 1 - 300 / innerHeight)}
                                    >
                                        {this.previewPane()}
                                        {this.props.view === 'nodes' ? this.graphPane() : null}
                                    </SplitPanel>
                                </SplitPanel>
                            )}
                        </div>
                    </SiteTargetProvider>
                </EditorCanvasContext.Provider>
            </RenderContext.Provider>
        );
    }
}
namespace Eo3 {
    export interface Props {
        document: Document;
        initWithoutRender: boolean;
        view: EditorView;
    }
}

function DocumentSettings({ doc }: { doc: Document }) {
    return (
        <div className="eo3-document-settings">
            <div className="i-doc-title">
                <div
                    className="i-sizer"
                    aria-hidden={true}
                    ref={(node) => {
                        if (node) (node as any).inert = true;
                    }}
                >
                    {doc.title}
                </div>
                <textarea
                    className="i-textarea"
                    placeholder="title"
                    aria-label="Project name"
                    rows={1}
                    maxLength={140}
                    value={doc.title}
                    onChange={(e) => {
                        doc.setTitle(e.target.value.replace(/[\r\n]/g, ' '));
                    }}
                />
            </div>
        </div>
    );
}
