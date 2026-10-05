import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '../../src/plugins/source/settings';
import {
    SettingsData,
    settingsModule,
    settingsValues,
    settingValue,
    settingVisible,
} from '../../src/plugins/source/settings-values';
import { parseGroupFile, stringifyGroupFile } from '../../src/storage/group-file';

const data: SettingsData = {
    fields: [
        { key: 'show', label: 'Show signature', type: 'toggle', default: false },
        {
            key: 'signature',
            label: 'Signature',
            section: 'Letter',
            hint: 'Who signed it',
            default: 'A friend',
            showWhen: { key: 'show', equals: true },
        },
        {
            key: 'size',
            label: 'Size',
            type: 'number',
            default: 12,
            min: 8,
            max: 24,
            step: 2,
            advanced: true,
        },
    ],
    values: { signature: 'Saved signature' },
};

describe('programmable settings', () => {
    it('keeps hidden values in output and uses defaults and numeric limits', () => {
        expect(settingsValues(data)).toEqual({
            show: false,
            signature: 'Saved signature',
            size: 12,
        });
        expect(settingVisible(data.fields[1], settingsValues(data))).toBe(false);
        expect(settingValue(data.fields[2], { size: 100 })).toBe(24);
        expect(settingValue(data.fields[2], { size: -1 })).toBe(8);
        expect(settingValue({ key: 'old', type: 'number' }, {})).toBe(0);
        expect(settingValue({ key: 'old' }, {})).toBe('');
        expect(settingsModule(data)).toContain('Saved signature');
    });
    it('supports ordinary own keys without inheriting prototype values', () => {
        const fields = [
            { key: '__proto__', default: 'safe' },
            { key: 'constructor', default: 'own' },
        ];
        const values = settingsValues({ fields, values: {} });
        expect(Object.keys(values)).toEqual(['__proto__', 'constructor']);
        expect(values.__proto__).toBe('safe');
        expect(settingVisible({ key: 'x', showWhen: { key: 'missing', equals: '' } }, values)).toBe(
            false
        );
    });
    it('round-trips the schema in reusable group files', () => {
        const file = {
            eo3: 'group' as const,
            version: 1 as const,
            title: 'Letter',
            inputs: [{ module: 0, label: 'Details' }],
            modules: [{ plugin: 'source.settings', data: JSON.parse(JSON.stringify(data)) }],
        };
        expect(parseGroupFile(stringifyGroupFile(file))).toEqual(file);
    });
    it('reveals dependent controls without losing values and connects help text', () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        function Form() {
            const [value, setValue] = useState(data);
            return createElement(SettingsForm, { data: value, onChange: setValue });
        }
        try {
            act(() => root.render(createElement(Form)));
            expect(container.textContent).not.toContain('Signature');
            expect(container.querySelector('details')?.open).toBe(false);
            const toggle = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
            act(() => Simulate.change(toggle, { target: { checked: true } } as any));
            const input = container.querySelector<HTMLInputElement>(
                'input[type=text], input:not([type])'
            )!;
            expect(input.value).toBe('Saved signature');
            expect(
                document.getElementById(input.getAttribute('aria-describedby')!)?.textContent
            ).toBe('Who signed it');
            act(() => Simulate.change(toggle, { target: { checked: false } } as any));
            act(() => Simulate.change(toggle, { target: { checked: true } } as any));
            expect(
                container.querySelector<HTMLInputElement>('input[type=text], input:not([type])')!
                    .value
            ).toBe('Saved signature');
        } finally {
            act(() => root.unmount());
            container.remove();
            vi.unstubAllGlobals();
        }
    });
});
