<script>
    import { notesText, slug } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    export let id = '';
    $: work = notesText(text);
    $: prefix = slug(id || work.meta.id || 'fic-notes');
</script>

<div class="fic-notes">
    {#if work.meta.title}<h3>{work.meta.title}</h3>{/if}
    <FicText text={work.body} notes={work.notes} {prefix} mode="blocks" />
    {#if work.notes.length}<div class="fic-notes-end"><h4>Notes</h4><ol>
        {#each work.notes as note, i}
            <li><a name={prefix + '-note-' + (i + 1)}></a><p><FicText text={note.text} /> {#if note.referenced}<a href={'#' + prefix + '-ref-' + (i + 1)} title={'Return to reference ' + (i + 1)}>Return to text [{i + 1}]</a>{/if}</p></li>
        {/each}
    </ol></div>{/if}
</div>
