import React, { createRef, PureComponent } from 'react';
import { createPortal } from 'react-dom';
import { AnimationController, Spring } from './frame-animation';
import { shouldReduceMotion } from './animation';
import './dir-popover.css';
import { LayoutRootContext } from './layout-root-context';

const WINDOW_MARGIN = 16;
const ARROW_SIZE = 16;
const ARROW_MARGIN = 10;

interface DirPopoverState {
    mounted: boolean;
}

export class DirPopover extends PureComponent<DirPopover.Props, DirPopoverState> {
    static getDerivedStateFromProps(
        props: DirPopover.Props,
        state: DirPopoverState
    ): Partial<DirPopoverState> | null {
        if (props.open && !state.mounted) return { mounted: true };
        return null;
    }

    state: DirPopoverState = {
        mounted: this.props.open,
    };

    animCtrl = new AnimationController();
    presence = new Spring({
        value: this.props.open ? 1 : 0,
        target: this.props.open ? 1 : 0,
        stiffness: 720,
        damping: 46,
    });
    snapToNextPosition = false;
    anchorLoc = [0, 0];
    arrowLoc: [string, number, number] = ['none', 0, 0];
    positionX = new Spring({ stiffness: 640, damping: 48 });
    positionY = new Spring({ stiffness: 640, damping: 48 });
    width = new Spring({ stiffness: 640, damping: 48 });
    height = new Spring({ stiffness: 640, damping: 48 });
    dialog = createRef<HTMLDialogElement>();
    backdrop = createRef<HTMLDivElement>();
    popover = createRef<HTMLDivElement>();
    arrow = createRef<HTMLDivElement>();
    popoverContent: { current: HTMLElement | null } = { current: null };
    popoverContentRef = (node: HTMLElement | null) => {
        if (this.popoverContent.current && this.popoverContent.current !== node) {
            this.resizeObserver.unobserve(this.popoverContent.current);
        }
        this.popoverContent.current = node;
        if (node) this.resizeObserver.observe(node);
    };
    isReadyToShow = false;

    snapToNextContentSize = false;
    resizeObserver = new ResizeObserver((entries) => {
        if (!this.props.open) return;
        for (const entry of entries) {
            // we're only observing one element
            const nextW = entry.contentRect.width;
            const nextH = entry.contentRect.height;
            if (nextW <= 0 && nextH <= 0) continue;

            this.width.target = nextW;
            this.height.target = nextH;

            if (this.snapToNextContentSize) {
                this.width.value = nextW;
                this.width.velocity = 0;
                this.height.value = nextH;
                this.height.velocity = 0;
                this.snapToNextContentSize = false;
            }

            this.layoutAndApply(0);
            this.animCtrl.add(this);
        }
    });

    private openAndMeasure() {
        const dialog = this.dialog.current;
        if (dialog && !dialog.open) {
            try {
                dialog.showModal?.();
            } catch {
                // jsdom or detached dialog fallback
            }
        }

        const content = this.popoverContent.current;
        if (content) {
            const rect = content.getBoundingClientRect();
            const measuredW = rect.width || content.offsetWidth;
            const measuredH = rect.height || content.offsetHeight;
            if (measuredW > 0 || measuredH > 0) {
                this.width.target = measuredW;
                this.height.target = measuredH;
                if (this.snapToNextContentSize) {
                    this.width.value = measuredW;
                    this.width.velocity = 0;
                    this.height.value = measuredH;
                    this.height.velocity = 0;
                    this.snapToNextContentSize = false;
                }
            }
        }

        if (shouldReduceMotion()) {
            this.presence.value = 1;
            this.presence.velocity = 0;
            this.presence.target = 1;
            this.layoutAndApply(0);
            return;
        }

        this.layoutAndApply(0);
        this.animCtrl.add(this);
    }

