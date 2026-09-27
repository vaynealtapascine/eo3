import { useEffect, useRef, useState } from 'react';
import {
    DELIVERY_STRATEGIES,
    DeliveryStrategyId,
    newProfile,
    parseProfile,
    TargetProfile,
} from '../../targets/profile/types';
import { deleteProfile, listProfiles, saveProfile } from '../../targets/profile/store';
import { Document } from '../../document';
import './profile-editor.css';
import { showConfirm } from '../dialogs';

/** Form state: lists are edited as text ("a: href title" lines, space-separated names). */
interface Draft {
    id: string;
    title: string;
    partLabel: string;
    partMaxChars: string;
    delivery: DeliveryStrategyId;
    elements: string;
    attributes: string;
    protocols: string;
    cssProperties: string;
    cssPropertiesEnabled: boolean;
    styleAttributeProperties: string;
    styleAttributePropertiesEnabled: boolean;
    removeContents: string;
    removeContentsEnabled: boolean;
    whitespaceElements: string;
    whitespaceElementsEnabled: boolean;
}

type TextField = {
    [K in keyof Draft]: Draft[K] extends string ? K : never;
}[keyof Draft];

const names = (text: string) => text.split(/[\s,]+/).filter(Boolean);
const lines = (map: Record<string, string[]>) =>
    Object.entries(map)
        .map(([key, list]) => `${key}: ${list.join(' ')}`)
        .join('\n');
const unlines = (text: string) =>
    Object.fromEntries(
        text
            .split('\n')
            .map((line) => line.split(':'))
            .filter(([key, list]) => key.trim() && list !== undefined)
            .map(([key, list]) => [key.trim(), names(list)])
    );

export const toDraft = (p: TargetProfile): Draft => ({
    id: p.id,
    title: p.title,
    partLabel: p.partLabel,
    partMaxChars: p.partMaxChars ? String(p.partMaxChars) : '',
    delivery: p.delivery,
    elements: p.elements.join(' '),
    attributes: lines(p.attributes),
    protocols: lines(p.protocols),
    cssProperties: p.cssProperties?.join(' ') ?? '',
    cssPropertiesEnabled: p.cssProperties !== undefined,
    styleAttributeProperties: p.styleAttributeProperties?.join(' ') ?? '',
    styleAttributePropertiesEnabled: p.styleAttributeProperties !== undefined,
    removeContents: p.removeContents?.join(' ') ?? '',
    removeContentsEnabled: p.removeContents !== undefined,
    whitespaceElements: p.whitespaceElements?.join(' ') ?? '',
    whitespaceElementsEnabled: p.whitespaceElements !== undefined,
});

export const fromDraft = (d: Draft) =>
    parseProfile({
        id: d.id,
        title: d.title,
        partLabel: d.partLabel,
        ...(d.partMaxChars.trim() ? { partMaxChars: Number(d.partMaxChars) } : {}),
        delivery: d.delivery,
        elements: names(d.elements),
        attributes: unlines(d.attributes),
        protocols: unlines(d.protocols),
        ...(d.cssPropertiesEnabled ? { cssProperties: names(d.cssProperties) } : {}),
        ...(d.styleAttributePropertiesEnabled
            ? { styleAttributeProperties: names(d.styleAttributeProperties) }
            : {}),
        ...(d.removeContentsEnabled ? { removeContents: names(d.removeContents) } : {}),
        ...(d.whitespaceElementsEnabled ? { whitespaceElements: names(d.whitespaceElements) } : {}),
    });

