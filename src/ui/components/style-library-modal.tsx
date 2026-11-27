import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CssPieceKind } from '../../editor/css-pieces';
import {
    inspectStyleForAo3,
    isValidCssClassName,
    normalizeStyleEntry,
    parseStylePackFile,
    slugifyClassName,
    stringifyStylePackFile,
    stylePackFileName,
    type StylePackFile,
    type StylePackStyle,
} from '../../storage/style-file';
import {
    buildStylePackExport,
    importStylePack,
    listLibraryStyles,
    removeLibraryStyle,
    saveLibraryStyle,
    subscribeLibraryStyles,
    updateLibraryStyle,
    type LibraryStyle,
} from '../../storage/style-library';
import { downloadFile } from '../../util/download';
import { StyleSwatch } from './style-swatch';
import './style-library-modal.css';
import Checkbox from '../../uikit/checkbox';

export type StyleLibraryTab = 'create' | 'import' | 'library';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

interface DraftStyle {
    label: string;
    description: string;
    kind: CssPieceKind;
    className: string;
    previewSample: string;
    css: string;
    templateHtml: string;
    previewHtml: string;
    previewCss: string;
    author: string;
    pack: string;
}

const STARTERS: Record<CssPieceKind, Omit<DraftStyle, 'author' | 'pack'>> = {
    inline: {
        label: 'Golden glint',
        description: 'Warm gilded accent text for magic or emphasis',
        kind: 'inline',
        className: 'fx-gold-glint',
        previewSample: 'shimmer',
        css: `.fx-gold-glint {
  color: #8a5a00;
  background-color: #fff6d6;
  border-bottom: 2px solid #d4a017;
  padding: 0 0.25em;
  border-radius: 0.2em;
  font-weight: bold;
}`,
        templateHtml: '',
        previewHtml: '',
        previewCss: '',
    },
    block: {
        label: 'System alert',
        description: 'Crisp sci-fi notification panel for HUD messages',
        kind: 'block',
        className: 'fx-sys-alert',
        previewSample: '[ALERT] Hull breach',
        css: `.fx-sys-alert {
  background-color: #101926;
  color: #9be8ff;
  border: 1px solid #2b6cb0;
  border-left: 4px solid #38bdf8;
  border-radius: 0.35em;
  padding: 0.85em 1.1em;
  margin: 1em 0;
  font-family: monospace;
  line-height: 1.5;
}
.fx-sys-alert p:last-child {
  margin-bottom: 0;
}`,
        templateHtml: '',
        previewHtml: '',
        previewCss: '',
    },
    template: {
        label: 'Social post',
        description: 'Compact social media card with handle and timestamp',
        kind: 'template',
        className: 'fx-social-post',
        previewSample: 'Wait, did that really just happen?!',
        css: `.fx-social-post {
  max-width: 28em;
  margin: 1em auto;
  padding: 0.9em 1.1em;
  border: 1px solid #d8dee6;
  border-radius: 0.75em;
  background-color: #ffffff;
  color: #1c2430;
  font-family: sans-serif;
  line-height: 1.45;
}
.fx-social-post .fx-social-head {
  margin: 0 0 0.45em;
  font-size: 0.92em;
}
.fx-social-post .fx-social-handle {
  color: #5b6b7c;
  font-size: 0.92em;
}
.fx-social-post .fx-social-body {
  margin: 0 0 0.55em;
}
.fx-social-post .fx-social-meta {
  margin: 0;
  color: #6b7785;
  font-size: 0.8em;
}`,
        templateHtml: `<div class="fx-social-post">
  <p class="fx-social-head"><strong>Display Name</strong> <span class="fx-social-handle">@handle</span></p>
  <p class="fx-social-body">{{selection|Write the post text here…}}</p>
  <p class="fx-social-meta">11:42 PM · 1.2K Likes</p>
</div>`,
        previewHtml: '',
        previewCss: '',
    },
};

function blankDraft(kind: CssPieceKind = 'inline'): DraftStyle {
    return {
        ...STARTERS[kind],
        author: '',
        pack: '',
    };
}

