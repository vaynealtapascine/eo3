import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/plugins', () => ({ MODULES: {} }));

import { Document, Module, type JsonValue, type ModulePlugin } from '../../src/document';
import { deserializeV1, serializeV1 } from '../../src/storage/versions/v1';

const SETTINGS = {
    id: 'source.settings',
    acceptsInputs: false,
    acceptsNamedInputs: false,
    component: () => null,
    initialData: () => ({ fields: [], values: {} }),
    description: () => 'Settings',
    eval: async () => null,
} as unknown as ModulePlugin<JsonValue>;

function workWith(data: unknown, title = '') {
    const doc = new Document();
    const mod = new Module(SETTINGS, data as JsonValue);
    mod.title = title;
    doc.insertModule(mod);
    return doc;
}

describe('saving module data', () => {
    it('leaves out cleared options instead of failing the TOML save', () => {
        // What the field options write when a limit is cleared or "Show when" is set to Always.
        const data = {
            fields: [
                { key: 'size', type: 'number', min: undefined, max: 10, showWhen: undefined },
                { key: 'people', type: 'list', minItems: undefined, fields: [{ key: 'name' }] },
            ],
            values: { people: [{ name: 'Ann' }, undefined] },
        };
        for (const format of ['toml', 'json']) {
            const reopened = deserializeV1(serializeV1(workWith(data), format));
            expect(reopened.modules.at(-1)!.data).toEqual({
                fields: [
                    { key: 'size', type: 'number', max: 10 },
                    { key: 'people', type: 'list', fields: [{ key: 'name' }] },
                ],
                values: { people: [{ name: 'Ann' }, null] },
            });
        }
    });

    it('names the module and the value when something really can’t be saved', () => {
        const doc = workWith({ fields: [{ key: 'a', default: () => 1 }], values: {} }, 'Details');
        expect(() => serializeV1(doc)).toThrow(
            'The “Details” module (source.settings, module 1) can’t be saved: ' +
                'fields[0].default is a function, which can’t be saved.'
        );
    });
});