/** Create, edit, import, export and delete custom site profiles. */
export function ProfileEditor({
    open,
    document,
    onClose,
    onUse,
}: {
    open: boolean;
    document: Document;
    onClose: () => void;
    /** Switch the preview to the given profile's target. */
    onUse: (profileId: string) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [profiles, setProfiles] = useState(listProfiles);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [importText, setImportText] = useState('');
    const activeTargetIds = new Set(profiles.map((profile) => `profile:${profile.id}`));
    const retiredTargetIds = [
        ...new Set([
            ...document.parts.flatMap((part) => Object.keys(part.postedTo)),
            ...Object.keys(document.state.skinRecords),
            ...Object.keys(document.state.skinBaselines),
            ...Object.keys(document.state.protectedSkinClasses),
        ]),
    ].filter((id) => id.startsWith('profile:') && !activeTargetIds.has(id));

    useEffect(() => {
        if (open && !dialog.current?.open) {
            setProfiles(listProfiles());
            dialog.current?.showModal();
        } else if (!open && dialog.current?.open) dialog.current.close();
    }, [open]);

    const edit = (profile: TargetProfile, fresh = false) => {
        setDraft(toDraft(profile));
        setIsNew(fresh);
        setMessage(null);
    };
    const field = (key: TextField) => ({
        value: draft![key],
        onChange: (e: { target: { value: string } }) =>
            setDraft({ ...draft!, [key]: e.target.value }),
    });

    const save = () => {
        const result = fromDraft(draft!);
        if (typeof result === 'string') {
            setMessage(result);
            return null;
        }
        if (isNew && profiles.some((p) => p.id === result.id)) {
            setMessage(`A profile with the id "${result.id}" already exists.`);
            return null;
        }
        saveProfile(result);
        setProfiles(listProfiles());
        setIsNew(false);
        setMessage('Saved.');
        return result;
    };

    const importProfile = () => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(importText);
        } catch {
            return setMessage('That isn’t valid JSON.');
        }
        const result = parseProfile(parsed);
        if (typeof result === 'string') return setMessage(result);
        saveProfile(result);
        setProfiles(listProfiles());
        setImportText('');
        edit(result);
        setMessage(`Imported "${result.title}".`);
    };

    return (
        <dialog ref={dialog} className="profile-editor" onClose={onClose}>
            <header>
                <h2>Custom sites</h2>
                <button onClick={onClose} aria-label="close">
                    ×
                </button>
            </header>
            <p className="i-intro">
                Describe a site that accepts HTML: which tags and attributes it keeps, how it takes
                CSS, and how long a post can be. Profiles are saved in this browser; export them to
                share or move them.
            </p>
            <div className="i-columns">
                <nav>
                    <ul>
                        {profiles.map((p) => (
                            <li key={p.id}>
                                <button
                                    className={draft?.id === p.id && !isNew ? 'is-current' : ''}
                                    onClick={() => edit(p)}
                                >
                                    {p.title}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button
                        onClick={() => edit(newProfile(`site-${Date.now().toString(36)}`), true)}
                    >
                        + new site
                    </button>
                    <details>
                        <summary>import JSON</summary>
                        <textarea
                            rows={5}
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder='{"id": "…", "title": "…", …}'
                        />
                        <button onClick={importProfile} disabled={!importText.trim()}>
                            import
                        </button>
                    </details>
                    {retiredTargetIds.length > 0 && (
                        <details className="i-retired">
                            <summary>History for removed sites ({retiredTargetIds.length})</summary>
                            <p>These marks belong to sites no longer in your list.</p>
                            {retiredTargetIds.map((id) => (
                                <div key={id}>
                                    <code>{id.slice('profile:'.length)}</code>{' '}
                                    <button
                                        onClick={async () => {
                                            if (
                                                await showConfirm(
                                                    `Forget this work’s posting marks and saved styles for ${id}? You can undo this change.`,
                                                    { confirmLabel: 'Forget', danger: true }
                                                )
                                            ) {
                                                document.forgetTargetPostingState(id);
                                            }
                                        }}
                                    >
                                        forget in this work
                                    </button>
                                </div>
                            ))}
                        </details>
                    )}
                </nav>
                {draft ? (
                    <form className="i-form" onSubmit={(e) => e.preventDefault()}>
                        <label>
                            Name <input {...field('title')} />
                        </label>
                        <label>
                            ID <input {...field('id')} disabled={!isNew} />
                        </label>
                        <label>
                            A part is called <input {...field('partLabel')} />
                        </label>
                        <label>
                            Size limit per part (characters, optional){' '}
                            <input {...field('partMaxChars')} inputMode="numeric" />
                        </label>
                        <label>
                            How it takes CSS
                            <select {...field('delivery')}>
                                {Object.entries(DELIVERY_STRATEGIES).map(([id, label]) => (
                                    <option key={id} value={id}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Allowed elements
                            <textarea rows={3} {...field('elements')} />
                        </label>
                        <label>
                            Allowed attributes, one element per line (<code>all:</code> for every
                            element)
                            <textarea rows={4} {...field('attributes')} />
                        </label>
                        <label>
                            Allowed URL protocols, as <code>element.attribute: protocols</code> (
                            <code>relative</code> allows links without one)
                            <textarea rows={3} {...field('protocols')} />
                        </label>
                        <label className="i-check">
                            <input
                                type="checkbox"
                                checked={draft.cssPropertiesEnabled}
                                onChange={(e) =>
                                    setDraft({ ...draft, cssPropertiesEnabled: e.target.checked })
                                }
                            />
                            Restrict stylesheet CSS properties
                        </label>
                        {draft.cssPropertiesEnabled && (
                            <label>
                                Allowed stylesheet CSS properties (empty means none)
                                <textarea rows={2} {...field('cssProperties')} />
                            </label>
                        )}
                        <details className="i-advanced">
                            <summary>Advanced sanitizer settings</summary>
                            <p className="i-help">
                                Leave a setting unchecked to use the default. Check it and leave its
                                list empty to use an empty list.
                            </p>
                            <label className="i-check">
                                <input
                                    type="checkbox"
                                    checked={draft.styleAttributePropertiesEnabled}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            styleAttributePropertiesEnabled: e.target.checked,
                                        })
                                    }
                                />
                                Set separate CSS properties for style attributes
                            </label>
                            {draft.styleAttributePropertiesEnabled && (
                                <label>
                                    Allowed style attribute properties (empty means none)
                                    <textarea rows={2} {...field('styleAttributeProperties')} />
                                </label>
                            )}
                            <label className="i-check">
                                <input
                                    type="checkbox"
                                    checked={draft.removeContentsEnabled}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            removeContentsEnabled: e.target.checked,
                                        })
                                    }
                                />
                                Set tags removed with their contents
                            </label>
                            {draft.removeContentsEnabled && (
                                <label>
                                    Tags removed with their contents (empty means none)
                                    <textarea rows={2} {...field('removeContents')} />
                                </label>
                            )}
                            <label className="i-check">
                                <input
                                    type="checkbox"
                                    checked={draft.whitespaceElementsEnabled}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            whitespaceElementsEnabled: e.target.checked,
                                        })
                                    }
                                />
                                Set tags that add spaces when unwrapped
                            </label>
                            {draft.whitespaceElementsEnabled && (
                                <label>
                                    Tags that add spaces when unwrapped (empty means none)
                                    <textarea rows={2} {...field('whitespaceElements')} />
                                </label>
                            )}
                        </details>
                        {message && <p className="i-message">{message}</p>}
                        <div className="i-buttons">
                            <button onClick={save}>save</button>
                            {!isNew && (
                                <>
                                    <button
                                        onClick={() => {
                                            const saved = save();
                                            if (saved) onUse(saved.id);
                                        }}
                                    >
                                        save and preview with it
                                    </button>
                                    <button
                                        onClick={() => {
                                            const result = fromDraft(draft);
                                            if (typeof result === 'string')
                                                return setMessage(result);
                                            navigator.clipboard
                                                .writeText(JSON.stringify(result, null, 2))
                                                .then(() => setMessage('Copied as JSON.'))
                                                .catch(() => setMessage('Couldn’t copy.'));
                                        }}
                                    >
                                        copy as JSON
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const yes = await showConfirm(
                                                `Delete the site “${draft.title}”?`,
                                                { confirmLabel: 'Delete', danger: true }
                                            );
                                            if (!yes) return;
                                            deleteProfile(draft.id);
                                            setProfiles(listProfiles());
                                            setDraft(null);
                                        }}
                                    >
                                        delete
                                    </button>
                                </>
                            )}
                        </div>
                    </form>
                ) : (
                    <p className="i-empty">Pick a site, or add a new one.</p>
                )}
            </div>
        </dialog>
    );
}
