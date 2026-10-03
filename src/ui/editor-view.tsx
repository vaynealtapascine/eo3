import { useEffect, useRef, useState } from 'react';
import './editor-view.css';

/**
 * Which editor a work opens in: "simple" (each chapter is an ordered list, see `linear.ts`) or
 * "nodes" (the graph). One choice for every work, kept in this browser. Unset until the
 * author answers the welcome question, and treated as "simple" until then.
 */
export type EditorView = 'simple' | 'nodes';

const STORAGE_KEY = 'eo3-editor-view';
const listeners = new Set<() => void>();
/** The choice when the browser refuses storage (some private windows); lasts until reload. */
let fallback: EditorView | null = null;

export function storedEditorView(): EditorView | null {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === 'simple' || value === 'nodes' ? value : null;
    } catch {
        return null;
    }
}

export function setEditorView(view: EditorView) {
    try {
        localStorage.setItem(STORAGE_KEY, view);
    } catch {
        fallback = view;
    }
    for (const listener of listeners) listener();
}

const currentView = (): EditorView => storedEditorView() ?? fallback ?? 'simple';

export function useEditorView(): EditorView {
    const [view, setView] = useState(currentView);
    useEffect(() => {
        const update = () => setView(currentView());
        const onStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY) update();
        };
        listeners.add(update);
        window.addEventListener('storage', onStorage);
        return () => {
            listeners.delete(update);
            window.removeEventListener('storage', onStorage);
        };
    }, []);
    return view;
}

/** The toolbar's simple / nodes switch. */
export function EditorViewSwitch({ view }: { view: EditorView }) {
    return (
        <div className="editor-view-switch" role="radiogroup" aria-label="Editor view">
            {(['simple', 'nodes'] as const).map((option) => (
                <button
                    key={option}
                    role="radio"
                    aria-checked={view === option}
                    className={view === option ? 'is-active' : ''}
                    title={
                        option === 'simple'
                            ? 'Edit each chapter as a list'
                            : 'Edit the work as a graph of nodes'
                    }
                    onClick={() => setEditorView(option)}
                >
                    {option}
                </button>
            ))}
        </div>
    );
}

/** Asked once, the first time eo3 opens in this browser. */
export function EditorViewWelcome() {
    const dialog = useRef<HTMLDialogElement>(null);
    const [asked, setAsked] = useState(() => storedEditorView() !== null || fallback !== null);

    useEffect(() => {
        if (!asked && dialog.current && !dialog.current.open) dialog.current.showModal();
    }, [asked]);

    if (asked) return null;
    const choose = (view: EditorView) => {
        setEditorView(view);
        dialog.current?.close();
        setAsked(true);
    };
    return (
        <dialog
            ref={dialog}
            className="app-dialog editor-view-welcome"
            aria-labelledby="editor-view-welcome-title"
            onCancel={(event) => {
                event.preventDefault();
                choose('simple');
            }}
        >
            <h2 id="editor-view-welcome-title">How would you like to edit?</h2>
            <div className="i-choices">
                <button className="i-choice is-primary" autoFocus onClick={() => choose('simple')}>
                    <strong>Simple</strong>
                    <span>
                        Each chapter is a list of your text, styles and ready-made blocks, top to
                        bottom. Best if you just want to write and post.
                    </span>
                </button>
                <button className="i-choice" onClick={() => choose('nodes')}>
                    <strong>Nodes</strong>
                    <span>
                        Wire modules together in a graph. For full control, if you’ve used
                        prechoster or node editors before.
                    </span>
                </button>
            </div>
            <p className="i-note">You can switch any time with “simple / nodes” in the toolbar.</p>
        </dialog>
    );
}
