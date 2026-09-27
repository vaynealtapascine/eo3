import { useMemo } from 'react';
import { css } from '@codemirror/lang-css';
import { CssData, ModulePlugin, ModulePluginProps } from '../../document';
import { CodeEditor } from '../../ui/components/code-editor';

export type SharedStylesData = {
    contents: string;
};

function SharedStylesEditor({ data, onChange }: ModulePluginProps<SharedStylesData>) {
    const extensions = useMemo(() => [css()], []);
    return (
        <div className="plugin-plain-text-editor">
            <CodeEditor
                value={data.contents}
                onChange={(contents) => onChange({ ...data, contents })}
                extensions={extensions}
                footer={
                    <div className="i-footer">
                        CSS here, and CSS connected to this node, goes to every chapter it’s
                        connected to. New chapters are connected automatically.
                    </div>
                }
            />
        </div>
    );
}

/**
 * The work's shared styles ("All chapters"): its own CSS after the CSS sent into it, passed on
 * to every part it's wired to. The document wires it to each new part (see Document.addPart).
 */
export default {
    id: 'source.shared-styles',
    acceptsInputs: true,
    acceptsNamedInputs: false,
    component: SharedStylesEditor,
    initialData(): SharedStylesData {
        return { contents: '' };
    },
    description() {
        return 'All chapters';
    },
    async eval(data, inputs) {
        const sheets = inputs.map((input) => {
            const cssData = input.into(CssData);
            if (!cssData) {
                throw new Error(
                    `All chapters only accepts CSS, but received ${input.typeDescription()}`
                );
            }
            return cssData.contents;
        });
        return new CssData([...sheets, data.contents].filter((s) => s.trim()).join('\n'));
    },
} as ModulePlugin<SharedStylesData>;
