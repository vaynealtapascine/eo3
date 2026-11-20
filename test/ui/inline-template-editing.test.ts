// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '@ltd/j-toml';
import fs from 'node:fs';
import { Document, instantiateGroupFile, Module, RenderOutput } from '../../src/document';
import { EXAMPLE_GROUPS } from '../../src/groups/examples';
import { MODULES } from '../../src/plugins';
import type { SettingsData } from '../../src/plugins/source/settings-values';
import { renderAo3Content, renderAo3Preview } from '../../src/targets/ao3/render';
import { InlineChapterEditor } from '../../src/ui/components/inline-chapter-editor';
import { RenderContext } from '../../src/ui/render-context';
import { DirPopover } from '../../src/uikit/dir-popover';
import {
    stampEditableSlots,
    writeEditableSlot,
} from '../../src/ui/components/inline-template-helpers';
import { renderWorkskinDocument } from '../../scripts/render-workskin-document.mjs';
import catalog from '../../assets/examples/workskins.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}
if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
            return false;
        },
    })) as typeof window.matchMedia;
}

let mounted: { container: HTMLDivElement; root: Root } | null = null;

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted = { container, root };
    return { container, root };
}

afterEach(() => {
    if (mounted) {
        act(() => mounted!.root.unmount());
        mounted.container.remove();
        mounted = null;
    }
});

describe('data-edit-* inline template sanitization & slot helpers', () => {
    it('strips data-edit-* silently on AO3 export while preserving them in live preview', () => {
        const html =
            '<div class="fx-box" data-edit-input="draft"><p data-edit-field="Title" data-edit-prefix="No. ">001</p><span data-edit="rich" data-foo="bad" onclick="evil()">Hi</span></div>';

        const diagnostics: unknown[] = [];
        const exported = renderAo3Content(html, (d) => diagnostics.push(d));
        expect(exported.html).not.toContain('data-edit-');
        expect(exported.html).not.toContain('data-foo');
        expect(exported.html).not.toContain('onclick');
        // Only the non-eo3 disallowed attributes emit diagnostics
        expect(diagnostics).toHaveLength(2);

        const cleanHtml =
            '<div class="fx-box" data-edit-input="draft"><p data-edit-field="Title">Hello</p><span data-edit="text">World</span></div>';
        const cleanDiags: unknown[] = [];
        const cleanExport = renderAo3Content(cleanHtml, (d) => cleanDiags.push(d));
        expect(cleanDiags).toEqual([]);
        expect(cleanExport.html).not.toContain('data-edit-');

        const preview = renderAo3Preview(html);
        expect(preview.html).toContain('data-edit-input="draft"');
        expect(preview.html).toContain('data-edit-field="Title"');
        expect(preview.html).toContain('data-edit-prefix="No. "');
        expect(preview.html).toContain('data-edit="rich"');
        expect(preview.html).not.toContain('data-foo');
        expect(preview.html).not.toContain('onclick');
    });

    it('stamps top-level editable slots and writes text/rich edits cleanly without leaking slot indices', () => {
        const source =
            '<div class="fx-card"><strong data-edit="text">Alex</strong><span data-edit="rich">Hello</span><div data-edit="rich"><p>Body</p></div></div>';
        const stamped = stampEditableSlots(source);
        expect(stamped).toContain('data-edit-slot-index="0"');
        expect(stamped).toContain('data-edit-slot-index="1"');
        expect(stamped).toContain('data-edit-slot-index="2"');

        // Plain text edit escapes HTML characters
        const afterText = writeEditableSlot(source, 0, 'text', 'Sam <3');
        expect(afterText).toContain('<strong data-edit="text">Sam &lt;3</strong>');
        expect(afterText).not.toContain('data-edit-slot-index');

        // Inline rich host (<span>) flattens <div>/<p> wrappers to <br> and strips scripts/attrs
        const afterInlineRich = writeEditableSlot(
            afterText,
            1,
            'rich',
            '<div>Line 1</div><div><em>Line 2</em><script>x()</script></div>'
        );
        expect(afterInlineRich).toContain(
            '<span data-edit="rich">Line 1<br><em>Line 2</em></span>'
        );
        expect(afterInlineRich).not.toContain('<script');

        // Block rich host (<div>) keeps paragraphs
        const afterBlockRich = writeEditableSlot(
            afterInlineRich,
            2,
            'rich',
            '<p>First</p><p><strong>Second</strong></p>'
        );
        expect(afterBlockRich).toContain(
            '<div data-edit="rich"><p>First</p><p><strong>Second</strong></p></div>'
        );
    });
});

