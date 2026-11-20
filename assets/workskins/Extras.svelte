<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: work = documentText(text);
    $: chunks = work.body.split(/(^:::.*$)/m);
</script>

<div class="fic-extras">
    {#if work.meta.title}<h3 data-edit-field="Title">{work.meta.title}</h3>{/if}
    <div data-edit-input="draft">
        {#each chunks as chunk, i}
            {#if chunk.startsWith('::: ') && chunks[i + 2] === ':::'}
                <details class="fic-extras-panel"><summary>{chunk.slice(4)}</summary><div class="fic-extras-content"><FicText text={chunks[i + 1]} mode="blocks" /></div></details>
            {:else if chunk === ':::' && chunks[i - 2]?.startsWith('::: ')}
            {:else if !chunks[i - 1]?.startsWith('::: ') || chunks[i + 1] !== ':::'}
                <FicText text={chunk} mode="blocks" />
            {/if}
        {/each}
    </div>
</div>