    private closeImmediately() {
        this.animCtrl.stop();
        this.presence.target = 0;
        this.presence.value = 0;
        this.presence.velocity = 0;
        this.isReadyToShow = false;
        this.snapToNextContentSize = false;
        this.snapToNextPosition = false;
        const dialog = this.dialog.current;
        if (dialog?.open) {
            try {
                dialog.close?.();
            } catch {
                // ignore
            }
        }
        if (this.backdrop.current) this.backdrop.current.style.opacity = '0';
        if (this.popover.current) {
            this.popover.current.style.opacity = '0';
            this.popover.current.style.width = '';
            this.popover.current.style.height = '';
            this.popover.current.style.transform = '';
        }
        if (this.arrow.current) {
            this.arrow.current.style.display = 'none';
            this.arrow.current.style.opacity = '0';
        }
        if (this.state.mounted) {
            this.setState({ mounted: false });
        }
    }

    private layoutAndApply(dt: number): boolean {
        const popoverSize = [this.width.target, this.height.target];
        const anchorMin = [window.innerWidth / 2, window.innerHeight / 2];
        const anchorCenter = [window.innerWidth / 2, window.innerHeight / 2];
        const anchorMax = [window.innerWidth / 2, window.innerHeight / 2];
        if (this.props.anchor instanceof HTMLElement) {
            const anchorRect = this.props.anchor.getBoundingClientRect();
            anchorMin[0] = anchorRect.left;
            anchorMin[1] = anchorRect.top;
            anchorMax[0] = anchorRect.right;
            anchorMax[1] = anchorRect.bottom;
            anchorCenter[0] = anchorRect.left + anchorRect.width / 2;
            anchorCenter[1] = anchorRect.top + anchorRect.height / 2;
        } else if (Array.isArray(this.props.anchor)) {
            anchorMin[0] = anchorMax[0] = anchorCenter[0] = this.props.anchor[0];
            anchorMin[1] = anchorMax[1] = anchorCenter[1] = this.props.anchor[1];
        }

        const popoverMinLoc = [WINDOW_MARGIN, WINDOW_MARGIN];
        const popoverMaxLoc = [
            Math.max(WINDOW_MARGIN, window.innerWidth - popoverSize[0] - WINDOW_MARGIN),
            Math.max(WINDOW_MARGIN, window.innerHeight - popoverSize[1] - WINDOW_MARGIN),
        ];

        // default: just center it
        let popoverLoc = [
            anchorCenter[0] - popoverSize[0] / 2,
            anchorCenter[1] - popoverSize[1] / 2,
        ];
        this.anchorLoc = anchorCenter;
        let arrowLocType = 'none';

        const hasEnoughSpaceAbove = anchorMin[1] - ARROW_SIZE - popoverSize[1] > popoverMinLoc[1];
        const hasEnoughSpaceBelow = anchorMax[1] + ARROW_SIZE < popoverMaxLoc[1];
        const hasEnoughSpaceOnLeft = anchorMin[0] - ARROW_SIZE - popoverSize[0] > popoverMinLoc[0];
        const hasEnoughSpaceOnRight = anchorMax[0] + ARROW_SIZE < popoverMaxLoc[0];

        const placeAbove = () => {
            popoverLoc = [
                anchorCenter[0] - popoverSize[0] / 2,
                anchorMin[1] - ARROW_SIZE - popoverSize[1],
            ];
            this.anchorLoc = [anchorCenter[0], anchorMin[1]];
            arrowLocType = 'bottom';
        };
        const placeBelow = () => {
            popoverLoc = [anchorCenter[0] - popoverSize[0] / 2, anchorMax[1] + ARROW_SIZE];
            this.anchorLoc = [anchorCenter[0], anchorMax[1]];
            arrowLocType = 'top';
        };
        const placeLeft = () => {
            popoverLoc = [
                anchorMin[0] - ARROW_SIZE - popoverSize[0],
                anchorCenter[1] - popoverSize[1] / 2,
            ];
            this.anchorLoc = [anchorMin[0], anchorCenter[1]];
            arrowLocType = 'right';
        };
        const placeRight = () => {
            popoverLoc = [anchorMax[0] + ARROW_SIZE, anchorCenter[1] - popoverSize[1] / 2];
            this.anchorLoc = [anchorMax[0], anchorCenter[1]];
            arrowLocType = 'left';
        };

        if (this.props.anchorBias === 'above' && hasEnoughSpaceAbove) {
            placeAbove();
        } else if (this.props.anchorBias === 'below' && hasEnoughSpaceBelow) {
            placeBelow();
        } else if (this.props.anchorBias === 'left' && hasEnoughSpaceOnLeft) {
            placeLeft();
        } else if (this.props.anchorBias === 'right' && hasEnoughSpaceOnRight) {
            placeRight();
        } else if (hasEnoughSpaceAbove) {
            placeAbove();
        } else if (hasEnoughSpaceBelow) {
            placeBelow();
        } else if (hasEnoughSpaceOnRight) {
            placeRight();
        } else if (hasEnoughSpaceOnLeft) {
            placeLeft();
        }

        popoverLoc[0] = Math.max(popoverMinLoc[0], Math.min(popoverLoc[0], popoverMaxLoc[0]));
        popoverLoc[1] = Math.max(popoverMinLoc[1], Math.min(popoverLoc[1], popoverMaxLoc[1]));

        // round target location so we don't get subpixel blurriness
        this.positionX.target = Math.round(popoverLoc[0]);
        this.positionY.target = Math.round(popoverLoc[1]);

        if (!this.snapToNextContentSize && this.snapToNextPosition) {
            // only snap to next position once content size has been resolved
            this.positionX.value = this.positionX.target;
            this.positionX.velocity = 0;
            this.positionY.value = this.positionY.target;
            this.positionY.velocity = 0;
            this.snapToNextPosition = false;
            this.isReadyToShow = true;
        }

        let done = true;
        if (dt > 0) {
            done = this.presence.update(dt) && done;
            done = this.width.update(dt) && done;
            done = this.height.update(dt) && done;
            done = this.positionX.update(dt) && done;
            done = this.positionY.update(dt) && done;
        } else {
            done = false;
        }

        this.arrowLoc = ['none', 0, 0];
        if (arrowLocType === 'left') {
            const x = 0;
            const y = this.anchorLoc[1] - this.positionY.value;
            if (y > ARROW_MARGIN && y < this.height.value - ARROW_MARGIN) {
                this.arrowLoc = ['left', x, y];
            }
        } else if (arrowLocType === 'right') {
            const x = this.width.value;
            const y = this.anchorLoc[1] - this.positionY.value;
            if (y > ARROW_MARGIN && y < this.height.value - ARROW_MARGIN) {
                this.arrowLoc = ['right', x, y];
            }
        } else if (arrowLocType === 'top' || arrowLocType === 'bottom') {
            const x = this.anchorLoc[0] - this.positionX.value;
            const y = arrowLocType === 'top' ? 0 : this.height.value;
            if (x > ARROW_MARGIN && x < this.width.value - ARROW_MARGIN) {
                this.arrowLoc = [arrowLocType, x, y];
            }
        }

        this.applyStyles();
        return done;
    }

