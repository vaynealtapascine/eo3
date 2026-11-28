import React, { useEffect, useRef, useState } from 'react';
import { homepage as repositoryUrl } from '../../package.json';
import {
    findHelpTopic,
    HELP_TOPICS,
    linkHelpHtml,
    OPEN_HELP_EVENT,
    renderHelpMarkdown,
} from './help-content';
import './help.css';

/** Mounted once beside the app; `openHelp()` (help-content.ts) opens it from anywhere. */
export function HelpHost() {
    const [open, setOpen] = useState(false);
    const [topicId, setTopicId] = useState(HELP_TOPICS[0].id);

    useEffect(() => {
        const onOpen = (event: Event) => {
            const id = (event as CustomEvent<string | null>).detail;
            if (id && findHelpTopic(id)) setTopicId(id);
            setOpen(true);
        };
        window.addEventListener(OPEN_HELP_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen);
    }, []);

    return (
        <HelpDialog
            open={open}
            topicId={topicId}
            onTopic={setTopicId}
            onClose={() => setOpen(false)}
        />
    );
}

type Loaded = { id: string; html: string } | { id: string; error: string };

function HelpDialog({
    open,
    topicId,
    onTopic,
    onClose,
}: {
    open: boolean;
    topicId: string;
    onTopic: (id: string) => void;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const article = useRef<HTMLElement>(null);
    const [loaded, setLoaded] = useState<Loaded | null>(null);

    useEffect(() => {
        const el = dialog.current;
        if (!el) return;
        if (open && !el.open) {
            if (typeof el.showModal === 'function') el.showModal();
            else el.setAttribute('open', '');
        }
        if (!open && el.open) {
            if (typeof el.close === 'function') el.close();
            else el.removeAttribute('open');
        }
    }, [open]);

    // Guides load (and the Markdown renderer with them) only once someone opens Help.
    useEffect(() => {
        if (!open) return;
        const topic = findHelpTopic(topicId);
        if (!topic || loaded?.id === topicId) return;
        let alive = true;
        topic
            .load()
            .then(renderHelpMarkdown)
            .then((html) => {
                if (alive) setLoaded({ id: topic.id, html: linkHelpHtml(html, repositoryUrl) });
            })
            .catch((error) => {
                if (alive) setLoaded({ id: topic.id, error: String(error) });
            });
        return () => {
            alive = false;
        };
    }, [open, topicId]);

    useEffect(() => {
        article.current?.scrollTo?.(0, 0);
    }, [loaded?.id]);

    const onArticleClick = (event: React.MouseEvent) => {
        const link = (event.target as Element).closest('a[data-help-topic]');
        if (!link) return;
        event.preventDefault();
        onTopic(link.getAttribute('data-help-topic')!);
    };

    const current = loaded?.id === topicId ? loaded : null;

    return (
        <dialog
            ref={dialog}
            className="help-dialog"
            aria-labelledby="help-dialog-title"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <header className="i-heading">
                <h2 id="help-dialog-title">Help</h2>
                <button className="i-close" onClick={onClose} aria-label="Close help">
                    ×
                </button>
            </header>
            <div className="i-body">
                <nav className="i-topics" aria-label="Guides">
                    {HELP_TOPICS.map((topic) => (
                        <button
                            key={topic.id}
                            type="button"
                            className={'i-topic' + (topic.id === topicId ? ' is-active' : '')}
                            aria-current={topic.id === topicId ? 'page' : undefined}
                            onClick={() => onTopic(topic.id)}
                        >
                            <span className="i-topic-title">{topic.title}</span>
                            <span className="i-topic-summary">{topic.summary}</span>
                        </button>
                    ))}
                </nav>
                <article ref={article} className="i-article" onClick={onArticleClick}>
                    {!open ? null : !current ? (
                        <p className="i-status">Loading…</p>
                    ) : 'error' in current ? (
                        <p className="i-status is-error">
                            This guide couldn’t be opened: {current.error}
                        </p>
                    ) : (
                        <div
                            className="help-markdown"
                            // Our own bundled guides, rendered without their raw HTML.
                            dangerouslySetInnerHTML={{ __html: current.html }}
                        />
                    )}
                </article>
            </div>
        </dialog>
    );
}
