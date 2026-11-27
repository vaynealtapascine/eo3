import { ReactNode, useId } from 'react';
import './controls.css';

/**
 * Choosing a file, as an eo3 button instead of the browser's "Choose file / No file chosen"
 * control. The input stays in the page (visually hidden), so it is still focusable and labelled.
 */
export function FileButton({
    children,
    accept,
    multiple,
    disabled,
    primary,
    className,
    onFiles,
    inputRef,
}: {
    children: ReactNode;
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
    primary?: boolean;
    className?: string;
    onFiles: (files: File[]) => void;
    inputRef?: React.Ref<HTMLInputElement>;
}) {
    const id = useId();
    return (
        <label
            htmlFor={id}
            className={
                'uikit-action uikit-file-button' +
                (primary ? ' is-primary' : '') +
                (disabled ? ' is-disabled' : '') +
                (className ? ' ' + className : '')
            }
        >
            <input
                ref={inputRef}
                id={id}
                type="file"
                className="uikit-visually-hidden"
                accept={accept}
                multiple={multiple}
                disabled={disabled}
                onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    // Choosing the same file again should still count.
                    e.target.value = '';
                    if (files.length) onFiles(files);
                }}
            />
            {children}
        </label>
    );
}