    private applyStyles() {
        const reduceMotion = shouldReduceMotion();
        const presence = Math.max(0, Math.min(1, this.presence.value));
        const popoverOpacity = this.isReadyToShow ? presence : 0;

        const popoverEl = this.popover.current;
        const arrowEl = this.arrow.current;
        const backdropEl = this.backdrop.current;

        const anchorLoc = this.anchorLoc;
        const popoverLoc = [this.positionX.value, this.positionY.value];

        const popoverTransform = `translate(${popoverLoc[0]}px, ${popoverLoc[1]}px)`;
        const scale = 0.94 + 0.06 * presence;
        const popoverTransformScale = reduceMotion ? '' : ` scale(${scale})`;
        const popoverTransformOrigin = `${anchorLoc[0] - popoverLoc[0]}px ${
            anchorLoc[1] - popoverLoc[1]
        }px`;

        if (backdropEl) {
            backdropEl.style.opacity = String(presence * (this.props.shade === false ? 0 : 1));
        }

        if (popoverEl) {
            if (this.width.value > 0) popoverEl.style.width = `${this.width.value}px`;
            if (this.height.value > 0) popoverEl.style.height = `${this.height.value}px`;
            popoverEl.style.transform = popoverTransform + popoverTransformScale;
            popoverEl.style.transformOrigin = popoverTransformOrigin;
            popoverEl.style.opacity = String(popoverOpacity);
        }

        if (arrowEl) {
            if (this.arrowLoc[0] !== 'none') {
                arrowEl.style.display = 'block';
                arrowEl.dataset.type = this.arrowLoc[0];
                arrowEl.style.transform = [
                    popoverTransform + popoverTransformScale,
                    `translate(${this.arrowLoc[1]}px, ${this.arrowLoc[2]}px)`,
                ].join(' ');
                arrowEl.style.transformOrigin = popoverTransformOrigin;
                arrowEl.style.opacity = String(popoverOpacity);
            } else {
                arrowEl.style.display = 'none';
            }
        }
    }