describe('InlineChapterEditor inline CSS template editing', () => {
    it('edits plain HTML+CSS blocks directly in-place via data-edit and supports Escape revert', async () => {
        const { container, root } = mount();
        const doc = new Document();
        await doc.ensureSharedStyles();
        await MODULES['source.text'].load();

        const threadFile = EXAMPLE_GROUPS.find((g) => g.title === 'Text message thread')!;
        const inst = await instantiateGroupFile(threadFile);
        const lin = doc.linear;
        if ('layout' in lin) {
            doc.applyLinearLayout(
                {
                    parts: {
                        ...lin.layout.parts,
                        [doc.parts[0].id]: [{ kind: 'block', groupId: inst.group.id }],
                    },
                },
                { modules: inst.modules, groups: [inst.group] }
            );
        }

        const rerender = () => {
            act(() => {
                root.render(
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: null,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                );
            });
        };
        doc.addEventListener('change', rerender);

        try {
            rerender();
            const editableSlots = container.querySelectorAll<HTMLElement>(
                '.eo3-island-preview [data-edit-interactive="editable"]'
            );
            expect(editableSlots.length).toBe(4);
            expect(editableSlots[0].textContent).toBe('Alex');

            // Click speaker name, change text, and blur to commit
            act(() => {
                editableSlots[0].click();
            });
            expect(editableSlots[0].contentEditable).toBe('true');

            act(() => {
                editableSlots[0].textContent = 'Jordan';
                editableSlots[0].dispatchEvent(new Event('input', { bubbles: true }));
                editableSlots[0].dispatchEvent(new FocusEvent('blur'));
            });

            const htmlMod = doc.findModule(inst.modules[0].id)!;
            const savedHtml = String((htmlMod.data as { contents: string }).contents);
            expect(savedHtml).toContain('<strong data-edit="text">Jordan</strong>');
            expect(savedHtml).toContain('Are you there?');
            expect(savedHtml).not.toContain('data-edit-slot-index');

            // Click second speaker and press Escape to revert
            const updatedSlots = container.querySelectorAll<HTMLElement>(
                '.eo3-island-preview [data-edit-interactive="editable"]'
            );
            act(() => {
                updatedSlots[2].click();
            });
            act(() => {
                updatedSlots[2].textContent = 'Oops';
                updatedSlots[2].dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
                );
                updatedSlots[2].dispatchEvent(new FocusEvent('blur'));
            });
            const afterEsc = String(
                (doc.findModule(inst.modules[0].id)!.data as { contents: string }).contents
            );
            expect(afterEsc).toContain('<strong data-edit="text">Sam</strong>');
        } finally {
            doc.removeEventListener('change', rerender);
        }
    });

    it('edits standalone custom HTML modules containing data-edit', async () => {
        const { container, root } = mount();
        const doc = new Document();
        await doc.ensureSharedStyles();
        const textPlugin = await MODULES['source.text'].load();
        const htmlMod = new Module(textPlugin, {
            language: 'html',
            contents: '<div class="fx-note"><h4 data-edit="text">Heading</h4></div>',
        });
        const lin = doc.linear;
        if ('layout' in lin) {
            doc.applyLinearLayout(
                {
                    parts: {
                        ...lin.layout.parts,
                        [doc.parts[0].id]: [{ kind: 'module', moduleId: htmlMod.id }],
                    },
                },
                { modules: [htmlMod] }
            );
        }

        const rerender = () => {
            act(() => {
                root.render(
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: null,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                );
            });
        };
        doc.addEventListener('change', rerender);

        try {
            rerender();
            const heading = container.querySelector<HTMLElement>(
                '.eo3-island-preview h4[data-edit-interactive="editable"]'
            )!;
            expect(heading).not.toBeNull();
            act(() => heading.click());
            act(() => {
                heading.textContent = 'Updated heading';
                heading.dispatchEvent(new FocusEvent('blur'));
            });
            expect(
                String((doc.findModule(htmlMod.id)!.data as { contents: string }).contents)
            ).toContain('<h4 data-edit="text">Updated heading</h4>');
        } finally {
            doc.removeEventListener('change', rerender);
        }
    });

    it('edits Svelte AO3 template settings fields (including composite + prefixed) and draft body inline', async () => {
        const { container, root } = mount();
        const doc = new Document();
        await doc.ensureSharedStyles();

        const letterFile = EXAMPLE_GROUPS.find((g) => g.title === 'AO3 · Personal letter')!;
        const inst = await instantiateGroupFile(letterFile);
        const lin = doc.linear;
        if ('layout' in lin) {
            doc.applyLinearLayout(
                {
                    parts: {
                        ...lin.layout.parts,
                        [doc.parts[0].id]: [{ kind: 'block', groupId: inst.group.id }],
                    },
                },
                { modules: inst.modules, groups: [inst.group] }
            );
        }

        // Render the real AO3 · Personal letter HTML using the repo's workskin renderer
        const letterToml = parse(fs.readFileSync('assets/examples/ao3-letter.toml', 'utf8'), {
            joiner: '\n',
            bigint: false,
        }) as any;
        const { html: renderedLetterHtml } = await renderWorkskinDocument(letterToml);
        const composeModId = inst.modules[2].id;
        const settingsModId = inst.modules[6].id;
        const draftModId = inst.modules[0].id;

        const fakeRenderOutput: RenderOutput = {
            type: 'output',
            target: null,
            work: null,
            outputs: new Map([[composeModId, { asMdOutput: () => renderedLetterHtml } as any]]),
            userData: new Map(),
            drop: () => {},
        };

        const rerender = () => {
            act(() => {
                root.render(
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: fakeRenderOutput,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                );
            });
        };
        doc.addEventListener('change', rerender);

        try {
            rerender();

            // 1. Edit a simple settings field (`To`)
            const greeting = container.querySelector<HTMLElement>(
                '.eo3-island-preview [data-edit-field="To"][data-edit-interactive="field"]'
            )!;
            expect(greeting).not.toBeNull();
            act(() => greeting.click());
            const input = greeting.querySelector<HTMLInputElement>('input.eo3-inline-field-input')!;
            expect(input).not.toBeNull();
            expect(input.value).toBe('Dear Person B,');

            act(() => {
                input.value = 'Dear Sam,';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new FocusEvent('blur'));
            });
            const settingsAfterTo = doc.findModule(settingsModId)!.data as unknown as SettingsData;
            expect(settingsAfterTo.values.To).toBe('Dear Sam,');

            // 2. Edit composite field (`Closing` before `<br /><span data-edit-field="From">`)
            const signature = container.querySelector<HTMLElement>(
                '.eo3-island-preview [data-edit-field="Closing"][data-edit-interactive="field"]'
            )!;
            expect(signature).not.toBeNull();
            act(() => signature.click());
            const closingInput = signature.querySelector<HTMLInputElement>(
                'input.eo3-inline-field-input'
            )!;
            expect(closingInput).not.toBeNull();
            expect(closingInput.value).toBe('Yours,');
            // Sibling `From` span remains completely intact while editing `Closing`
            expect(signature.querySelector('[data-edit-field="From"]')?.textContent).toBe(
                'Person A'
            );

            act(() => {
                closingInput.value = 'With care,';
                closingInput.dispatchEvent(new Event('input', { bubbles: true }));
                closingInput.dispatchEvent(new FocusEvent('blur'));
            });
            const settingsAfterClosing = doc.findModule(settingsModId)!
                .data as unknown as SettingsData;
            expect(settingsAfterClosing.values.Closing).toBe('With care,');

            // 3. Click `[data-edit-input="draft"]` to edit the letter body in-place inside the frame
            const bodyRegion = container.querySelector<HTMLElement>(
                '.eo3-island-preview [data-edit-input="draft"][data-edit-interactive="input"]'
            )!;
            expect(bodyRegion).not.toBeNull();
            act(() => bodyRegion.click());

            const textarea = bodyRegion.querySelector<HTMLTextAreaElement>(
                'textarea.eo3-inline-draft-textarea'
            )!;
            expect(textarea).not.toBeNull();
            expect(bodyRegion.querySelector('.eo3-inline-draft-hints')).not.toBeNull();

            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!
                .set!;
            act(() => {
                setter.call(textarea, 'Brand new letter body.');
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            });
            const doneBtn = bodyRegion.querySelector<HTMLButtonElement>('.eo3-inline-draft-done')!;
            act(() => doneBtn.click());

            expect(
                String((doc.findModule(draftModId)!.data as { contents: string }).contents)
            ).toBe('Brand new letter body.');
            expect(bodyRegion.querySelector('textarea.eo3-inline-draft-textarea')).toBeNull();
        } finally {
            doc.removeEventListener('change', rerender);
        }
    });

    it('preserves prefix on data-edit-prefix fields (Case file Number) and does not hijack <summary> in Collapsible extras', async () => {
        const { container, root } = mount();
        const doc = new Document();
        await doc.ensureSharedStyles();

        const caseFile = EXAMPLE_GROUPS.find((g) => g.title === 'AO3 · Case file')!;
        const extrasFile = EXAMPLE_GROUPS.find((g) => g.title === 'AO3 · Collapsible extras')!;
        const caseInst = await instantiateGroupFile(caseFile);
        const extrasInst = await instantiateGroupFile(extrasFile);

        const lin = doc.linear;
        if ('layout' in lin) {
            doc.applyLinearLayout(
                {
                    parts: {
                        ...lin.layout.parts,
                        [doc.parts[0].id]: [
                            { kind: 'block', groupId: caseInst.group.id },
                            { kind: 'block', groupId: extrasInst.group.id },
                        ],
                    },
                },
                {
                    modules: [...caseInst.modules, ...extrasInst.modules],
                    groups: [caseInst.group, extrasInst.group],
                }
            );
        }

        const caseToml = parse(fs.readFileSync('assets/examples/ao3-case-file.toml', 'utf8'), {
            joiner: '\n',
            bigint: false,
        }) as any;
        const extrasToml = parse(
            fs.readFileSync('assets/examples/ao3-collapsible-notes.toml', 'utf8'),
            { joiner: '\n', bigint: false }
        ) as any;
        const [{ html: caseHtml }, { html: extrasHtml }] = await Promise.all([
            renderWorkskinDocument(caseToml),
            renderWorkskinDocument(extrasToml),
        ]);

        const fakeRenderOutput: RenderOutput = {
            type: 'output',
            target: null,
            work: null,
            outputs: new Map([
                [caseInst.modules[2].id, { asMdOutput: () => caseHtml } as any],
                [extrasInst.modules[2].id, { asMdOutput: () => extrasHtml } as any],
            ]),
            userData: new Map(),
            drop: () => {},
        };

        act(() => {
            root.render(
                createElement(InlineChapterEditor, {
                    document: doc,
                    partId: doc.parts[0].id,
                    renderOutput: fakeRenderOutput,
                    fallbackHtml: '',
                    panelOpen: false,
                    onTogglePanel: () => {},
                })
            );
        });

        // Case file Number has `data-edit-prefix="No. "` so the input edits `"0001"` directly
        const numSpan = container.querySelector<HTMLElement>(
            '.eo3-island-preview [data-edit-field="Number"][data-edit-interactive="field"]'
        )!;
        expect(numSpan).not.toBeNull();
        act(() => numSpan.click());
        const numInput = numSpan.querySelector<HTMLInputElement>('input.eo3-inline-field-input')!;
        expect(numInput.value).toBe('0001');
        expect(numSpan.textContent).toContain('No. ');

        act(() => {
            numInput.value = '0042';
            numInput.dispatchEvent(new Event('input', { bubbles: true }));
            numInput.dispatchEvent(new FocusEvent('blur'));
        });
        const caseSettings = doc.findModule(caseInst.modules[6].id)!
            .data as unknown as SettingsData;
        expect(caseSettings.values.Number).toBe('0042');
        expect(numSpan.textContent).toBe('No. 0042');

        // Clicking <summary> inside Collapsible extras does NOT open the draft textarea
        const summary = container.querySelector<HTMLElement>(
            '.eo3-island-preview .fic-extras summary'
        )!;
        expect(summary).not.toBeNull();
        act(() => summary.click());
        expect(container.querySelector('.eo3-inline-draft-editor')).toBeNull();
    });

    it('annotates every bundled AO3 workskin and starter HTML+CSS block for inline editing with clean AO3 export', async () => {
        // All 14 AO3 workskins
        for (const item of catalog) {
            const toml = parse(fs.readFileSync(`assets/examples/${item.file}`, 'utf8'), {
                joiner: '\n',
                bigint: false,
            }) as any;
            const { html } = await renderWorkskinDocument(toml);
            const preview = renderAo3Preview(html).html;
            expect(preview, item.title).toContain('data-edit-input="draft"');
            expect(preview, item.title).toContain('data-edit-field=');

            const diags: unknown[] = [];
            const exported = renderAo3Content(html, (d) => diags.push(d)).html;
            expect(diags, item.title).toEqual([]);
            expect(exported, item.title).not.toContain('data-edit-');
        }

        // All 3 starter HTML+CSS blocks
        for (const title of ['Text message thread', 'Letter', 'Chat log']) {
            const block = EXAMPLE_GROUPS.find((g) => g.title === title)!;
            const html = String((block.modules[0].data as { contents: string }).contents);
            const preview = renderAo3Preview(stampEditableSlots(html)).html;
            expect(preview, title).toContain('data-edit=');
            expect(preview, title).toContain('data-edit-slot-index=');

            const diags: unknown[] = [];
            const exported = renderAo3Content(html, (d) => diags.push(d)).html;
            expect(diags, title).toEqual([]);
            expect(exported, title).not.toContain('data-edit');
        }
    });

    it('switches between editable slots in a single mousedown without losing clicks and supports Tab/Shift+Tab navigation', async () => {
        const { container, root } = mount();
        const doc = new Document();
        await doc.ensureSharedStyles();
        await MODULES['source.text'].load();

        const threadFile = EXAMPLE_GROUPS.find((g) => g.title === 'Text message thread')!;
        const inst = await instantiateGroupFile(threadFile);
        const lin = doc.linear;
        if ('layout' in lin) {
            doc.applyLinearLayout(
                {
                    parts: {
                        ...lin.layout.parts,
                        [doc.parts[0].id]: [{ kind: 'block', groupId: inst.group.id }],
                    },
                },
                { modules: inst.modules, groups: [inst.group] }
            );
        }

        const rerender = () => {
            act(() => {
                root.render(
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: null,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                );
            });
        };
        doc.addEventListener('change', rerender);

        try {
            rerender();
            const slots = container.querySelectorAll<HTMLElement>(
                '.eo3-island-preview [data-edit-interactive="editable"]'
            );
            expect(slots.length).toBe(4);

            // Start editing slot 0 via mousedown (single gesture), edit it, then mousedown directly on slot 1
            act(() => {
                slots[0].dispatchEvent(
                    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
                );
            });
            expect(slots[0].contentEditable).toBe('true');

            act(() => {
                slots[0].textContent = 'Morgan';
                slots[0].dispatchEvent(new Event('input', { bubbles: true }));
                // Single-click handoff to slot 1: mousedown commits slot 0 AND immediately activates slot 1
                slots[1].dispatchEvent(
                    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
                );
                slots[0].dispatchEvent(new FocusEvent('blur'));
                slots[1].click();
            });

            // Slot 0 was committed and slot 1 is still connected & actively editable on the first click
            expect(slots[1].isConnected).toBe(true);
            expect(slots[1].contentEditable).toBe('true');
            expect(slots[0].contentEditable).toBe('false');
            expect(
                String((doc.findModule(inst.modules[0].id)!.data as { contents: string }).contents)
            ).toContain('<strong data-edit="text">Morgan</strong>');

            // Press Tab to jump from slot 1 to slot 2, then Shift+Tab back to slot 1
            act(() => {
                slots[1].textContent = 'On my way!';
                slots[1].dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
                );
            });
            expect(slots[2].contentEditable).toBe('true');
            expect(slots[1].contentEditable).toBe('false');
            expect(
                String((doc.findModule(inst.modules[0].id)!.data as { contents: string }).contents)
            ).toContain('On my way!');

            act(() => {
                slots[2].dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Tab',
                        shiftKey: true,
                        bubbles: true,
                        cancelable: true,
                    })
                );
            });
            expect(slots[1].contentEditable).toBe('true');
            expect(slots[2].contentEditable).toBe('false');
        } finally {
            doc.removeEventListener('change', rerender);
        }
    });

    it('triggers immediate renderNow on committing Svelte field & draft edits and unmounts closed DirPopover children', async () => {
        const { container, root } = mount();
        const doc = new Document();
        await doc.ensureSharedStyles();

        const letterFile = EXAMPLE_GROUPS.find((g) => g.title === 'AO3 · Personal letter')!;
        const inst = await instantiateGroupFile(letterFile);
        const lin = doc.linear;
        if ('layout' in lin) {
            doc.applyLinearLayout(
                {
                    parts: {
                        ...lin.layout.parts,
                        [doc.parts[0].id]: [{ kind: 'block', groupId: inst.group.id }],
                    },
                },
                { modules: inst.modules, groups: [inst.group] }
            );
        }

        const letterToml = parse(fs.readFileSync('assets/examples/ao3-letter.toml', 'utf8'), {
            joiner: '\n',
            bigint: false,
        }) as any;
        const { html: renderedLetterHtml } = await renderWorkskinDocument(letterToml);
        const composeModId = inst.modules[2].id;
        const renderNow = vi.fn();
        const fakeRenderOutput: RenderOutput = {
            type: 'output',
            target: null,
            work: null,
            outputs: new Map([[composeModId, { asMdOutput: () => renderedLetterHtml } as any]]),
            userData: new Map(),
            drop: () => {},
        };

        act(() => {
            root.render(
                createElement(
                    RenderContext.Provider,
                    { value: { scheduleRender: () => {}, renderNow } },
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: fakeRenderOutput,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                )
            );
        });

        // Closed island popover should not mount its heavy editor tree
        expect(document.body.querySelector('.eo3-island-popover')).toBeNull();

        // Commit a settings field change -> renderNow called immediately
        const greeting = container.querySelector<HTMLElement>(
            '.eo3-island-preview [data-edit-field="To"][data-edit-interactive="field"]'
        )!;
        act(() => {
            greeting.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
            );
        });
        const input = greeting.querySelector<HTMLInputElement>('input.eo3-inline-field-input')!;
        expect(input).not.toBeNull();
        act(() => {
            input.value = 'Dear Riley,';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new FocusEvent('blur'));
        });
        expect(renderNow).toHaveBeenCalledTimes(1);

        // Verify DirPopover mounts children on open and unmounts immediately on close
        let isOpen = true;
        const popContainer = document.createElement('div');
        document.body.appendChild(popContainer);
        const popRoot = createRoot(popContainer);
        try {
            const renderPopover = () => {
                act(() => {
                    popRoot.render(
                        createElement(DirPopover, {
                            open: isOpen,
                            onClose: () => {},
                            children: createElement('div', { className: 'test-pop-child' }, 'Hello'),
                        })
                    );
                });
            };
            renderPopover();
            expect(popContainer.querySelector('.test-pop-child')).not.toBeNull();

            isOpen = false;
            renderPopover();
            expect(popContainer.querySelector('.test-pop-child')).toBeNull();
        } finally {
            act(() => popRoot.unmount());
            popContainer.remove();
        }
    });
});
