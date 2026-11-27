import { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { DirPopover } from './dir-popover';
import './color-picker.css';

const HEX = /^#[0-9a-f]{6}$/i;

/** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; null when it isn't a hex color. */
export function normalizeHex(text: string): string | null {
    let hex = text.trim().replace(/^#?/, '#').toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
    return HEX.test(hex) ? hex : null;
}

/** The browser's screen color picker (Chromium only). */
type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
function eyeDropper(): EyeDropperCtor | null {
    return (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null;
}

/**
 * A color field in eo3's style: a swatch with its hex code that opens a picker (saturation and
 * hue, a hex field, optional preset swatches, and the screen eyedropper where the browser has
 * one). Values are six-digit `#rrggbb` strings.
 */
export function ColorPicker({
    value,
    onChange,
    id,
    presets,
    label,
    'aria-describedby': describedBy,
}: {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    presets?: string[];
    /** What the color is for, for screen readers ("Bubble color"). */
    label?: string;
    'aria-describedby'?: string;
}) {
    const [open, setOpen] = useState(false);
    // Forms can have many color fields; each popover is only made once it's first opened.
    const [used, setUsed] = useState(false);
    const [draft, setDraft] = useState<string | null>(null);
    const button = useRef<HTMLButtonElement>(null);
    const hexInput = useRef<HTMLInputElement>(null);
    const color = normalizeHex(value) ?? '#000000';

    useEffect(() => {
        if (!open) return;
        // After the popover has opened and rendered its contents.
        const timer = setTimeout(() => hexInput.current?.select(), 50);
        return () => clearTimeout(timer);
    }, [open]);

    const close = () => {
        setOpen(false);
        setDraft(null);
        button.current?.focus();
    };
    const Dropper = eyeDropper();

    return (
        <>
            <button
                ref={button}
                id={id}
                type="button"
                className="uikit-color-field"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-describedby={describedBy}
                aria-label={label ? `${label}: ${color}` : undefined}
                onClick={() => {
                    setUsed(true);
                    setOpen(true);
                }}
            >
                <span className="i-chip" style={{ backgroundColor: color }} />
                <span className="i-hex">{color}</span>
            </button>
            {used ? (
                <DirPopover open={open} anchor={button.current} onClose={close}>
                    <div
                        className="uikit-color-popover"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target === hexInput.current) close();
                        }}
                    >
                        <HexColorPicker
                            color={color}
                            onChange={(next) => {
                                setDraft(null);
                                onChange(next);
                            }}
                        />
                        <div className="i-row">
                            <span className="i-preview" style={{ backgroundColor: color }} />
                            <label className="i-hex-field">
                                <span className="i-label">Hex</span>
                                <input
                                    ref={hexInput}
                                    value={draft ?? color}
                                    spellCheck={false}
                                    aria-invalid={draft !== null && !normalizeHex(draft)}
                                    onChange={(e) => {
                                        setDraft(e.target.value);
                                        const hex = normalizeHex(e.target.value);
                                        if (hex) onChange(hex);
                                    }}
                                    onBlur={() => setDraft(null)}
                                />
                            </label>
                            {Dropper ? (
                                <button
                                    type="button"
                                    className="i-dropper"
                                    title="Pick a color from the screen"
                                    aria-label="Pick a color from the screen"
                                    onClick={async () => {
                                        try {
                                            const { sRGBHex } = await new Dropper().open();
                                            const hex = normalizeHex(sRGBHex);
                                            if (hex) onChange(hex);
                                        } catch {
                                            // Cancelled with Escape.
                                        }
                                    }}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden="true">
                                        <path d="M11.3 1.6a1.9 1.9 0 0 1 2.7 2.7l-1.4 1.4.6.6-1.1 1.1-.6-.6-5.6 5.6H3.6l-1.3 1.2-.6-.6 1.2-1.3V10l5.6-5.6-.6-.6 1.1-1.1.6.6zM4.1 10.5v1.4h1.4l5.4-5.4-1.4-1.4z" />
                                    </svg>
                                </button>
                            ) : null}
                        </div>
                        {presets?.length ? (
                            <div className="i-presets" role="group" aria-label="Suggested colors">
                                {presets.map((preset) => {
                                    const hex = normalizeHex(preset);
                                    if (!hex) return null;
                                    return (
                                        <button
                                            key={hex}
                                            type="button"
                                            className={
                                                'i-preset' + (hex === color ? ' is-active' : '')
                                            }
                                            style={{ backgroundColor: hex }}
                                            title={hex}
                                            aria-label={hex}
                                            aria-pressed={hex === color}
                                            onClick={() => onChange(hex)}
                                        />
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                </DirPopover>
            ) : null}
        </>
    );
}
