/** Everything a custom-profile site will change about a post, as reported by ./target.tsx. */

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
                        This site’s profile only allows the elements listed in it.
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
                CSS property not allowed on this site: <code>{property}</code>
                {isFirstOfType && (
                    <div className="quick-help">
                        The profile lists which CSS properties the site keeps; others are removed.
                    </div>
                )}
            </div>
        );
    },
    'styling-dropped'({ count }: { count: number }) {
        return (
            <div>
                This site takes no styling, so {count} {count === 1 ? 'style was' : 'styles were'}{' '}
                left out.
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
    'class-collision'({ className }: { className: string }) {
        return (
            <div>
                Two different inline styles got the same class name <code>{className}</code>.
                Changing either style slightly avoids this.
            </div>
        );
    },
    'cross-part-css-conflict'({ selector }: { selector: string }) {
        return (
            <div>
                <code>{selector}</code> is styled differently in different parts; the site applies
                both everywhere.
            </div>
        );
    },
};
