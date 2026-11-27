import { forwardRef, SelectHTMLAttributes } from 'react';
import './controls.css';

/**
 * A drop-down in eo3's style. It stays a native `<select>` underneath, so keyboards, screen
 * readers and phones' own pickers keep working; only the closed control is restyled to match
 * `TextField`.
 */
export const Select = forwardRef<
    HTMLSelectElement,
    SelectHTMLAttributes<HTMLSelectElement> & { narrow?: boolean; wrapperClassName?: string }
>(function Select({ narrow, wrapperClassName, ...props }, ref) {
    return (
        <span
            className={
                'uikit-select' +
                (narrow ? ' is-narrow' : '') +
                (props.disabled ? ' is-disabled' : '') +
                (wrapperClassName ? ' ' + wrapperClassName : '')
            }
        >
            <select ref={ref} {...props} />
        </span>
    );
});
