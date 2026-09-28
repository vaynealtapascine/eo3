<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: poem = documentText(text);
</script>

<div class="fic-verse">
    {#if poem.meta.title}<h3>{poem.meta.title}</h3>{/if}
    {#if poem.meta.label}<p class="fic-verse-label">{poem.meta.label}</p>{/if}
    {#each poem.body.trim().split(/\n\s*\n/) as stanza}
        <p class="fic-verse-stanza">{#each stanza.split('\n') as line, i}{#if i}<br />{/if}{(line.match(/^ +/)?.[0] || '').replaceAll(' ', '\u00a0')}<FicText text={line.trimStart()} />{/each}</p>
    {/each}
    {#if poem.meta.by}<p class="fic-verse-credit">{poem.meta.by}</p>{/if}
    {#if poem.meta.note}<p class="fic-verse-credit">{poem.meta.note}</p>{/if}
</div>
