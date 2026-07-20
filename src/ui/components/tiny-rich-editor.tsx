import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import type { Editor as TinyMCEEditor } from 'tinymce';
// Ensure to import tinymce first as other components expect
// a global variable `tinymce` to exist
import 'tinymce/tinymce';
// DOM model
import 'tinymce/models/dom/model';
// Theme
import 'tinymce/themes/silver';
// Toolbar icons
import 'tinymce/icons/default';
// Editor styles
import 'tinymce/skins/ui/oxide/skin';
// Content styles, including inline UI like fake cursors
import 'tinymce/skins/content/default/content';
import 'tinymce/skins/ui/oxide/content';

// Import plugins
import 'tinymce/plugins/directionality';
import 'tinymce/plugins/help';

// Include resources that a plugin lazy-loads at the run-time
import 'tinymce/plugins/image';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/searchreplace';
import 'tinymce/plugins/wordcount';
import 'tinymce/plugins/fullscreen';
import './tiny-plugins/ruby-characters';

/**
 * RichTextEditor
 * ----------------------------------------------------------------------
 * A composable, customizable wrapper around @tinymce/tinymce-react.
 *
 * - Supports both controlled (`value` + `onChange`) and uncontrolled
 *   (`initialValue`) usage.
 * - Accepts a partial `init` object that is merged with sensible
 *   defaults, so callers only need to override what they care about.
 * - Exposes the underlying TinyMCE editor instance via ref, so parent
 *   components can call editor methods directly (e.g. `getContent()`).
 * - Forwards any extra props supported by the underlying <Editor />.
 *
 * Requires an API key from https://www.tiny.cloud/ (or self-hosted /
 * `tinymce` npm package + `licenseKey: 'gpl'` if you prefer not to use
 * a cloud key — see the `licenseKey` prop below).
 * ----------------------------------------------------------------------
 */

export interface RichTextEditorProps {
    /** TinyMCE Cloud API key. Omit if self-hosting the editor. */
    apiKey?: string;
    /** License key, e.g. 'gpl' when self-hosting under GPL. */
    licenseKey?: string;

    /** Controlled value. Pair with `onChange`. */
    value?: string;
    /** Uncontrolled initial value. Ignored if `value` is provided. */
    initialValue?: string;

    /** Called with the editor's HTML content on every change. */
    onChange?: (content: string, editor: TinyMCEEditor) => void;
    /** Called once the editor has finished initializing. */
    onInit?: (event: unknown, editor: TinyMCEEditor) => void;
    /** Called when the editor loses focus. */
    onBlur?: (event: unknown, editor: TinyMCEEditor) => void;

    /** Editor height in px (or any valid TinyMCE height value). */
    height?: number | string;
    /** Space-separated list of plugins. Merged-overridden, not appended. */
    plugins?: string | string[];
    /** Toolbar definition string. Merged-overridden, not appended. */
    toolbar?: string | false;
    /** Disable editing. */
    disabled?: boolean;
    /** Placeholder text shown when the editor is empty. */
    placeholder?: string;

    /** Escape hatch: any additional/override TinyMCE `init` settings. */
    init?: Record<string, unknown>;

    /** Extra class name applied to the wrapping <div>. */
    className?: string;
}

export interface RichTextEditorHandle {
    /** The raw TinyMCE editor instance (null until initialized). */
    getEditor: () => TinyMCEEditor | null;
    /** Convenience: get current HTML content. */
    getContent: () => string;
    /** Convenience: set HTML content. */
    setContent: (content: string) => void;
    /** Convenience: focus the editor. */
    focus: () => void;
}

const DEFAULT_PLUGINS = [
    'directionality',
    'lists',
    'link',
    'image',
    'searchreplace',
    'fullscreen',
    'wordcount',
];

const DEFAULT_TOOLBAR =
    'paste | bold italic underline strikethrough removeformat | forecolor backcolor | ' +
    'link unlink image | blockquote rubybutton | hr | bullist numlist indent outdent | alignleft aligncenter alignright alignjustify | ' +
    'undo redo | ltr rtl | searchreplace | help';

const DEFAULT_MENUBAR = {
    edit: {
        title: 'Edit',
        items: 'undo redo | cut copy paste pastetext | selectall | searchreplace',
    },
    view: {
        title: 'View',
        items: 'visualaid fullscreen',
    },
    insert: {
        title: 'Insert',
        items: 'image link',
    },
    format: {
        title: 'Format',
        items: 'superscript subscript rubycharacter codeformat | styles | removeformat',
    },
};

const TinyRTE = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
    (
        {
            value,
            initialValue,
            onChange,
            onInit,
            onBlur,
            height = 350,
            plugins = DEFAULT_PLUGINS,
            toolbar = DEFAULT_TOOLBAR,
            disabled = false,
            placeholder,
            init = {
                mobile: {
                    // TinyMCE defaults to a minimal editor for mobile.
                    // This follows AO3's own practice of making use of
                    // this line to force the regular editor for desktop.
                    // Works as of v5.0.
                    theme: 'silver',
                },
                external_plugins: { rubycharacter: './tiny-plugins/ruby-characters.js' },
            },
            className,
        },
        ref
    ) => {
        const editorRef = useRef<TinyMCEEditor | null>(null);

        useImperativeHandle(ref, () => ({
            getEditor: () => editorRef.current,
            getContent: () => editorRef.current?.getContent() ?? '',
            setContent: (content: string) => {
                editorRef.current?.setContent(content);
            },
            focus: () => {
                editorRef.current?.focus();
            },
        }));

        const mergedInit: Record<string, unknown> = {
            height,
            menubar: 'edit view insert format',
            menu: DEFAULT_MENUBAR,
            plugins,
            toolbar,
            placeholder,
            branding: false,
            ...init,
        };

        const isControlled = value !== undefined;

        return (
            <div className={className}>
                <Editor
                    licenseKey="gpl"
                    disabled={disabled}
                    {...(isControlled ? { value } : { initialValue: initialValue ?? '' })}
                    init={mergedInit}
                    onInit={(event, editor) => {
                        editorRef.current = editor;
                        onInit?.(event, editor);
                    }}
                    onEditorChange={(content, editor) => {
                        onChange?.(content, editor);
                    }}
                    onBlur={(event, editor) => {
                        onBlur?.(event, editor);
                    }}
                />
            </div>
        );
    }
);

TinyRTE.displayName = 'RichTextEditor';

export default TinyRTE;
