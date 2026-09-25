import type { SanitizeConfig } from './archive-config';
import { rubyStrip } from './ruby-str';

/** A change the sanitizer made, surfaced so the UI can warn the author what AO3 will strip. */
export type Ao3Diagnostic =
    | {
          kind: 'strip-element';
          node: Element;
          /** true if the element and its contents were removed; false if only the tag was dropped. */
          removedContents: boolean;
      }
    | {
          kind: 'strip-attribute';
          node: Element;
          attr: string;
          /** 'disallowed' = attribute not on the allowlist; 'protocol' = URL scheme not permitted. */
          reason: 'disallowed' | 'protocol';
      };

export type Ao3DiagnosticSink = (diagnostic: Ao3Diagnostic) => void;

// Sanitize's REGEX_PROTOCOL, run on the entity-decoded attribute value.
const REGEX_PROTOCOL = /^\s*([^/#]*?)(?::|&#0*58|&#x0*3a)/i;

// Attributes Sanitize escapes (' ' → %20, '"' → %22) to work around a libxml2 bug; AO3 still does, so it's stored that way.
const UNSAFE_LIBXML_ATTRS_GLOBAL = new Set(['action', 'href', 'src']);
const UNSAFE_LIBXML_ATTRS_A = new Set(['name']);

/**
 * Port of the Sanitize gem's `Sanitize#node!` (v6.1, as pinned by otwarchive) over the browser
 * DOM: `Sanitize.clean` over a fragment's children. Every removal is reported to `onDiagnostic`.
 */
export function sanitizeFragment(
    root: Node,
    config: SanitizeConfig,
    onDiagnostic?: Ao3DiagnosticSink
): void {
    const allowlist = new Set<Element>();
    for (const child of Array.from(root.childNodes)) {
        cleanNode(child, config, onDiagnostic, allowlist);
    }
}

/**
 * The gem's per-node work, in its order: run the transformers (which may allowlist nodes);
 * unless allowlisted, drop the element with its contents if in `removeContents`, unwrap it if
 * not an allowed element (with spaces around `whitespaceElements`), else clean its attributes
 * and add the forced ones. Children are always traversed; comments are removed. Called with a
 * fresh allowlist this is `Sanitize.clean_node!`, which transformers use to re-clean a subtree.
 */
export function cleanNode(
    node: Node,
    config: SanitizeConfig,
    onDiagnostic?: Ao3DiagnosticSink,
    allowlist: Set<Element> = new Set()
): void {
    if (node.nodeType === Node.COMMENT_NODE) {
        (node as ChildNode).remove();
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const name = el.tagName.toLowerCase();

    for (const transform of config.transformers) {
        const result = transform(el, { isAllowlisted: allowlist.has(el) });
        if (result) for (const n of result.allowlist) allowlist.add(n);
    }

    const cleanChildren = () => {
        for (const child of Array.from(el.childNodes)) {
            cleanNode(child, config, onDiagnostic, allowlist);
        }
    };

    // A node a transformer vouched for is left as the transformer made it; children still traversed.
    if (allowlist.has(el)) {
        cleanChildren();
        return;
    }

    if (!config.elements.has(name)) {
        if (config.removeContents.has(name)) {
            onDiagnostic?.({ kind: 'strip-element', node: el, removedContents: true });
            el.remove();
            return;
        }
        // Unwrap. Sanitize goes top-down and continues into the reparented children; cleaning
        // them first gives the same tree.
        cleanChildren();
        onDiagnostic?.({ kind: 'strip-element', node: el, removedContents: false });
        unwrap(el, config.whitespaceElements.has(name));
        return;
    }

    cleanChildren();

    cleanAttributes(el, name, config, onDiagnostic);

    const additions = config.addAttributes[name];
    if (additions) {
        for (const [attr, value] of Object.entries(additions)) el.setAttribute(attr, value);
    }

    ELEMENT_SPECIAL_CASES[name]?.(el);
}

/** The gem's per-element special cases (the `case name` block in `CleanElement#call`), run after attribute cleaning. */
const ELEMENT_SPECIAL_CASES: Readonly<Record<string, (el: Element) => void>> = {
    // iframe content is parsed as raw text and serialized verbatim; never keep it.
    iframe: (el) => el.replaceChildren(),
};

/** `all` ∪ `byTag[name]`, cached per (config, tag) since it's needed on every element. */
const ALLOWED_ATTRIBUTES_CACHE = new WeakMap<SanitizeConfig, Map<string, ReadonlySet<string>>>();

function allowedAttributes(config: SanitizeConfig, name: string): ReadonlySet<string> {
    let byTag = ALLOWED_ATTRIBUTES_CACHE.get(config);
    if (!byTag) ALLOWED_ATTRIBUTES_CACHE.set(config, (byTag = new Map()));
    let allowed = byTag.get(name);
    if (!allowed) {
        allowed = new Set([...config.allAttributes, ...(config.attributesByTag[name] ?? [])]);
        byTag.set(name, allowed);
    }
    return allowed;
}

/** Replace an element with its children. For whitespace elements: a space before always, after only if it had children (the gem's sequence). */
function unwrap(el: Element, addWhitespace: boolean): void {
    const parent = el.parentNode;
    if (!parent) {
        el.remove();
        return;
    }
    const doc = el.ownerDocument!;
    if (addWhitespace) {
        parent.insertBefore(doc.createTextNode(' '), el);
        if (el.firstChild) parent.insertBefore(doc.createTextNode(' '), el.nextSibling);
    }
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
}

function cleanAttributes(
    el: Element,
    name: string,
    config: SanitizeConfig,
    onDiagnostic?: Ao3DiagnosticSink
): void {
    const allowed = allowedAttributes(config, name);
    const tagProtocols = config.protocols[name];

    for (const attr of Array.from(el.attributes)) {
        const attrName = attr.name.toLowerCase();

        if (!allowed.has(attrName)) {
            onDiagnostic?.({
                kind: 'strip-attribute',
                node: el,
                attr: attrName,
                reason: 'disallowed',
            });
            el.removeAttribute(attr.name);
            continue;
        }

        let value = attr.value;

        const protocols = tagProtocols?.[attrName];
        if (protocols) {
            if (!isAllowedProtocol(value, protocols)) {
                onDiagnostic?.({
                    kind: 'strip-attribute',
                    node: el,
                    attr: attrName,
                    reason: 'protocol',
                });
                el.removeAttribute(attr.name);
                continue;
            }
            value = rubyStrip(value); // so the surrounding whitespace isn't escaped below
        }

        if (
            UNSAFE_LIBXML_ATTRS_GLOBAL.has(attrName) ||
            (name === 'a' && UNSAFE_LIBXML_ATTRS_A.has(attrName))
        ) {
            value = value.replace(/[ "]/g, (ch) => (ch === ' ' ? '%20' : '%22'));
        }

        if (value !== attr.value) el.setAttribute(attr.name, value);
    }
}

/** A scheme (per REGEX_PROTOCOL) must be listed; a scheme-less value needs `"relative"` listed. */
function isAllowedProtocol(value: string, protocols: readonly string[]): boolean {
    const match = REGEX_PROTOCOL.exec(value);
    if (match) return protocols.includes(match[1].toLowerCase());
    return protocols.includes('relative');
}
