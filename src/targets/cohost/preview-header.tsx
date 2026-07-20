import React, { useRef, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { RenderConfigEditor } from '../../ui/components/post-preview';
import { DarkThemeButton } from '../../ui/components/post-preview/dark-theme-button';
import { SiteTargetPreviewProps, ErrorMessage as GenericErrorMessage } from '../types';
import { RenderConfig } from './config';
import { ERRORS } from './fallback-renderer';

function ErrorList({ errors }: { errors: GenericErrorMessage[] }) {
    const seenTypes = new Set<string>();

    return (
        <ul className="i-errors">
            {errors.map(({ id, props }, i) => {
                const Component = (ERRORS as any)[id];
                const isFirstOfType = !seenTypes.has(id.toString());
                seenTypes.add(id.toString());
                return (
                    <li className="i-error" key={'r' + i}>
                        <Component {...props} isFirstOfType={isFirstOfType} />
                    </li>
                );
            })}
        </ul>
    );
}

export function CohostPreviewHeader({
    plugin,
    hasLiveRenderer,
    previewConfig,
    onPreviewConfigChange,
    renderErrors,
    asyncErrors,
}: SiteTargetPreviewProps<RenderConfig>) {
    const errorBtn = useRef<HTMLButtonElement>(null);
    const [errorsOpen, setErrorsOpen] = useState(false);

    const errorCount = renderErrors.length + asyncErrors.length;

    return (
        <React.Fragment>
            <div className="post-header">
                <span className="i-settings-container">
                    <RenderConfigEditor
                        plugin={plugin}
                        hasLiveRenderer={hasLiveRenderer}
                        config={previewConfig}
                        onConfigChange={onPreviewConfigChange}
                    />
                    <DarkThemeButton
                        isDark={previewConfig.darkTheme}
                        onClick={() =>
                            onPreviewConfigChange({
                                ...previewConfig,
                                darkTheme: !previewConfig.darkTheme,
                            })
                        }
                    />
                </span>
                <span className="i-errors-container">
                    <button
                        ref={errorBtn}
                        className={'i-errors-button' + (errorCount ? ' has-errors' : '')}
                        disabled={!errorCount}
                        onClick={() => setErrorsOpen(true)}
                        aria-label={errorCount === 1 ? '1 error' : `${errorCount} errors`}
                    >
                        <span className="i-errors-icon">!</span>
                        <span className="i-errors-count">{errorCount}</span>
                    </button>
                    <DirPopover
                        anchor={errorBtn.current}
                        open={errorsOpen}
                        onClose={() => setErrorsOpen(false)}
                    >
                        <ErrorList errors={renderErrors.concat(asyncErrors)} />
                    </DirPopover>
                </span>
            </div>
            <hr />
        </React.Fragment>
    );
}
