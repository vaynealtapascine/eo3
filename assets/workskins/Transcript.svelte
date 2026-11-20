<script>
    import { chat } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: log = chat(text);
</script>

<div class="fic-transcript">
    <p class="fic-transcript-label" data-edit-field="Recording">{log.meta.recording || 'Transcript'}</p>
    {#if log.meta.title}<h3 data-edit-field="Title">{log.meta.title}</h3>{/if}
    <p class="fic-transcript-meta" data-edit-field="Date">{log.meta.date || ''}<br />Speakers: {log.speakers.join(', ')}</p>
    <div data-edit-input="draft">
        {#each log.items as item}
            {#if item.type === 'message'}
                <div class="fic-transcript-turn"><p class="fic-transcript-cue">{#if item.time}{item.time} · {/if}{item.name}</p><FicText text={item.text.trim()} mode="blocks" />
                    {#if item.quote}<blockquote><FicText text={item.quote} mode="blocks" /></blockquote>{/if}
                    {#each item.reactions as reaction}<p>Reactions: {reaction}</p>{/each}
                </div>
            {:else}<p class="fic-transcript-direction"><FicText text={item.text} /></p>{/if}
        {/each}
    </div>
</div>
