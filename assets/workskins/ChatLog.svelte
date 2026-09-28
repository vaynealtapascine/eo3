<script>
    import { chat } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    export let variant = 'messages';
    export let self = '';
    $: log = chat(text);
    $: group = variant === 'group';
    $: outgoing = self || log.meta.self || log.speakers[1] || '';
</script>

<div class={group ? 'fic-group' : 'fic-message'}>
    <p class={group ? 'fic-group-heading' : 'fic-message-heading'}>
        {log.meta.title || (group ? '# general' : 'Messages')}
        <span>{log.meta.participants || log.speakers.join(' · ')}</span>
    </p>
    {#if log.meta.date}<p class={group ? 'fic-group-event' : 'fic-message-date'}>{log.meta.date}</p>{/if}
    {#each log.items as item}
        {#if item.type !== 'message'}
            <p class={group ? 'fic-group-event' : 'fic-message-date'}><FicText text={item.text} /></p>
        {:else}
            <div class={group ? 'fic-group-entry fic-group-' + ['a', 'b', 'c'][item.speaker] : item.name === outgoing ? 'fic-message-out' : 'fic-message-in'}>
                <p class={group ? 'fic-group-name' : 'fic-message-who'}>{item.name}{#if item.time}<span> · {item.time}</span>{/if}</p>
                <FicText text={item.text.trim()} mode="blocks" />
                {#if item.quote}<blockquote><FicText text={item.quote} mode="blocks" /></blockquote>{/if}
                {#each item.reactions as reaction}<p class={group ? 'fic-group-reaction' : 'fic-message-reaction'}>Reactions: <FicText text={reaction} /></p>{/each}
            </div>
        {/if}
    {/each}
    {#if log.meta.status}<p class={group ? 'fic-group-event' : 'fic-message-status'}>{log.meta.status}</p>{/if}
</div>
