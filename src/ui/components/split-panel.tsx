import React, { createRef, PureComponent } from 'react';
import './split-panel.scss';

type ResizerDragState = {
    pointerId: number;
    offset: number;
};

interface SplitPanelState {
    splitPos: number;
}

export class SplitPanel extends PureComponent<SplitPanel.Props, SplitPanelState> {
    state = {
        splitPos: Number.isFinite(this.props.initialPos) ? this.props.initialPos! : 0.5,
    };

    panel = createRef<HTMLDivElement>();
    resizer = createRef<HTMLDivElement>();

    hv<T>(x: T, y: T): T {
        return this.props.vertical ? y : x;
    }

    get bounds() {
        const minSplit = this.props.bounds ? this.props.bounds[0] : 0.1;
        const maxSplit = this.props.bounds ? this.props.bounds[1] : 0.9;
        return [minSplit, maxSplit];
    }

    resizerDragState: ResizerDragState | null = null;
    onResizerPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        if (this.resizerDragState) return;
        this.resizer.current!.setPointerCapture(e.pointerId);

        const panelRect = this.panel.current!.getBoundingClientRect();
        const panelBase = this.hv(panelRect.left, panelRect.top);
        const panelSize = this.hv(panelRect.width, panelRect.height);
        const pointerLoc = this.hv(e.clientX, e.clientY);

        const normalizedPointerLoc = (pointerLoc - panelBase) / panelSize;
        this.resizerDragState = {
            pointerId: e.pointerId,
            offset: this.state.splitPos - normalizedPointerLoc,
        };
    };
    onResizerPointerMove = (e: React.PointerEvent) => {
        e.preventDefault();
        if (!this.resizerDragState) return;
        const state = this.resizerDragState;

        const panelRect = this.panel.current!.getBoundingClientRect();
        const panelBase = this.hv(panelRect.left, panelRect.top);
        const panelSize = this.hv(panelRect.width, panelRect.height);
        const pointerLoc = this.hv(e.clientX, e.clientY);

        const normalizedPointerLoc = (pointerLoc - panelBase) / panelSize;

        const [minSplit, maxSplit] = this.bounds;
        this.setState({
            splitPos: Math.max(minSplit, Math.min(normalizedPointerLoc + state.offset, maxSplit)),
        });
    };
    onResizerPointerUp = (e: React.PointerEvent) => {
        e.preventDefault();
        if (!this.resizerDragState) return;
        const state = this.resizerDragState;
        this.resizer.current!.releasePointerCapture(state.pointerId);
        this.resizerDragState = null;
    };

    onResizerKeyPress = (e: React.KeyboardEvent) => {
        const [minSplit, maxSplit] = this.bounds;

        const panelRect = this.panel.current!.getBoundingClientRect();
        const panelSize = this.hv(panelRect.width, panelRect.height);
        const increment = 10 / panelSize;

        const primaryDirUp = this.hv('ArrowRight', 'ArrowDown');
        const primaryDirDn = this.hv('ArrowLeft', 'ArrowUp');
        const secondaryDirUp = this.hv('ArrowUp', 'ArrowRight');
        const secondaryDirDn = this.hv('ArrowDown', 'ArrowLeft');

        if (e.key === primaryDirUp || e.key === secondaryDirUp) {
            const newPos = this.state.splitPos + increment;
            this.setState({
                splitPos: Math.max(minSplit, Math.min(newPos, maxSplit)),
            });
        } else if (e.key === primaryDirDn || e.key === secondaryDirDn) {
            const newPos = this.state.splitPos - increment;
            this.setState({
                splitPos: Math.max(minSplit, Math.min(newPos, maxSplit)),
            });
        }
    };

    render() {
        const { vertical, children: originalChildren } = this.props;

        const raw = Array.isArray(originalChildren) ? originalChildren : [originalChildren];
        if (raw.length > 2) throw new Error('SplitPanel: more than 2 children not supported');

        const first = raw[0] || null;
        const second = raw[1] || null;
        const doSplit = Boolean(first && second);
        const dim = this.hv('width', 'height');
        const style1 = { [dim]: doSplit ? this.state.splitPos * 100 + '%' : '100%' };
        const style2 = { [dim]: doSplit ? (1 - this.state.splitPos) * 100 + '%' : '100%' };
        const [minSplit, maxSplit] = this.bounds;

        return (
            <div
                ref={this.panel}
                className={'split-panel' + (vertical ? ' is-vertical' : ' is-horizontal')}
            >
                {first ? (
                    <div key="first" className="inner-container" role="group" style={style1}>
                        {first}
                    </div>
                ) : null}
                {doSplit && (
                    <div
                        key="resizer"
                        ref={this.resizer}
                        tabIndex={0}
                        role="separator"
                        aria-orientation={this.hv('vertical', 'horizontal')}
                        className="inner-resizer"
                        aria-valuemin={Math.round(minSplit * 100)}
                        aria-valuemax={Math.round(maxSplit * 100)}
                        aria-valuenow={Math.round(this.state.splitPos * 100)}
                        onKeyDown={this.onResizerKeyPress}
                        onTouchStart={(e) => e.preventDefault()}
                        onPointerDown={this.onResizerPointerDown}
                        onPointerMove={this.onResizerPointerMove}
                        onPointerUp={this.onResizerPointerUp}
                    >
                        <div className="inner-affordance" />
                    </div>
                )}
                {second ? (
                    <div key="second" className="inner-container" role="group" style={style2}>
                        {second}
                    </div>
                ) : null}
            </div>
        );
    }
}
namespace SplitPanel {
    export interface Props {
        vertical?: boolean;
        /** The initial split position. (Default: 0.5) */
        initialPos?: number;
        /** The min and max split values. (Default: [0.1, 0.9]) */
        bounds?: [number, number];
        children: React.ReactNode;
    }
}
