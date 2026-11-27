import { PureComponent } from 'react';
import {
    ModulePlugin,
    ModulePluginProps,
    BlobData,
    canonicalMime,
    textData,
} from '../../document';
import { FileButton } from '../../uikit/file-button';
import '../../uikit/controls.css';
import base64js from 'base64-js';
import './file-data.less';
import { Select } from '../../uikit/select';

export type FileDataPluginData = {
    dataBase64: string;
    mime: string;
    outputMode: 'blob' | 'text';
};

class FileDataEditor extends PureComponent<ModulePluginProps<FileDataPluginData>> {
    onFile = (file: File) => {
        const fileReader = new FileReader();
        fileReader.onload = () => {
            this.props.onChange({
                ...this.props.data,
                dataBase64: base64js.fromByteArray(new Uint8Array(fileReader.result as ArrayBuffer)),
                mime: file.type,
            });
        };
        fileReader.readAsArrayBuffer(file);
    };

    render() {
        const { data, onChange } = this.props;
        const type = data.mime;
        let preview = null;

        if (type.startsWith('text/')) {
            const buf = base64js.toByteArray(data.dataBase64);
            const contents = new TextDecoder().decode(buf);
            preview = <textarea className="uikit-text-area" readOnly value={contents} />;
        } else if (type.startsWith('image/')) {
            const dataUrl = `data:${type};base64,${data.dataBase64}`;

            preview = <img alt="image preview" src={dataUrl} />;
        }

        if (data.dataBase64.length && !preview) {
            preview = `(no preview for ${type})`;
        }

        const outputId = Math.random().toString(36);

        return (
            <div className="plugin-file-data-editor">
                <FileButton onFiles={([file]) => this.onFile(file)}>
                    {data.dataBase64.length ? 'Choose another file…' : 'Choose file…'}
                </FileButton>
                <div className="file-preview">{preview}</div>
                <div>
                    <label htmlFor={outputId}>Output as:</label>{' '}
                    <Select
                        value={data.outputMode}
                        onChange={(e) => {
                            onChange({
                                ...data,
                                outputMode: (e.target as HTMLSelectElement).value as any,
                            });
                        }}
                    >
                        <option value="blob">data blob</option>
                        <option value="text">text (UTF-8), as its file type</option>
                    </Select>
                </div>
            </div>
        );
    }
}

/** The file's own type when it is a kind of text; otherwise plain text. */
function textMime(mime: string): string {
    const type = canonicalMime(mime) ?? '';
    return type.startsWith('text/') || type === 'application/javascript' || type === 'application/json'
        ? type
        : 'text/plain';
}

export default {
    id: 'source.file-data',
    acceptsInputs: false,
    acceptsNamedInputs: false,
    component: FileDataEditor as unknown, // typescript cant figure it out
    initialData(): FileDataPluginData {
        return { dataBase64: '', mime: 'application/octet-stream', outputMode: 'blob' };
    },
    description() {
        return 'File data';
    },
    async eval(data: FileDataPluginData) {
        if (data.outputMode === 'text') {
            const text = new TextDecoder().decode(base64js.toByteArray(data.dataBase64));
            // A .css, .html or .js file is that type of text, so CSS can style a chapter, etc.
            return textData(textMime(data.mime), text);
        }
        return new BlobData(base64js.toByteArray(data.dataBase64), data.mime);
    },
} as ModulePlugin<FileDataPluginData>;