    update(dt: number) {
        if (!this.props.open) return true;
        return this.layoutAndApply(dt);
    }

    componentDidMount() {
        this.presence.motionThreshold = 0.015;
        this.dialog.current?.addEventListener('close', this.onDialogClose);
        this.dialog.current?.addEventListener('cancel', this.onDialogClose);
        window.addEventListener('resize', this.onResize);

        if (this.props.open) {
            this.presence.value = 0.01;
            this.presence.target = 1;
            this.snapToNextContentSize = true;
            this.snapToNextPosition = true;
            this.openAndMeasure();
        }
    }

    componentDidUpdate(prevProps: DirPopover.Props) {
        if (prevProps.open !== this.props.open) {
            if (this.props.open) {
                this.presence.value = 0.01;
                this.presence.velocity = 0;
                this.presence.target = 1;
                this.snapToNextContentSize = true;
                this.snapToNextPosition = true;
                this.openAndMeasure();
            } else {
                this.closeImmediately();
            }
        } else if (
            this.props.open &&
            (prevProps.anchor !== this.props.anchor ||
                prevProps.anchorBias !== this.props.anchorBias)
        ) {
            this.layoutAndApply(0);
            this.animCtrl.add(this);
        }
    }

    componentWillUnmount() {
        this.animCtrl.stop();
        this.resizeObserver.disconnect();
        this.dialog.current?.removeEventListener('close', this.onDialogClose);
        this.dialog.current?.removeEventListener('cancel', this.onDialogClose);
        window.removeEventListener('resize', this.onResize);
    }

    onResize = () => {
        if (!this.props.open) return;
        this.layoutAndApply(0);
        this.animCtrl.add(this);
    };

    onBackdropMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || !this.props.open) return;
        e.preventDefault();
        this.props.onClose();
    };

    onBackdropClick = (e: React.MouseEvent) => {
        if (!this.props.open) return;
        e.preventDefault();
        this.props.onClose();
    };

    onDialogClose = (e: Event) => {
        e.preventDefault();
        if (this.props.open) this.props.onClose();
    };

    render() {
        const { children } = this.props;
        const { mounted } = this.state;

        const dialog = (
            <dialog className="dir-popover-dialog" ref={this.dialog}>
                <div
                    ref={this.backdrop}
                    className="inner-backdrop"
                    onMouseDown={this.onBackdropMouseDown}
                    onClick={this.onBackdropClick}
                />
                <div ref={this.popover} className="inner-popover">
                    <LayoutRootContext.Provider value={this.dialog}>
                        <div className="i-content" ref={this.popoverContentRef}>
                            {mounted ? children : null}
                        </div>
                    </LayoutRootContext.Provider>
                </div>
                <div ref={this.arrow} className="i-arrow" />
            </dialog>
        );

        if (this.props.portal && typeof document !== 'undefined' && document.body) {
            return createPortal(dialog, document.body);
        }
        return dialog;
    }
}

namespace DirPopover {
    export interface Props {
        /** Anchor where the popover will appear from. Either an element or client coordinates */
        anchor?: HTMLElement | [number, number] | null;
        anchorBias?: 'above' | 'below' | 'left' | 'right';
        /** Whether the popover is open */
        open: boolean;
        /** Close callback. */
        onClose: () => void;
        /** Popover contents */
        children: React.ReactNode;
        shade?: boolean;
        /** Render the popover dialog into document.body so parent preview CSS cannot leak in. */
        portal?: boolean;
    }
}
