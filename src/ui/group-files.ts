import {
    GROUP_FILE_EXTENSION,
    GroupFile,
    groupFileName,
    parseGroupFile,
    stringifyGroupFile,
} from '../storage/group-file';
import { downloadFile } from '../util/download';

/** Saves a group as a file in the browser's downloads. */
export function downloadGroupFile(file: GroupFile) {
    downloadFile(stringifyGroupFile(file), groupFileName(file.title), 'application/json');
}

/** Asks for a group file; null if none was picked. Throws if it isn't a readable group file. */
export function pickGroupFile(): Promise<GroupFile | null> {
    return new Promise((resolve, reject) => {
        const input = window.document.createElement('input');
        input.type = 'file';
        input.accept = `${GROUP_FILE_EXTENSION},.json,application/json`;
        input.addEventListener('change', async () => {
            const picked = input.files?.[0];
            if (!picked) return resolve(null);
            try {
                resolve(parseGroupFile(await picked.text()));
            } catch (error) {
                reject(error);
            }
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}
