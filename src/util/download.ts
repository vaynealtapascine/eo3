/**
 * Saves text as a file in the browser's downloads. The object URL is revoked a moment later:
 * revoking it right after `click()` can cancel the download in some browsers.
 */
export function downloadFile(
    contents: string,
    filename: string,
    type = 'application/octet-stream'
) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name for a work or group title, without characters file systems reject. */
export function safeFileName(title: string, extension: string): string {
    return `${title.replace(/[\/:*?"<>|]+/g, ' ').trim() || 'Untitled'}.${extension}`;
}
