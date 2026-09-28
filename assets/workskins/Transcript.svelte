<script>
    import { chat } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: log = chat(text);
</script>

<div class="fic-transcript">
    <p class="fic-transcript-label">{log.meta.recording || 'Transcript'}</p>
    {#if log.meta.title}<h3>{log.meta.title}</h3>{/if}
    <p class="fic-transcript-meta">{log.meta.date || ''}<br />Speakers: {log.speakers.join(', ')}</p>
    {#each log.items as item}
        {#if item.type === 'message'}
            <div class="fic-transcript-turn"><p class="fic-transcript-cue">{#if item.time}{item.time} · {/if}{item.name}</p><FicText text={item.text.trim()} mode="blocks" />
                {#if item.quote}<blockquote><FicText text={item.quote} mode="blocks" /></blockquote>{/if}
                {#each item.reactions as reaction}<p>Reactions: {reaction}</p>{/each}
            </div>
        {:else}<p class="fic-transcript-direction"><FicText text={item.text} /></p>{/if}
    {/each}
</div>
