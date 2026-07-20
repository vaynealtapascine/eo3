import React from 'react';
import { CopyToClipboardButton } from '../../ui/components/post-preview/copy-to-clipboard-button';
import { SiteTargetPreviewProps } from '../types';
import { RenderConfig } from './config';
import { COHOST_APPROX_MAX_PAYLOAD_SIZE } from './fallback-renderer';
import { EXPORT_ACTIONS } from './export-actions';

function PostSize({ size }: { size: number }) {
    const byteSize = size;

    let sizeLabel;
    if (size < 1000) {
        sizeLabel = size + ' bytes';
    } else {
        size = +(size / 1000).toFixed(2);
        if (size < 1000) {
            sizeLabel = size + ' kB';
        } else {
            size = +(size / 1000).toFixed(2);
            sizeLabel = size + ' MB';
        }
    }

    let sizeOfMax = byteSize / COHOST_APPROX_MAX_PAYLOAD_SIZE;

    return (
        <span
            className="post-size-meter"
            style={
                {
                    '--size-of-max': Math.min(1, sizeOfMax),
                } as any
            }
        >
            {sizeLabel}{' '}
            {sizeOfMax >= 1 ? (
                <span className="i-warning">probably too large</span>
            ) : sizeOfMax >= 0.95 ? (
                <span className="i-warning">close to size limit</span>
            ) : null}
        </span>
    );
}

export function CohostPreviewFooter({ markdown, error }: SiteTargetPreviewProps<RenderConfig>) {
    return (
        <>
            <hr />
            <div className="post-footer">
                <PostSize size={markdown.length} />
                {EXPORT_ACTIONS.map((action) => (
                    <CopyToClipboardButton
                        key={action.id}
                        action={action}
                        markdown={markdown}
                        disabled={!!error}
                    />
                ))}
            </div>
        </>
    );
}
