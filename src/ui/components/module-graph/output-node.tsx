import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Position, Handle } from 'reactflow';
import { AnimationController, Spring } from '../../../uikit/frame-animation';
import { useSiteTarget } from '../../../targets/context';
import { MOD_BASE_WIDTH, MOD_INPUT_HEIGHT } from './consts';
const HEIGHT_PROP = '--height' as any;

export function OutputNode({ data }: { data: any }) {
    const node = useRef<HTMLDivElement>(null);
    const { plugin: siteTargetPlugin } = useSiteTarget();

    const [isPointerDown, setPointerDown] = useState(false);
    const bounceSpring = useMemo(() => new Spring({ stiffness: 158, damping: 18 }), []);
    const [bounceTransform, setBounceTransform] = useState('');

    const setBounceTransformRef = useRef(setBounceTransform);
    setBounceTransformRef.current = setBounceTransform;

    const animCtrl = useMemo(() => new AnimationController(), []);
    useEffect(() => {
        return () => animCtrl.stop();
    }, []);

    const animationTarget = useMemo(() => {
        return {
            update: (dt: number) => {
                const setBounceTransform = setBounceTransformRef.current;

                const isDone = bounceSpring.update(dt);
                const sx = Math.max(0, Math.min(1 + bounceSpring.value, 4));
                const sy = Math.max(0, Math.min(1 - bounceSpring.value, 4));
                setBounceTransform(`scale(${sx}, ${sy})`);

                return isDone;
            },
        };
    }, []);

    const addBounce = (velocity: number) => {
        if (Math.abs(bounceSpring.velocity) > 40) return;
        bounceSpring.velocity += velocity;
        animCtrl.add(animationTarget);
    };

    const lastPointer = useRef([0, 0]);
    const onDown = (e: React.PointerEvent) => {
        e.preventDefault();
        node.current!.setPointerCapture(e.pointerId);
        lastPointer.current = [e.clientX, e.clientY];
        setPointerDown(true);
    };
    const onMove = (e: React.PointerEvent) => {
        if (!isPointerDown) return;
        const dx = e.clientX - lastPointer.current[0];
        const dy = e.clientY - lastPointer.current[1];

        const dist = Math.sqrt(Math.hypot(dx, dy)) * (0.5 + 0.5 * Math.random());
        addBounce(dist * 0.02);

        lastPointer.current = [e.clientX, e.clientY];
    };
    const onUp = (e: React.PointerEvent) => {
        node.current!.releasePointerCapture(e.pointerId);
        setPointerDown(false);
    };

    const partName =
        data.partCount > 1
            ? `${siteTargetPlugin?.partLabel ?? 'Part'} ${data.partIndex + 1}` +
              (data.partTitle ? `: ${data.partTitle}` : '')
            : null;

    return (
        <div
            ref={node}
            className={'i-output-node' + (isPointerDown ? ' is-patting' : '')}
            aria-label={partName ? `Output for ${partName}` : 'Output'}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
        >
            <div className="i-module-item i-output-inputs" style={{ width: MOD_BASE_WIDTH }}>
                <div className="i-input" style={{ [HEIGHT_PROP]: MOD_INPUT_HEIGHT }}>
                    <span className="i-label">HTML</span>
                    <Handle id="in" type="target" position={Position.Left} />
                </div>
                <div className="i-input has-dock" style={{ [HEIGHT_PROP]: MOD_INPUT_HEIGHT }}>
                    <span className="i-label">CSS</span>
                    <Handle id="css" type="target" position={Position.Left} />
                    <Handle
                        id="styles"
                        type="target"
                        position={Position.Right}
                        isConnectable={false}
                    />
                </div>
            </div>
            <div
                className="eggbug-containment-zone"
                style={{
                    transform: bounceTransform,
                    width: '128px',
                    height: '128px',
                }}
                dangerouslySetInnerHTML={{
                    __html: siteTargetPlugin
                        ? data.hasOutput && !isPointerDown
                            ? siteTargetPlugin.outputMascot.awake
                            : siteTargetPlugin.outputMascot.asleep
                        : '',
                }}
            ></div>
            {partName && <div className="i-part-name">{partName}</div>}
        </div>
    );
}
