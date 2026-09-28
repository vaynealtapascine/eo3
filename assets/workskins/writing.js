// Shared writing helpers. Unknown or unfinished syntax stays visible as text.
export function normalize(text) {
    return String(text ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n');
}

export function documentText(text) {
    const source = normalize(text);
    const header = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    if (!header) return { meta: {}, body: source };
    const meta = {};
    const unrecognized = [];
    for (const line of header[1].split('\n')) {
        const field = line.match(/^([\w -]+):\s*(.*)$/);
        if (field) meta[field[1].trim().toLowerCase()] = field[2];
        else if (line.trim()) unrecognized.push(line);
    }
    return { meta, body: [...unrecognized, source.slice(header[0].length)].join('\n') };
}

export function sections(text) {
    const result = [];
    for (const line of normalize(text).split('\n')) {
        const heading = line.match(/^##\s+(.+)$/);
        if (heading) result.push({ title: heading[1], body: '' });
        else {
            if (!result.length) result.push({ title: '', body: '' });
            const last = result[result.length - 1];
            last.body += (last.body ? '\n' : '') + line;
        }
    }
    return result.filter((s) => s.title || s.body.trim());
}

export function blocks(text) {
    return normalize(text)
        .trim()
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((body, i, all) => {
            const before = all.slice(0, i).join('\n\n');
            if (/^---$/.test(body.trim())) return { type: 'break', text: '', before };
            if (body.split('\n').every((line) => /^> ?/.test(line)))
                return { type: 'quote', text: body.replace(/^> ?/gm, ''), before };
            return { type: 'paragraph', text: body, before };
        });
}

// Inline formatting is deliberately small: escaped punctuation, emphasis, code,
// strike-through and footnotes. No raw HTML or executable content is interpreted.
export function inline(text, notes = [], prefix = 'fic-notes', before = '') {
    const source = normalize(text);
    const pattern =
        /\\([^\n])|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|~~([^~\n]+)~~|`([^`\n]+)`|\[\^([^\]\n]+)\]|\n/g;
    const tokens = [];
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
        if (match.index > cursor)
            tokens.push({ type: 'text', text: source.slice(cursor, match.index) });
        const [raw, escaped, strong, em, strike, code, key] = match;
        if (escaped) tokens.push({ type: 'text', text: escaped });
        else if (strong) tokens.push({ type: 'strong', text: strong });
        else if (em) tokens.push({ type: 'em', text: em });
        else if (strike) tokens.push({ type: 's', text: strike });
        else if (code) tokens.push({ type: 'code', text: code });
        else if (key && notes.some((n) => n.key === key)) {
            const number = notes.findIndex((n) => n.key === key) + 1;
            const previous =
                tokens.filter((t) => t.type === 'note' && t.key === key).length +
                inline(before, notes, prefix).filter((t) => t.type === 'note' && t.key === key)
                    .length;
            tokens.push({
                type: 'note',
                text: `[${number}]`,
                key,
                number,
                target: `${prefix}-note-${number}`,
                reference: `${prefix}-ref-${number}${previous ? `-${previous + 1}` : ''}`,
            });
        } else tokens.push({ type: raw === '\n' ? 'br' : 'text', text: raw });
        cursor = match.index + raw.length;
    }
    if (cursor < source.length) tokens.push({ type: 'text', text: source.slice(cursor) });
    return tokens;
}

export function chat(text) {
    const { meta, body } = documentText(text);
    const items = [],
        speakers = [];
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (!line) {
            if (items.at(-1)?.type === 'message') items.at(-1).text += '\n';
            continue;
        }
        if (line.startsWith('! ')) {
            items.push({ type: 'event', text: line.slice(2) });
            continue;
        }
        const last = items.at(-1);
        if (line.startsWith('> ') && last?.type === 'message') {
            last.quote += (last.quote ? '\n' : '') + line.slice(2);
            continue;
        }
        if (line.startsWith('+ ') && last?.type === 'message') {
            last.reactions.push(line.slice(2));
            continue;
        }
        const turn =
            !line.startsWith('\\') &&
            !/^(https?|ftp|mailto):/i.test(line) &&
            line.match(/^(?:\[([^\]]+)\]\s*)?([^:\[\]\n]+(?:\s*\[[^\]\n]+\])?):\s*(.*)$/);
        if (turn) {
            const suffix = turn[2].trim().match(/^(.*?)\s+\[([^\]]+)\]$/);
            const name = (suffix ? suffix[1] : turn[2]).trim();
            if (!speakers.includes(name)) speakers.push(name);
            items.push({
                type: 'message',
                name,
                time: turn[1] || suffix?.[2] || '',
                text: turn[3],
                quote: '',
                reactions: [],
                speaker: speakers.indexOf(name) % 3,
            });
        } else {
            const value = line.startsWith('\\') ? line.slice(1) : raw;
            if (last?.type === 'message' || last?.type === 'text') last.text += '\n' + value;
            else items.push({ type: 'text', text: value });
        }
    }
    return { meta, items, speakers };
}

export function notesText(text) {
    const { meta, body } = documentText(text);
    const definitions = new Map(),
        prose = [];
    let active = null;
    for (const line of body.split('\n')) {
        const definition = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
        if (definition && !definitions.has(definition[1])) {
            active = definition[1];
            definitions.set(active, definition[2]);
        } else if (active && /^ {2,}\S/.test(line)) {
            definitions.set(active, definitions.get(active) + '\n' + line.trimStart());
        } else {
            active = null;
            prose.push(line);
        }
    }
    const content = prose.join('\n');
    const references = inline(
        content,
        [...definitions.keys()].map((key) => ({ key }))
    )
        .filter((token) => token.type === 'note')
        .map((token) => token.key);
    const keys = references.filter((key, i, all) => all.indexOf(key) === i);
    // Even unused definitions remain readable; nothing is silently discarded.
    for (const key of definitions.keys()) if (!keys.includes(key)) keys.push(key);
    return {
        meta,
        body: content,
        notes: keys.map((key) => ({
            key,
            text: definitions.get(key),
            referenced: references.includes(key),
        })),
    };
}

export function slug(text) {
    return (
        String(text)
            .replace(/[^a-zA-Z0-9_-]/g, '-')
            .replace(/-+/g, '-') || 'fic-notes'
    );
}
