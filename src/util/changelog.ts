/**
 * Turns commits from GitHub's compare API into a readable list of changes. Commits follow the
 * conventional style (`feat(scope): subject`), so they sort into new things, fixes and the rest.
 */

export interface Change {
    subject: string;
    /** The commit message's body, without trailer lines such as Co-Authored-By. */
    body: string;
    url: string;
    date: string;
}

export interface Changelog {
    features: Change[];
    fixes: Change[];
    other: Change[];
}

const CONVENTIONAL =
    /^(feat|fix|docs|test|tests|chore|ci|build|refactor|perf|style|revert)(?:\([^)]*\))?!?:\s*(.+)$/i;
const TRAILER = /^[\w-]+: .+$/;

/** Groups commits (oldest first, as the compare API lists them) with the newest first. */
export function parseChangelog(commits: unknown[]): Changelog {
    const log: Changelog = { features: [], fixes: [], other: [] };
    for (const item of [...commits].reverse() as any[]) {
        const message = String(item?.commit?.message ?? '');
        if ((item?.parents?.length ?? 0) > 1) continue; // merge commits repeat their branch
        const [firstLine, ...rest] = message.split('\n');
        const match = CONVENTIONAL.exec(firstLine.trim());
        const type = match?.[1].toLowerCase() ?? '';
        const change: Change = {
            subject: capitalize(match ? match[2] : firstLine.trim()),
            body: rest
                .filter((line) => !TRAILER.test(line.trim()))
                .join('\n')
                .trim(),
            url: String(item?.html_url ?? ''),
            date: String(item?.commit?.author?.date ?? ''),
        };
        if (type === 'feat') log.features.push(change);
        else if (type === 'fix') log.fixes.push(change);
        else log.other.push(change);
    }
    return log;
}

function capitalize(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `owner/repo` from a GitHub URL such as package.json's homepage. */
export function githubRepo(url: string): string | null {
    const match = /github\.com\/([^/]+)\/([^/#?]+)/.exec(url);
    return match ? `${match[1]}/${match[2].replace(/\.git$/, '')}` : null;
}

/** The commits between two revisions, from GitHub's public compare API. */
export async function fetchChangelog(repo: string, from: string, to: string): Promise<Changelog> {
    const response = await fetch(`https://api.github.com/repos/${repo}/compare/${from}...${to}`, {
        headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
        throw new Error(
            response.status === 404
                ? 'GitHub doesn’t know one of these versions.'
                : `GitHub answered ${response.status}.`
        );
    }
    const data = await response.json();
    return parseChangelog(Array.isArray(data?.commits) ? data.commits : []);
}
