import examples from '../../assets/examples/index.json';

/** Only bundled examples may be selected by a direct gallery link. */
export function exampleFromSearch(search: string): string | null {
    const id = new URLSearchParams(search).get('example');
    return id && Object.prototype.hasOwnProperty.call(examples, id) ? id : null;
}
