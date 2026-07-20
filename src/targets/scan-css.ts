import { parse, walk, generate } from 'css-tree';
import { PushError } from './types';

/**
 * Scans authored CSS (arriving as a separate input to the target, rather than inline in the
 * content) for constructs sites strip from posts/workskins, and reports them via pushError.
 * This restores the warnings the content renderer already raises for inline styles — CSS
 * custom properties and `position: fixed` — for CSS that now reaches the target on its own.
 */
export function scanCssForWarnings(css: string, pushError: PushError): void {
    let ast;
    try {
        ast = parse(css);
    } catch {
        return; // a hard parse error surfaces elsewhere; don't crash the warning scan
    }

    walk(ast, {
        visit: 'Declaration',
        enter: function (node) {
            if (node.property.startsWith('--')) {
                pushError('strip-css-variable', { name: node.property });
                return;
            }
            if (node.property.toLowerCase() === 'position') {
                const value = generate(node.value).trim().toLowerCase();
                if (value === 'fixed') {
                    const rule = (this as { rule?: { prelude: unknown } }).rule;
                    pushError('position-fixed', {
                        selector: rule ? generate(rule.prelude as never) : undefined,
                    });
                }
            }
        },
    });
}