function entryToDraft(entry: LibraryStyle): DraftStyle {
    return {
        label: entry.style.label,
        description: entry.style.description,
        kind: entry.style.kind,
        className: entry.style.className,
        previewSample: entry.style.previewSample,
        css: entry.style.css,
        templateHtml: entry.style.templateHtml ?? '',
        previewHtml: entry.style.previewHtml ?? '',
        previewCss: entry.style.previewCss ?? '',
        author: entry.style.author ?? entry.author ?? '',
        pack: entry.pack ?? '',
    };
}

function kindLabel(kind: CssPieceKind): string {
    if (kind === 'inline') return 'Inline';
    if (kind === 'block') return 'Block';
    return 'Template';
}

export function StyleLibraryModal({
    open,
    initialTab = 'import',
    initialEditId = null,
    onClose,
}: {
    open: boolean;
    initialTab?: StyleLibraryTab;
    initialEditId?: string | null;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [tab, setTab] = useState<StyleLibraryTab>(initialTab);
    const [entries, setEntries] = useState<LibraryStyle[]>(() => listLibraryStyles());
    const [editingId, setEditingId] = useState<string | null>(initialEditId);

    // Sync library entries across mutations / tabs.
    useEffect(() => {
        const refresh = () => setEntries(listLibraryStyles());
        refresh();
        return subscribeLibraryStyles(refresh);
    }, []);

    // Open/close native <dialog> and reset initial tab when opened.
    useEffect(() => {
        const node = dialogRef.current;
        if (!node) return;
        if (open) {
            setTab(initialTab);
            setEditingId(initialEditId);
            if (!node.open) node.showModal();
        } else if (node.open) {
            node.close();
        }
    }, [open, initialTab, initialEditId]);

    const dialog = (
        <dialog
            ref={dialogRef}
            className="eo3-style-modal"
            aria-label="Custom styles and style packs"
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
            onClick={(e) => {
                if (e.target === dialogRef.current) onClose();
            }}
        >
            {open ? (
                <div className="i-modal-shell">
                    <header className="i-modal-header">
                        <div className="i-modal-title-group">
                            <h2>Custom styles &amp; packs</h2>
                            <div
                                className="i-modal-tabs"
                                role="tablist"
                                aria-label="Style manager views"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === 'import'}
                                    className={tab === 'import' ? 'is-active' : ''}
                                    onClick={() => setTab('import')}
                                >
                                    Import pack
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === 'create'}
                                    className={tab === 'create' ? 'is-active' : ''}
                                    onClick={() => setTab('create')}
                                >
                                    {editingId ? 'Edit style' : 'Create & export'}
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === 'library'}
                                    className={tab === 'library' ? 'is-active' : ''}
                                    onClick={() => setTab('library')}
                                >
                                    Library &amp; export
                                    {entries.length ? ` (${entries.length})` : ''}
                                </button>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="i-modal-close"
                            aria-label="Close"
                            onClick={onClose}
                        >
                            ×
                        </button>
                    </header>

                    <div className="i-modal-body">
                        {tab === 'import' ? (
                            <ImportPackTab onImported={() => setTab('library')} />
                        ) : tab === 'create' ? (
                            <CreateStyleTab
                                editingEntry={
                                    editingId
                                        ? entries.find((e) => e.id === editingId) ?? null
                                        : null
                                }
                                onDoneEditing={() => setEditingId(null)}
                            />
                        ) : (
                            <LibraryExportTab
                                entries={entries}
                                onEdit={(id) => {
                                    setEditingId(id);
                                    setTab('create');
                                }}
                                onGoImport={() => setTab('import')}
                                onGoCreate={() => {
                                    setEditingId(null);
                                    setTab('create');
                                }}
                            />
                        )}
                    </div>
                </div>
            ) : null}
        </dialog>
    );

    return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
}

/* ── Import Tab ─────────────────────────────────────────────────────────────────────────────── */

