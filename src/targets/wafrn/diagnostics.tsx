/** Everything wafrn will change about a post, as reported by ./index.tsx. */

interface ErrProps {
    isFirstOfType: boolean;
}

function tagNameOf(node: Element): string {
    return node?.tagName ? node.tagName.toLowerCase() : '???';
}

export const ERRORS = {
    'strip-element'({
        node,
        removedContents,
        isFirstOfType,
    }: { node: Element; removedContents: boolean } & ErrProps) {
        return (
            <div>
                {removedContents ? (
                    <>Element and its contents will be removed: &lt;{tagNameOf(node)}&gt;</>
                ) : (
                    <>Tag will be removed (its contents are kept): &lt;{tagNameOf(node)}&gt;</>
                )}
                {isFirstOfType && (
                    <div className="quick-help">
                        wafrn keeps a fixed list of tags, which includes <code>&lt;style&gt;</code>,{' '}
                        <code>&lt;details&gt;</code> and <code>&lt;marquee&gt;</code>. It has no{' '}
                        <code>&lt;div&gt;</code>: use <code>&lt;section&gt;</code> or{' '}
                        <code>&lt;aside&gt;</code> instead.
                    </div>
                )}
            </div>
        );
    },
    'strip-attribute'({ node, attr }: { node: Element; attr: string }) {
        return (
            <div>
                Attribute will be removed: <code>{attr}</code> on &lt;{tagNameOf(node)}&gt;
            </div>
        );
    },
    'css-property-dropped'({ property, isFirstOfType }: { property: string } & ErrProps) {
        return (
            <div>
                CSS property not allowed in a <code>style</code> attribute on wafrn:{' '}
                <code>{property}</code>
                {isFirstOfType && (
                    <div className="quick-help">
                        wafrn filters inline styles to a list of properties, but not the CSS inside
                        a <code>&lt;style&gt;</code> block, so put this rule in a CSS module
                        instead.
                    </div>
                )}
            </div>
        );
    },
    'invalid-css'({ message }: { message: string }) {
        return (
            <div>
                Some CSS couldn’t be read and was left out: <code>{message}</code>
            </div>
        );
    },
    'image-not-shown'({ src, isFirstOfType }: { src: string } & ErrProps) {
        return (
            <div>
                Image in the post text won’t be shown on wafrn:{' '}
                <code>
                    {src.slice(0, 80)}
                    {src.length > 80 ? '…' : ''}
                </code>
                {isFirstOfType && (
                    <div className="quick-help">
                        wafrn blanks images placed in a post’s text. Attach the image to the post as
                        media instead.
                    </div>
                )}
            </div>
        );
    },
};
