import {
    ModulePlugin,
    ModulePluginProps,
    HtmlData,
    CssData,
    Data,
    NamedInputData,
    EvalOptions,
} from '../../document';
import { Form, FormItem } from '../../uikit/form';
import Checkbox from '../../uikit/checkbox';
import { useId } from 'react';
import { ModuleStatus } from '../../ui/components/module-status';
import {
    StyleInlinerMode,
    StyleInlinerStats,
    stylesToAttrs,
    stylesToBody,
} from './inline-styles-core';

export type StyleInlinerData = {
    mode: StyleInlinerMode;
    keepClasses?: boolean;
};

function StyleInliner({ data, onChange, userData }: ModulePluginProps<StyleInlinerData>) {
    const id1 = useId();
    const id2 = useId();

    const stats = userData.stats as StyleInlinerStats | undefined;

    return (
        <Form>
            <FormItem label="mode" itemId={id1}>
                <select
                    id={id1}
                    value={data.mode}
                    onChange={(e) => {
                        onChange({
                            ...data,
                            mode: e.target.value as StyleInlinerMode,
                        });
                    }}
                >
                    <option value="attr">as style attributes</option>
                    <option value="element">as a &lt;style&gt; element</option>
                </select>
            </FormItem>
            {data.mode === 'attr' ? (
                <FormItem
                    label="strip classes"
                    description="Removes the `class` property from all HTML elements, because it’ll be removed by cohost anyway."
                    itemId={id2}
                >
                    <Checkbox
                        id={id2}
                        checked={!data.keepClasses}
                        onChange={(strip) => {
                            const newData = { ...data };
                            if (strip) delete newData.keepClasses;
                            else newData.keepClasses = true;
                            onChange(newData);
                        }}
                    />
                </FormItem>
            ) : null}
            <ModuleStatus>
                {stats?.mode === 'attr' ? (
                    <div>
                        affected {stats.inlinedToNodes} node{stats.inlinedToNodes === 1 ? '' : 's'}
                    </div>
                ) : stats?.mode === 'element' ? (
                    <div>
                        inlined {stats.styleTagBytes.toLocaleString('en-US')} byte
                        {stats.styleTagBytes === 1 ? '' : 's'}
                    </div>
                ) : null}
            </ModuleStatus>
        </Form>
    );
}

export default {
    id: 'transform.style-inliner',
    acceptsInputs: true,
    acceptsNamedInputs: false,
    component: StyleInliner as unknown,
    initialData() {
        return { mode: 'attr' };
    },
    description() {
        return 'Style Inliner';
    },
    async eval(
        data: StyleInlinerData,
        inputs: Data[],
        _named: NamedInputData,
        { userData }: EvalOptions
    ) {
        let htmlInput = '';
        let cssInput = '';
        for (const input of inputs) {
            let data;
            if ((data = input.into(HtmlData))) {
                htmlInput += data.contents;
            } else if ((data = input.into(CssData))) {
                cssInput += data.contents;
            } else {
                throw new Error('style inliner received input that is neither html nor css');
            }
        }

        const htmlSource = [
            '<!doctype html><html><head><style>',
            cssInput,
            '</style></head><body>',
            htmlInput,
            '</body></html>',
        ].join('');
        const doc = new DOMParser().parseFromString(htmlSource, 'text/html');

        const stats: StyleInlinerStats = {
            mode: data.mode,
            inlinedToNodes: 0,
            styleTagBytes: 0,
        };

        if (data.mode === 'attr') {
            stylesToAttrs(doc, stats);

            // cleanup for cohost
            if (!data.keepClasses) {
                for (const node of doc.querySelectorAll('[class]')) {
                    node.removeAttribute('class');
                }
            }
        } else if (data.mode === 'element') {
            stylesToBody(doc, stats);
        }

        userData.stats = stats;

        return new HtmlData(doc.body.innerHTML);
    },
} as ModulePlugin<StyleInlinerData>;
