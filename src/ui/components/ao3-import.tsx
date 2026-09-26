import { FormEvent, useId, useState } from 'react';
import { Document } from '../../document';
import { liftedSkinRules } from '../../targets/delivery/skin-record';
import './ao3-import.css';

/** Paste an existing AO3 Work Skin first, then add chapters as editable HTML sources. */
export function Ao3Import({
    document,
    onSelectPart,
    onSelectModule,
}: {
    document: Document;
    onSelectPart: (id: string) => void;
    onSelectModule: (id: string) => void;
}) {
    const [skin, setSkin] = useState('');
    const [chapterTitle, setChapterTitle] = useState('');
    const [chapterHtml, setChapterHtml] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const formId = useId();

    const importSkin = async (event: FormEvent) => {
        event.preventDefault();
        if (!skin.trim() || busy) return;
        setBusy(true);
        setMessage('');
        try {
            const { cleanWorkskinCss } = await import('../../targets/ao3/render');
            const canonical = cleanWorkskinCss(skin, { prefix: '#workskin' }).trimEnd();
            const id = await document.importWorkSkin(
                'ao3',
                skin,
                canonical,
                liftedSkinRules(canonical)
            );
            onSelectModule(id);
            setSkin('');
            setMessage(
                'Work Skin imported. Generated styles remain protected for chapters not yet imported.'
            );
        } catch (error) {
            setMessage(`Could not import Work Skin: ${String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const importChapter = async (event: FormEvent) => {
        event.preventDefault();
        if (!chapterHtml.trim() || busy) return;
        setBusy(true);
        setMessage('');
        try {
            const part = await document.importChapter(chapterTitle.trim(), chapterHtml);
            onSelectPart(part.id);
            setChapterTitle('');
            setChapterHtml('');
            setMessage('Chapter imported. Check its preview, then mark it posted if it is live.');
        } catch (error) {
            setMessage(`Could not import chapter: ${String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <details className="ao3-import">
            <summary>Import existing AO3 work</summary>
            <p>Paste the Work Skin first, then import each chapter’s HTML source in order.</p>
            <form onSubmit={importSkin}>
                <label htmlFor={`${formId}-skin`}>Work Skin CSS</label>
                <textarea
                    id={`${formId}-skin`}
                    value={skin}
                    onChange={(event) => setSkin(event.target.value)}
                    placeholder="Paste the CSS from your AO3 Work Skin"
                    rows={5}
                />
                <button type="submit" disabled={!skin.trim() || busy}>
                    {document.importedSkinModuleId ? 'replace imported skin' : 'import skin'}
                </button>
            </form>
            <form onSubmit={importChapter}>
                <label htmlFor={`${formId}-title`}>Chapter title</label>
                <input
                    id={`${formId}-title`}
                    value={chapterTitle}
                    onChange={(event) => setChapterTitle(event.target.value)}
                    placeholder="Optional"
                />
                <label htmlFor={`${formId}-html`}>Chapter HTML</label>
                <textarea
                    id={`${formId}-html`}
                    value={chapterHtml}
                    onChange={(event) => setChapterHtml(event.target.value)}
                    placeholder="Paste the chapter HTML source from AO3"
                    rows={7}
                />
                <button type="submit" disabled={!chapterHtml.trim() || busy}>
                    import chapter
                </button>
            </form>
            {message && <p role="status">{message}</p>}
        </details>
    );
}
