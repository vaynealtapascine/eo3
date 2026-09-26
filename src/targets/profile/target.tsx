import { ComponentType, ReactNode, useRef, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { CopyToClipboardButton } from '../../ui/components/post-preview/copy-to-clipboard-button';
import { PostedStatus } from '../../ui/components/post-preview/posted-status';
import { SplitPrompt } from '../../ui/components/post-preview/split-prompt';
import { makeSanitizeConfig, SanitizeConfig } from '../ao3/render/archive-config';
import { sanitizeFragment } from '../ao3/render/sanitize';
import { liftInlineStyles } from '../ao3/render/lift-styles';
import { exportInline } from '../delivery/inline';
import { exportSharedStylesheet } from '../delivery/shared-stylesheet';
import {
    ErrorMessage,
    PushError,
    SiteTargetExportAction,
    SiteTargetPlugin,
    SiteTargetPreviewProps,
    WorkExportInput,
    WorkExportOutput,
} from '../types';
import { ERRORS as PROFILE_ERRORS } from './diagnostics';
import { filterStyleAttributes, filterStylesheet } from './filter-css';
import { PROFILE_TARGET_PREFIX } from './store';
import { TargetProfile } from './types';

type Config = Record<string, never>;

const MASCOT =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="12" width="48" ' +
    'height="40" rx="6" fill="none" stroke="currentColor" stroke-width="4"/><path d="M18 26h28M18 ' +
    '34h28M18 42h16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';

/** What a built-in target adds on top of its profile (see targets/wafrn). */
export interface ProfileTargetExtension {
    /** The target's id; custom profiles use `profile:<id>`. */
    id?: string;
    /** Its own error registry (each target keeps an explicit one); defaults to the profile's. */
    errors?: Record<string, ComponentType<any>>;
    /** Site-specific changes to each part's HTML after sanitizing, shown in preview and export. */
    finalizePart?(root: HTMLElement, pushError: PushError): void;
    mascot?: { awake: string; asleep: string };
    /** A note under the preview about how the site shows this part's HTML. */
    footerNote?(html: string): ReactNode;
}

/** Builds a site target from a profile: its sanitizer, its delivery strategy, its limits. */
export function createProfileTarget(
    profile: TargetProfile,
    extension: ProfileTargetExtension = {}
): SiteTargetPlugin<Config> {
    // Inline sites never see classes (the inliner removes them), but CSS needs them to match first.
    const sanitizeConfig = toSanitizeConfig(profile, profile.delivery === 'inline');
    const sheetAllowed = profile.cssProperties && new Set(profile.cssProperties);
    const attributeList = profile.styleAttributeProperties ?? profile.cssProperties;
    const attributeAllowed = attributeList && new Set(attributeList);
    const errors = extension.errors ?? PROFILE_ERRORS;

    const render = (content: string, pushError: PushError, lift = false) => {
        const root = document.createElement('div');
        root.innerHTML = content;
        const css = lift ? liftInlineStyles(root, (d) => pushError(d.kind, d)) : '';
        sanitizeFragment(root, sanitizeConfig, (d) => pushError(d.kind, d));
        // Inline delivery filters after inlining, when the attributes are complete.
        if (attributeAllowed && profile.delivery !== 'inline') {
            filterStyleAttributes(root, attributeAllowed, pushError);
        }
        extension.finalizePart?.(root, pushError);
        return { root, css };
    };
    const renderQuietly = (content: string) => render(content, () => {}).root.innerHTML;

    const exportActions: SiteTargetExportAction[] = [
        { id: 'copy-html', label: 'Copy HTML', outputId: 'html' },
        ...(profile.delivery === 'shared-stylesheet'
            ? [{ id: 'copy-css', label: 'Copy stylesheet', outputId: 'css' }]
            : []),
    ];

    const exportWork = (input: WorkExportInput<Config>, pushError: PushError): WorkExportOutput => {
        const filterSheet = (css: string, report: PushError) =>
            sheetAllowed ? filterStylesheet(css, sheetAllowed, report) : css;

        switch (profile.delivery) {
            case 'shared-stylesheet':
                return exportSharedStylesheet(
                    input,
                    pushError,
                    (source) => {
                        const { root, css } = render(source, () => {}, true);
                        return { html: root.innerHTML, css };
                    },
                    filterSheet
                );
            case 'inline': {
                const output = exportInline(
                    input,
                    pushError,
                    (source, html) => html ?? renderQuietly(source),
                    () => {}
                );
                if (!attributeAllowed) return output;
                for (const outputs of output.parts.values()) {
                    const root = document.createElement('div');
                    root.innerHTML = outputs.get('html') ?? '';
                    filterStyleAttributes(root, attributeAllowed, pushError);
                    outputs.set('html', root.innerHTML);
                }
                return output;
            }
            case 'embedded-style': {
                const parts = new Map(
                    input.parts.map((part) => {
                        const html = part.html ?? renderQuietly(part.source);
                        const css = filterSheet(
                            [input.workCss, part.css].filter(Boolean).join('\n'),
                            pushError
                        ).trim();
                        const packaged = css ? `<style>\n${css}\n</style>\n${html}` : html;
                        return [part.id, new Map([['html', packaged]])];
                    })
                );
                return { parts, work: new Map() };
            }
            case 'plain': {
                let dropped = 0;
                const parts = new Map(
                    input.parts.map((part) => {
                        const { root } = render(part.html ?? part.source, () => {});
                        for (const node of root.querySelectorAll('[style]')) {
                            node.removeAttribute('style');
                            dropped++;
                        }
                        return [part.id, new Map([['html', root.innerHTML]])];
                    })
                );
                dropped += [input.workCss, ...input.parts.map((p) => p.css)].filter((css) =>
                    css.trim()
                ).length;
                if (dropped) pushError('styling-dropped', { count: dropped });
                return { parts, work: new Map() };
            }
        }
    };

    return {
        id: extension.id ?? PROFILE_TARGET_PREFIX + profile.id,
        title: profile.title,
        initialConfig: () => ({}),
        renderFallback: (content, _config, pushError) =>
            render(content, pushError, profile.delivery === 'shared-stylesheet').root.innerHTML,
        outputs: [
            { id: 'html', label: 'HTML', typeId: 'text/html', scope: 'part' },
            ...(profile.delivery === 'shared-stylesheet'
                ? [{ id: 'css', label: 'Stylesheet', typeId: 'text/css', scope: 'work' as const }]
                : []),
        ],
        partLabel: profile.partLabel,
        ...(profile.partMaxChars ? { partMaxChars: profile.partMaxChars } : {}),
        previewCssScope: '.p-prose',
        export: exportWork,
        exportActions,
        PreviewFooter: (props) => (
            <ProfileFooter
                {...props}
                profile={profile}
                exportActions={exportActions}
                errorRegistry={errors}
                note={extension.footerNote}
            />
        ),
        outputMascot: extension.mascot ?? { awake: MASCOT, asleep: MASCOT },
    };
}

function toSanitizeConfig(profile: TargetProfile, keepClasses: boolean): SanitizeConfig {
    const { all = [], ...byTag } = profile.attributes;
    const protocols: Record<string, Record<string, string[]>> = {};
    for (const [key, list] of Object.entries(profile.protocols)) {
        const [element, attribute] = key.split('.');
        if (!element || !attribute) continue;
        (protocols[element] ??= {})[attribute] = list;
    }
    return makeSanitizeConfig({
        elements: new Set(profile.elements),
        allAttributes: keepClasses ? [...all, 'class'] : all,
        attributesByTag: byTag,
        protocols,
        ...(profile.removeContents ? { removeContents: new Set(profile.removeContents) } : {}),
        ...(profile.whitespaceElements
            ? { whitespaceElements: new Set(profile.whitespaceElements) }
            : {}),
    });
}

function ProfileFooter({
    exportOutput,
    error,
    part,
    posting,
    sizing,
    renderErrors,
    asyncErrors,
    profile,
    exportActions,
    errorRegistry,
    note,
}: SiteTargetPreviewProps<Config> & {
    profile: TargetProfile;
    exportActions: SiteTargetExportAction[];
    errorRegistry: Record<string, ComponentType<any>>;
    note?(html: string): ReactNode;
}) {
    const errorButton = useRef<HTMLButtonElement>(null);
    const [errorsOpen, setErrorsOpen] = useState(false);
    const errors = renderErrors.concat(asyncErrors);
    const html = exportOutput.get('html') ?? '';
    const partName = `${profile.partLabel} ${part.index + 1}`;

    return (
        <>
            <hr />
            <div className="post-footer">
                <span className="post-size-meter">{(html.length / 1000).toFixed(2)} kB</span>
                <SplitPrompt sizing={sizing} partName={partName} siteName={profile.title} />
                <PostedStatus posting={posting} partName={partName} />
                {exportActions.map((action) => (
                    <CopyToClipboardButton
                        key={action.id}
                        action={action}
                        exportOutput={exportOutput}
                        disabled={!!error}
                        onCopied={posting.onCopied}
                    />
                ))}
                <button
                    ref={errorButton}
                    className="button-appearance"
                    disabled={!errors.length}
                    onClick={() => setErrorsOpen(true)}
                >
                    {errors.length === 1 ? '1 change' : `${errors.length} changes`}
                </button>
                <DirPopover
                    anchor={errorButton.current}
                    open={errorsOpen}
                    onClose={() => setErrorsOpen(false)}
                >
                    <ErrorList errors={errors} registry={errorRegistry} />
                </DirPopover>
            </div>
            {note?.(html)}
        </>
    );
}

function ErrorList({
    errors,
    registry,
}: {
    errors: ErrorMessage[];
    registry: Record<string, ComponentType<any>>;
}) {
    const seenTypes = new Set<string>();
    return (
        <ul className="i-errors">
            {errors.map(({ id, props }, i) => {
                const Component = registry[id];
                if (!Component) return null;
                const isFirstOfType = !seenTypes.has(id);
                seenTypes.add(id);
                return (
                    <li className="i-error" key={i}>
                        <Component {...props} isFirstOfType={isFirstOfType} />
                    </li>
                );
            })}
        </ul>
    );
}
