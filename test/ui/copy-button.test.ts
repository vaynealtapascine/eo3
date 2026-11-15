import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyToClipboardButton } from '../../src/ui/components/post-preview/copy-to-clipboard-button';

vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? children : null,
}));
vi.mock('../../src/uikit/button', () => ({
    Button: ({ run, children }: { run: () => unknown; children: React.ReactNode }) =>
        createElement('button', { onClick: () => void run() }, children),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.unstubAllGlobals();
});

const setClipboard = (writeText: ((text: string) => Promise<void>) | undefined) =>
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: writeText ? { writeText } : undefined,
    });

const render = (onCopied: (id: string) => void, warnings: string[] = []) =>
    act(() =>
        root.render(
            createElement(CopyToClipboardButton, {
                action: {
                    id: 'copy-html',
                    label: 'copy HTML',
                    outputId: 'html',
                    getWarnings: () => warnings,
                },
                exportOutput: new Map([['html', '<p>Chapter one</p>']]),
                onCopied,
            })
        )
    );

const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === label
    );
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
};

describe('copy to clipboard button', () => {
    it('reports the copy only after the browser confirms it', async () => {
        let finish!: () => void;
        const writeText = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
        setClipboard(writeText);
        const onCopied = vi.fn();
        render(onCopied);

        await click('copy HTML');
        expect(writeText).toHaveBeenCalledWith('<p>Chapter one</p>');
        expect(onCopied).not.toHaveBeenCalled();
        expect(container.querySelector('.did-copy')).toBeNull();

        await act(async () => finish());
        expect(onCopied).toHaveBeenCalledWith('html');
        expect(container.querySelector('.did-copy')).not.toBeNull();
        expect(container.querySelector('textarea')).toBeNull();
    });

    it.each([
        ['the browser refuses', () => Promise.reject(new Error('NotAllowedError'))],
        ['there is no clipboard access', undefined],
    ])('offers the text to copy by hand when %s', async (_, writeText) => {
        setClipboard(writeText);
        const onCopied = vi.fn();
        render(onCopied);

        await click('copy HTML');
        expect(onCopied).not.toHaveBeenCalled();
        expect(container.querySelector('.did-copy')).toBeNull();
        const text = container.querySelector('textarea')!;
        expect(text.value).toBe('<p>Chapter one</p>');
        expect(text.readOnly).toBe(true);

        // copying it by hand still counts as copied
        act(() => Simulate.copy(text));
        expect(onCopied).toHaveBeenCalledWith('html');

        await click('done');
        expect(container.querySelector('textarea')).toBeNull();
    });

    it('does not report a refused copy made past a warning', async () => {
        setClipboard(() => Promise.reject(new Error('NotAllowedError')));
        const onCopied = vi.fn();
        render(onCopied, ['This chapter is very long.']);

        await click('copy HTML');
        expect(container.textContent).toContain('This chapter is very long.');
        await click('copy anyway');
        expect(onCopied).not.toHaveBeenCalled();
        expect(container.querySelector('textarea')).not.toBeNull();
    });
});
