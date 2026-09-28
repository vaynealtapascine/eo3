<script>
    import { blocks, inline } from './writing';
    export let text = '';
    export let mode = 'inline';
    export let notes = [];
    export let prefix = 'fic-notes';
    export let before = '';
    $: tokens = inline(text, notes, prefix, before);
</script>

{#if mode === 'blocks'}
    {#each blocks(text) as block}
        {#if block.type === 'break'}<hr />
        {:else if block.type === 'quote'}<blockquote><p><svelte:self text={block.text} {notes} {prefix} before={before + block.before} /></p></blockquote>
        {:else}<p><svelte:self text={block.text} {notes} {prefix} before={before + block.before} /></p>{/if}
    {/each}
{:else}
    {#each tokens as token}
        {#if token.type === 'strong'}<strong>{token.text}</strong>
        {:else if token.type === 'em'}<em>{token.text}</em>
        {:else if token.type === 's'}<s>{token.text}</s>
        {:else if token.type === 'code'}<code>{token.text}</code>
        {:else if token.type === 'br'}<br />
        {:else if token.type === 'note'}<sup><a name={token.reference} href={'#' + token.target} title={'Read footnote ' + token.number}>{token.text}</a></sup>
        {:else}{token.text}{/if}
    {/each}
{/if}
