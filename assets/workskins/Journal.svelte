<script>
    import { documentText, sections } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: journal = documentText(text);
</script>

<div class="fic-journal">
    <p class="fic-journal-label" data-edit-field="Title">{journal.meta.title || 'Private journal'}</p>
    <div data-edit-input="draft">
        {#each sections(journal.body) as entry}
            <div class="fic-journal-entry">
                {#if entry.title}<h3>{entry.title}</h3>{/if}
                <FicText text={entry.body} mode="blocks" />
            </div>
        {/each}
    </div>
</div>
