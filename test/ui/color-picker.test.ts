import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker, normalizeHex } from '../../src/uikit/color-picker';

describe('color picker', () => {
    it('reads hex codes leniently', () => {
        expect(normalizeHex('#AbC')).toBe('#aabbcc');
        expect(normalizeHex(' 112233 ')).toBe('#112233');
        expect(normalizeHex('#12345')).toBe(null);
        expect(normalizeHex('red')).toBe(null);
    });

    it('shows the color, and takes typed hex codes and suggested colors', () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        );
        // DirPopover asks about reduced motion.
        vi.stubGlobal('matchMedia', () => ({
            matches: true,
            addEventListener() {},
            removeEventListener() {},
        }));
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        let value = '#336699';
        function Field() {
            const [color, setColor] = useState(value);
            value = color;
            return createElement(ColorPicker, {
                value: color,
                onChange: setColor,
                label: 'Ink',
                presets: ['#aa3355', 'not a color', '#2277AA'],
            });
        }
        try {
            act(() => root.render(createElement(Field)));
            const field = container.querySelector<HTMLButtonElement>('.uikit-color-field')!;
            expect(field.textContent).toBe('#336699');
            expect(field.getAttribute('aria-label')).toBe('Ink: #336699');
            // The popover isn't made until it's first opened.
            expect(document.querySelector('.uikit-color-popover')).toBe(null);

            act(() => Simulate.click(field));
            const hex = document.querySelector<HTMLInputElement>('.uikit-color-popover input')!;
            act(() => Simulate.change(hex, { target: { value: '#12' } } as any));
            expect(value).toBe('#336699');
            expect(hex.getAttribute('aria-invalid')).toBe('true');
            act(() => Simulate.change(hex, { target: { value: 'f0a' } } as any));
            expect(value).toBe('#ff00aa');

            const presets = document.querySelectorAll<HTMLButtonElement>('.i-preset');
            expect([...presets].map((p) => p.title)).toEqual(['#aa3355', '#2277aa']);
            act(() => Simulate.click(presets[1]));
            expect(value).toBe('#2277aa');
            expect(presets[1].getAttribute('aria-pressed')).toBe('true');
            expect(field.textContent).toBe('#2277aa');
        } finally {
            act(() => root.unmount());
            container.remove();
            vi.unstubAllGlobals();
        }
    });
});
