import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ChoicesField, SettingsForm, parseChoices } from '../../src/plugins/source/settings';
import {
    SettingsData,
    SettingsField,
    parseSettingsFields,
    settingsModule,
    settingsTypeScript,
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

const people: SettingsField = {
    key: 'people',
    label: 'People',
    type: 'list',
    itemLabel: 'Person',
    minItems: 1,
    maxItems: 3,
    fields: [
        { key: 'name', label: 'Name', default: 'Someone' },
        { key: 'color', type: 'color', default: '#336699' },
        { key: 'size', type: 'number', min: 1, max: 5 },
    ],
};

describe('list settings', () => {
    it('fills each entry from its item fields and keeps the entry limits', () => {
        expect(settingValue(people, {})).toEqual([{ name: 'Someone', color: '#336699', size: 1 }]);
        expect(
            settingValue(people, {
                people: [{ name: 'Ann', size: 9 }, 'junk', {}, { name: 'Dropped' }],
            })
        ).toEqual([
            { name: 'Ann', color: '#336699', size: 5 },
            { name: 'Someone', color: '#336699', size: 1 },
            { name: 'Someone', color: '#336699', size: 1 },
        ]);
        expect(
            settingValue({ ...people, default: [{ name: 'Bo' }, { name: 'Cy' }] }, {})
        ).toHaveLength(2);
        // Contradictory limits are ignored.
        expect(settingValue({ ...people, minItems: 4, maxItems: 2 }, {})).toEqual([]);
        expect(settingsModule({ fields: [people], values: {} })).toContain('"people": [');
    });

    it('describes the values as a TypeScript type', () => {
        expect(
            settingsTypeScript([
                { key: 'title' },
                { key: 'mood', type: 'choice', options: ['calm', 'loud'] },
                { key: 'on', type: 'toggle' },
                { key: 'odd key', type: 'number' },
                people,
            ])
        ).toBe(
            [
                '{',
                '    title: string;',
                '    mood: "calm" | "loud";',
                '    on: boolean;',
                '    "odd key": number;',
                '    people: Array<{',
                '        name: string;',
                '        color: string;',
                '        size: number;',
                '    }>;',
                '}',
            ].join('\n')
        );
    });

    it('checks fields written as code', () => {
        expect(
            parseSettingsFields([
                { key: 'a', type: 'list', fields: [{ key: 'b' }], extra: 1, minItems: 2 },
            ])
        ).toEqual([{ key: 'a', type: 'list', fields: [{ key: 'b' }], minItems: 2 }]);
        expect(() => parseSettingsFields({})).toThrow('fields should be a list of fields');
        expect(() => parseSettingsFields([{ key: 'a', type: 'date' }])).toThrow(
            /fields\[0\]\.type should be one of/
        );
        expect(() => parseSettingsFields([{ key: 'a', fields: [{ label: 'x' }] }])).toThrow(
            'fields[0].fields[0].key should be text'
        );
        expect(() => parseSettingsFields([{ key: 'a', default: { x: 1 } }])).toThrow(
            /default should be/
        );
    });

    it('lets writers add, edit, reorder and remove entries within the limits', () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        let latest: SettingsData = { fields: [people], values: {} };
        function Form() {
            const [value, setValue] = useState(latest);
            latest = value;
            return createElement(SettingsForm, { data: value, onChange: setValue });
        }
        const button = (text: string) =>
            [...container.querySelectorAll('button')].filter((b) => b.textContent === text);
        const names = () => (settingsValues(latest).people as { name: string }[]).map((p) => p.name);
        try {
            act(() => root.render(createElement(Form)));
            expect(container.querySelectorAll('.i-list-item')).toHaveLength(1);
            expect(button('Remove')[0].disabled).toBe(true);

            act(() => Simulate.click(button('+ Add person')[0]));
            act(() => Simulate.click(button('+ Add person')[0]));
            expect(button('+ Add person')[0].disabled).toBe(true);

            const nameInputs = () =>
                [...container.querySelectorAll<HTMLInputElement>('.i-list-item input')].filter(
                    (input) => input.type !== 'color' && input.type !== 'number'
                );
            act(() => Simulate.change(nameInputs()[0], { target: { value: 'Ann' } } as any));
            act(() => Simulate.change(nameInputs()[2], { target: { value: 'Cy' } } as any));
            expect(names()).toEqual(['Ann', 'Someone', 'Cy']);

            act(() => Simulate.click(container.querySelector('[aria-label="Move Person 3 up"]')!));
            expect(names()).toEqual(['Ann', 'Cy', 'Someone']);
            act(() => Simulate.click(button('Remove')[0]));
            expect(names()).toEqual(['Cy', 'Someone']);
            expect(container.querySelector('.i-list-item legend')?.textContent).toBe('Person 1');
        } finally {
            act(() => root.unmount());
            container.remove();
            vi.unstubAllGlobals();
        }
    });
});

describe('choice options', () => {
    it('keeps a typed comma while typing and tidies the list on blur', () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        let options: string[] = ['calm'];
        function Field() {
            const [value, setValue] = useState(options);
            options = value;
            return createElement(ChoicesField, { options: value, onChange: setValue });
        }
        try {
            act(() => root.render(createElement(Field)));
            const input = container.querySelector('input')!;
            expect(input.value).toBe('calm');
            act(() => Simulate.change(input, { target: { value: 'calm,' } } as any));
            expect(input.value).toBe('calm,');
            expect(options).toEqual(['calm']);
            act(() => Simulate.change(input, { target: { value: 'calm, loud , ' } } as any));
            expect(input.value).toBe('calm, loud , ');
            expect(options).toEqual(['calm', 'loud']);
            act(() => Simulate.blur(input));
            expect(input.value).toBe('calm, loud');
        } finally {
            act(() => root.unmount());
            container.remove();
            vi.unstubAllGlobals();
        }
        expect(parseChoices('a, b,, a , c')).toEqual(['a', 'b', 'c']);
    });
});