function ImportPackTab({ onImported }: { onImported: () => void }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingPack, setPendingPack] = useState<StylePackFile | null>(null);
    const [cleanCssOnImport, setCleanCssOnImport] = useState(false);
    const [pastedJson, setPastedJson] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadSource = (source: string) => {
        setError('');
        setStatus('');
        try {
            const pack = parseStylePackFile(source);
            setPendingPack(pack);
        } catch (err) {
            setPendingPack(null);
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) {
            setError('This file is larger than 2 MiB.');
            return;
        }
        try {
            const text = await file.text();
            loadSource(text);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const inspections = useMemo(() => {
        if (!pendingPack) return [];
        return pendingPack.styles.map((style) => inspectStyleForAo3(style));
    }, [pendingPack]);

    const anyCssWarnings = inspections.some((item) => item.cssWarnings.length > 0);

    const confirmImport = () => {
        if (!pendingPack) return;
        try {
            const result = importStylePack(pendingPack, { cleanCssForAo3: cleanCssOnImport });
            const parts: string[] = [];
            if (result.added) parts.push(`added ${result.added}`);
            if (result.updated) parts.push(`updated ${result.updated}`);
            setStatus(`Imported “${pendingPack.title}” (${parts.join(', ') || 'no changes'}).`);
            setPendingPack(null);
            setPastedJson('');
            onImported();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <div className="i-tab-import">
            <p className="i-tab-intro">
                Import a shared <code>.eo3styles.json</code> file from a designer or friend. Each
                style is added to your <strong>✦ Styles</strong> menu with its own preview, name,
                and description — no coding required.
            </p>

            <div
                className={'i-dropzone' + (dragOver ? ' is-dragover' : '')}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void handleFile(e.dataTransfer.files?.[0]);
                }}
            >
                <p>
                    Drop a <code>.eo3styles.json</code> file here, or choose one from your device.
                </p>
                <button
                    type="button"
                    className="i-btn is-primary"
                    onClick={() => fileInputRef.current?.click()}
                >
                    Choose style file…
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".eo3styles.json,.json,application/json"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        void handleFile(file);
                    }}
                />
            </div>

            <details className="i-paste-details">
                <summary>Or paste style pack JSON</summary>
                <div className="i-paste-box">
                    <textarea
                        rows={6}
                        placeholder='{"eo3": "styles", "version": 1, "title": "My Pack", "styles": [...]}'
                        aria-label="Paste style pack JSON"
                        value={pastedJson}
                        onChange={(e) => setPastedJson(e.target.value)}
                    />
                    <div className="i-row-actions">
                        <button
                            type="button"
                            className="i-btn"
                            disabled={!pastedJson.trim()}
                            onClick={() => loadSource(pastedJson)}
                        >
                            Preview pack
                        </button>
                    </div>
                </div>
            </details>

            {error ? (
                <p className="i-banner is-error" role="alert">
                    {error}
                </p>
            ) : null}
            {status ? (
                <p className="i-banner is-ok" role="status">
                    {status}
                </p>
            ) : null}

            {pendingPack ? (
                <div className="i-import-preview">
                    <div className="i-pack-header">
                        <div>
                            <h3>{pendingPack.title}</h3>
                            <p className="i-pack-meta">
                                {pendingPack.styles.length}{' '}
                                {pendingPack.styles.length === 1 ? 'style' : 'styles'}
                                {pendingPack.author ? ` · by ${pendingPack.author}` : ''}
                            </p>
                            {pendingPack.description ? (
                                <p className="i-pack-desc">{pendingPack.description}</p>
                            ) : null}
                        </div>
                    </div>

                    <div className="i-import-list">
                        {pendingPack.styles.map((style, idx) => {
                            const report = inspections[idx];
                            const warnings = [...report.cssWarnings, ...report.htmlWarnings];
                            return (
                                <div key={`${style.className}-${idx}`} className="i-style-card">
                                    <div className="i-style-card-main">
                                        <StyleSwatch piece={style} mode="compact" />
                                        <div className="i-style-card-info">
                                            <div className="i-style-card-title">
                                                <strong>{style.label}</strong>
                                                <span className="i-kind-pill">
                                                    {kindLabel(style.kind)}
                                                </span>
                                            </div>
                                            {style.description ? (
                                                <p className="i-style-card-desc">
                                                    {style.description}
                                                </p>
                                            ) : null}
                                            <p className="i-style-card-sub">
                                                <code>.{style.className}</code>
                                                {style.author && style.author !== pendingPack.author
                                                    ? ` · by ${style.author}`
                                                    : ''}
                                            </p>
                                        </div>
                                    </div>
                                    {warnings.length ? (
                                        <ul className="i-warning-list">
                                            {warnings.map((w, wi) => (
                                                <li key={wi}>{w}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>

                    {anyCssWarnings ? (
                        <label className="i-check-row">
                            <Checkbox
                                checked={cleanCssOnImport}
                                onChange={(checked) => setCleanCssOnImport(checked)}
                            />
                            <span>
                                Strip AO3-unsupported CSS rules on import (recommended for AO3
                                compatibility)
                            </span>
                        </label>
                    ) : null}

                    <div className="i-modal-footer">
                        <button
                            type="button"
                            className="i-btn"
                            onClick={() => setPendingPack(null)}
                        >
                            Cancel
                        </button>
                        <button type="button" className="i-btn is-primary" onClick={confirmImport}>
                            Import {pendingPack.styles.length}{' '}
                            {pendingPack.styles.length === 1 ? 'style' : 'styles'}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/* ── Create / Edit & Single-Style Export Tab ────────────────────────────────────────────────── */

function CreateStyleTab({
    editingEntry,
    onDoneEditing,
}: {
    editingEntry: LibraryStyle | null;
    onDoneEditing: () => void;
}) {
    const [draft, setDraft] = useState<DraftStyle>(() =>
        editingEntry ? entryToDraft(editingEntry) : blankDraft('inline')
    );
    const [classTouched, setClassTouched] = useState<boolean>(!!editingEntry);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    useEffect(() => {
        if (editingEntry) {
            setDraft(entryToDraft(editingEntry));
            setClassTouched(true);
            setError('');
            setStatus('');
        }
    }, [editingEntry]);

    const update = <K extends keyof DraftStyle>(key: K, value: DraftStyle[K]) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
        setError('');
        setStatus('');
    };

    const switchKind = (nextKind: CssPieceKind) => {
        setDraft((prev) => {
            // If user hasn't modified CSS/template from the previous starter, swap to the matching starter.
            const prevStarter = STARTERS[prev.kind];
            const isUnmodifiedStarter =
                !editingEntry &&
                prev.css.trim() === prevStarter.css.trim() &&
                prev.templateHtml.trim() === prevStarter.templateHtml.trim();
            if (isUnmodifiedStarter) {
                return {
                    ...STARTERS[nextKind],
                    author: prev.author,
                    pack: prev.pack,
                };
            }
            const nextStarter = STARTERS[nextKind];
            return {
                ...prev,
                kind: nextKind,
                templateHtml:
                    nextKind === 'template' && !prev.templateHtml.trim()
                        ? `<div class="${
                              prev.className || 'custom-card'
                          }">\n  <p>{{selection|Write your text here…}}</p>\n</div>`
                        : prev.templateHtml,
                css: prev.css.trim() ? prev.css : nextStarter.css,
            };
        });
        setError('');
        setStatus('');
    };

    const previewPiece = useMemo(
        () => ({
            kind: draft.kind,
            className: draft.className.replace(/^\.+/, '').trim() || slugifyClassName(draft.label),
            previewSample: draft.previewSample.trim() || draft.label.trim() || 'Sample',
            css: draft.css,
            templateHtml: draft.kind === 'template' ? draft.templateHtml : undefined,
            previewHtml: draft.previewHtml.trim() || undefined,
            previewCss: draft.previewCss.trim() || undefined,
        }),
        [draft]
    );

    const inspection = useMemo(() => inspectStyleForAo3(previewPiece), [previewPiece]);
    const allWarnings = [...inspection.cssWarnings, ...inspection.htmlWarnings];

    const buildNormalizedStyle = (): StylePackStyle => {
        const cleanClass = draft.className.replace(/^\.+/, '').trim();
        if (cleanClass && !isValidCssClassName(cleanClass)) {
            throw new Error(
                'CSS class name must start with a letter, hyphen, or underscore and contain only letters, numbers, hyphens, or underscores.'
            );
        }
        return normalizeStyleEntry({
            id: editingEntry?.style.id ?? slugifyClassName(draft.label || cleanClass),
            label: draft.label,
            description: draft.description,
            kind: draft.kind,
            className: cleanClass,
            previewSample: draft.previewSample,
            css: draft.css,
            ...(draft.kind === 'template' ? { templateHtml: draft.templateHtml } : {}),
            ...(draft.previewHtml.trim() ? { previewHtml: draft.previewHtml } : {}),
            ...(draft.previewCss.trim() ? { previewCss: draft.previewCss } : {}),
            ...(draft.author.trim() ? { author: draft.author.trim() } : {}),
        });
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setStatus('');
        try {
            const style = buildNormalizedStyle();
            if (editingEntry) {
                updateLibraryStyle(editingEntry.id, style, {
                    pack: draft.pack,
                    author: draft.author,
                });
                setStatus(`Updated “${style.label}” in your Styles menu.`);
            } else {
                saveLibraryStyle(style, {
                    pack: draft.pack,
                    author: draft.author,
                });
                setStatus(`Saved “${style.label}” — it’s now ready in ✦ Styles.`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleExportSingle = () => {
        setError('');
        setStatus('');
        try {
            const style = buildNormalizedStyle();
            const pack: StylePackFile = {
                eo3: 'styles',
                version: 1,
                title: draft.pack.trim() || style.label,
                ...(draft.author.trim() ? { author: draft.author.trim() } : {}),
                styles: [style],
            };
            downloadFile(
                stringifyStylePackFile(pack),
                stylePackFileName(pack.title),
                'application/json'
            );
            setStatus(`Downloaded ${stylePackFileName(pack.title)}.`);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <form className="i-tab-create" onSubmit={handleSave}>
            <div className="i-create-grid">
                <div className="i-create-form">
                    <div className="i-field-group">
                        <span className="i-label-text">Style type</span>
                        <div className="i-kind-toggle" role="group" aria-label="Style type">
                            {(['inline', 'block', 'template'] as const).map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    className={draft.kind === k ? 'is-active' : ''}
                                    onClick={() => switchKind(k)}
                                >
                                    {k === 'inline'
                                        ? 'Inline style'
                                        : k === 'block'
                                        ? 'Block wrapper'
                                        : 'HTML template'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="i-two-col">
                        <label className="i-field">
                            <span>Name</span>
                            <input
                                type="text"
                                required
                                placeholder="e.g. Parchment letter"
                                value={draft.label}
                                onChange={(e) => {
                                    const nextLabel = e.target.value;
                                    setDraft((prev) => ({
                                        ...prev,
                                        label: nextLabel,
                                        ...(classTouched
                                            ? {}
                                            : { className: slugifyClassName(nextLabel) }),
                                    }));
                                    setError('');
                                    setStatus('');
                                }}
                            />
                        </label>

                        <label className="i-field">
                            <span>CSS class</span>
                            <input
                                type="text"
                                required={draft.kind !== 'template'}
                                placeholder="e.g. fx-parchment"
                                value={draft.className}
                                onChange={(e) => {
                                    setClassTouched(true);
                                    update('className', e.target.value);
                                }}
                            />
                        </label>
                    </div>

                    <label className="i-field">
                        <span>Description</span>
                        <input
                            type="text"
                            placeholder="Short explanation shown in ✦ Styles"
                            value={draft.description}
                            onChange={(e) => update('description', e.target.value)}
                        />
                    </label>

                    <div className="i-three-col">
                        <label className="i-field">
                            <span>Preview text</span>
                            <input
                                type="text"
                                placeholder="Sample"
                                value={draft.previewSample}
                                onChange={(e) => update('previewSample', e.target.value)}
                            />
                        </label>
                        <label className="i-field">
                            <span>Author (optional)</span>
                            <input
                                type="text"
                                placeholder="Your handle"
                                value={draft.author}
                                onChange={(e) => update('author', e.target.value)}
                            />
                        </label>
                        <label className="i-field">
                            <span>Pack name (optional)</span>
                            <input
                                type="text"
                                placeholder="e.g. Sci-Fi HUD"
                                value={draft.pack}
                                onChange={(e) => update('pack', e.target.value)}
                            />
                        </label>
                    </div>

                    <label className="i-field">
                        <span>
                            Work Skin CSS <em className="i-field-hint">(no #workskin needed)</em>
                        </span>
                        <textarea
                            className="i-code-input"
                            rows={7}
                            spellCheck={false}
                            placeholder={`.${draft.className || 'my-style'} {\n  ...\n}`}
                            value={draft.css}
                            onChange={(e) => update('css', e.target.value)}
                        />
                    </label>

                    {draft.kind === 'template' ? (
                        <label className="i-field">
                            <span>
                                Template HTML{' '}
                                <em className="i-field-hint">
                                    (use <code>{'{{selection}}'}</code> or{' '}
                                    <code>{'{{selection|Fallback}}'}</code>)
                                </em>
                            </span>
                            <textarea
                                className="i-code-input"
                                rows={5}
                                spellCheck={false}
                                placeholder='<div class="my-card"><p>{{selection|Write here…}}</p></div>'
                                value={draft.templateHtml}
                                onChange={(e) => update('templateHtml', e.target.value)}
                            />
                        </label>
                    ) : null}

                    <details className="i-advanced-details">
                        <summary>Custom swatch preview (optional)</summary>
                        <div className="i-advanced-body">
                            <label className="i-field">
                                <span>Swatch HTML override</span>
                                <textarea
                                    className="i-code-input"
                                    rows={2}
                                    spellCheck={false}
                                    placeholder="Leave blank to auto-render from your CSS"
                                    value={draft.previewHtml}
                                    onChange={(e) => update('previewHtml', e.target.value)}
                                />
                            </label>
                            <label className="i-field">
                                <span>Swatch CSS override</span>
                                <textarea
                                    className="i-code-input"
                                    rows={2}
                                    spellCheck={false}
                                    placeholder="Optional rules applied only inside the small swatch"
                                    value={draft.previewCss}
                                    onChange={(e) => update('previewCss', e.target.value)}
                                />
                            </label>
                        </div>
                    </details>
                </div>

                <aside className="i-create-preview" aria-label="Live preview">
                    <div className="i-preview-section">
                        <h4>How it looks in ✦ Styles</h4>
                        <div className="i-menu-row-preview">
                            <StyleSwatch piece={previewPiece} mode="compact" />
                            <div className="i-menu-row-meta">
                                <span className="i-menu-row-name">
                                    {draft.label.trim() || 'Untitled style'}
                                </span>
                                <span className="i-menu-row-desc">
                                    {draft.description.trim() || `.${previewPiece.className}`}
                                </span>
                                {draft.author.trim() || draft.pack.trim() ? (
                                    <span className="i-menu-row-credit">
                                        {[
                                            draft.pack.trim(),
                                            draft.author.trim() ? `by ${draft.author.trim()}` : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="i-preview-section">
                        <h4>Chapter preview</h4>
                        <StyleSwatch piece={previewPiece} mode="full" />
                    </div>

                    <div className="i-preview-section">
                        <h4>AO3 compatibility</h4>
                        {allWarnings.length === 0 ? (
                            <p className="i-ao3-ok">✓ AO3 Work Skin ready</p>
                        ) : (
                            <ul className="i-warning-list">
                                {allWarnings.map((w, i) => (
                                    <li key={i}>{w}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </aside>
            </div>

            {error ? (
                <p className="i-banner is-error" role="alert">
                    {error}
                </p>
            ) : null}
            {status ? (
                <p className="i-banner is-ok" role="status">
                    {status}
                </p>
            ) : null}

            <div className="i-modal-footer">
                {editingEntry ? (
                    <button
                        type="button"
                        className="i-btn"
                        onClick={() => {
                            onDoneEditing();
                            setDraft(blankDraft('inline'));
                            setClassTouched(false);
                        }}
                    >
                        New blank style
                    </button>
                ) : null}
                <button type="button" className="i-btn" onClick={handleExportSingle}>
                    Download .eo3styles.json
                </button>
                <button type="submit" className="i-btn is-primary">
                    {editingEntry ? 'Update style' : 'Save to Styles'}
                </button>
            </div>
        </form>
    );
}

/* ── Library & Pack Export Builder Tab ──────────────────────────────────────────────────────── */

function LibraryExportTab({
    entries,
    onEdit,
    onGoImport,
    onGoCreate,
}: {
    entries: LibraryStyle[];
    onEdit: (id: string) => void;
    onGoImport: () => void;
    onGoCreate: () => void;
}) {
    const [filter, setFilter] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(
        () => new Set(entries.map((e) => e.id))
    );
    const [packTitle, setPackTitle] = useState('');
    const [packAuthor, setPackAuthor] = useState('');
    const [packDescription, setPackDescription] = useState('');
    const [status, setStatus] = useState('');

    // Keep selection valid as entries are added/removed.
    useEffect(() => {
        setSelectedIds((prev) => {
            const valid = new Set(entries.map((e) => e.id));
            const next = new Set<string>();
            for (const id of prev) {
                if (valid.has(id)) next.add(id);
            }
            if (next.size === 0 && entries.length > 0 && prev.size === 0) {
                for (const e of entries) next.add(e.id);
            }
            return next;
        });
    }, [entries]);

    const packs = useMemo(() => {
        const names = new Set<string>();
        for (const e of entries) {
            if (e.pack) names.add(e.pack);
        }
        return [...names];
    }, [entries]);

    const query = filter.trim().toLowerCase();
    const visibleEntries = entries.filter(
        (e) =>
            !query ||
            e.style.label.toLowerCase().includes(query) ||
            e.style.description.toLowerCase().includes(query) ||
            e.style.className.toLowerCase().includes(query) ||
            (e.pack?.toLowerCase().includes(query) ?? false) ||
            ((e.style.author ?? e.author)?.toLowerCase().includes(query) ?? false)
    );

    const selectedEntries = entries.filter((e) => selectedIds.has(e.id));

    const toggleId = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const buildSelectedPack = (): StylePackFile =>
        buildStylePackExport(selectedEntries, {
            title:
                packTitle.trim() ||
                (selectedEntries.length === 1
                    ? selectedEntries[0].style.label
                    : selectedEntries[0]?.pack || 'My style pack'),
            author: packAuthor.trim() || undefined,
            description: packDescription.trim() || undefined,
        });

    const handleDownloadPack = () => {
        if (!selectedEntries.length) return;
        const pack = buildSelectedPack();
        const filename = stylePackFileName(pack.title);
        downloadFile(stringifyStylePackFile(pack), filename, 'application/json');
        setStatus(
            `Exported ${pack.styles.length} ${
                pack.styles.length === 1 ? 'style' : 'styles'
            } to ${filename}.`
        );
    };

    const handleCopyPack = async () => {
        if (!selectedEntries.length) return;
        const pack = buildSelectedPack();
        const json = stringifyStylePackFile(pack);
        try {
            await navigator.clipboard.writeText(json);
            setStatus(`Copied JSON for ${pack.styles.length} style(s) to clipboard.`);
        } catch {
            setStatus('Couldn’t access clipboard — use Download instead.');
        }
    };

    if (!entries.length) {
        return (
            <div className="i-library-empty">
                <p>You don’t have any custom styles saved in this browser yet.</p>
                <div className="i-row-actions">
                    <button type="button" className="i-btn is-primary" onClick={onGoImport}>
                        Import a style pack
                    </button>
                    <button type="button" className="i-btn" onClick={onGoCreate}>
                        Create a style
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="i-tab-library">
            <div className="i-library-controls">
                <input
                    type="search"
                    placeholder="Filter saved styles…"
                    aria-label="Filter saved custom styles"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <div className="i-select-links">
                    <button
                        type="button"
                        onClick={() => setSelectedIds(new Set(entries.map((e) => e.id)))}
                    >
                        Select all
                    </button>
                    <button type="button" onClick={() => setSelectedIds(new Set())}>
                        None
                    </button>
                    {packs.map((packName) => (
                        <button
                            key={packName}
                            type="button"
                            className="i-pack-chip"
                            title={`Select all styles from “${packName}”`}
                            onClick={() => {
                                setSelectedIds(
                                    new Set(
                                        entries.filter((e) => e.pack === packName).map((e) => e.id)
                                    )
                                );
                                if (!packTitle.trim()) setPackTitle(packName);
                            }}
                        >
                            {packName}
                        </button>
                    ))}
                </div>
            </div>

            <div className="i-library-list">
                {visibleEntries.map((entry) => {
                    const checked = selectedIds.has(entry.id);
                    const credit = [
                        entry.pack,
                        entry.style.author ?? entry.author
                            ? `by ${entry.style.author ?? entry.author}`
                            : '',
                    ]
                        .filter(Boolean)
                        .join(' · ');
                    return (
                        <div key={entry.id} className="i-style-card">
                            <div className="i-style-card-main">
                                <Checkbox
                                    checked={checked}
                                    aria-label={`Select ${entry.style.label} for export`}
                                    onChange={() => toggleId(entry.id)}
                                />
                                <StyleSwatch piece={entry.style} mode="compact" />
                                <div className="i-style-card-info">
                                    <div className="i-style-card-title">
                                        <strong>{entry.style.label}</strong>
                                        <span className="i-kind-pill">
                                            {kindLabel(entry.style.kind)}
                                        </span>
                                    </div>
                                    {entry.style.description ? (
                                        <p className="i-style-card-desc">
                                            {entry.style.description}
                                        </p>
                                    ) : null}
                                    <p className="i-style-card-sub">
                                        <code>.{entry.style.className}</code>
                                        {credit ? ` · ${credit}` : ''}
                                    </p>
                                </div>
                                <div className="i-style-card-actions">
                                    <button
                                        type="button"
                                        className="i-btn-sm"
                                        onClick={() => onEdit(entry.id)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        className="i-btn-sm is-danger"
                                        onClick={() => removeLibraryStyle(entry.id)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {!visibleEntries.length ? (
                    <p className="i-empty-filter">No saved styles match “{filter}”.</p>
                ) : null}
            </div>

            <div className="i-export-panel">
                <h4>Export pack ({selectedEntries.length} selected)</h4>
                <div className="i-three-col">
                    <label className="i-field">
                        <span>Pack title</span>
                        <input
                            type="text"
                            placeholder="e.g. Cozy Fantasy Styles"
                            value={packTitle}
                            onChange={(e) => setPackTitle(e.target.value)}
                        />
                    </label>
                    <label className="i-field">
                        <span>Author (optional)</span>
                        <input
                            type="text"
                            placeholder="Your handle"
                            value={packAuthor}
                            onChange={(e) => setPackAuthor(e.target.value)}
                        />
                    </label>
                    <label className="i-field">
                        <span>Description (optional)</span>
                        <input
                            type="text"
                            placeholder="Notes for writers"
                            value={packDescription}
                            onChange={(e) => setPackDescription(e.target.value)}
                        />
                    </label>
                </div>

                {status ? (
                    <p className="i-banner is-ok" role="status">
                        {status}
                    </p>
                ) : null}

                <div className="i-modal-footer">
                    <button
                        type="button"
                        className="i-btn"
                        disabled={!selectedEntries.length}
                        onClick={() => void handleCopyPack()}
                    >
                        Copy JSON
                    </button>
                    <button
                        type="button"
                        className="i-btn is-primary"
                        disabled={!selectedEntries.length}
                        onClick={handleDownloadPack}
                    >
                        Download .eo3styles.json ({selectedEntries.length})
                    </button>
                </div>
            </div>
        </div>
    );
}
