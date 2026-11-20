<script>
    import { normalize, documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: posts = normalize(text).split(/\n--- post ---\n/).map(documentText);
</script>

<div class="fic-feed">
    <p class="fic-feed-heading">Following / Posts</p>
    {#each posts as post, index}
        <div class={'fic-feed-post' + (post.meta.reply ? ' fic-feed-reply' : '')}>
            {#if post.meta.reply}<p class="fic-feed-reply-label" data-edit-field={index === 0 ? 'Reply' : undefined} data-edit-prefix="Replying to ">Replying to {post.meta.reply}</p>{/if}
            <p class="fic-feed-name" data-edit-field={index === 0 ? 'Name' : undefined}>{post.meta.name || ''}<span>{post.meta.handle || ''}{#if post.meta.time} · {post.meta.time}{/if}</span></p>
            <div data-edit-input="draft"><FicText text={post.body} mode="blocks" /></div>
            {#if post.meta.metrics}<p class="fic-feed-metrics" data-edit-field={index === 0 ? 'Metrics' : undefined}>{post.meta.metrics}</p>{/if}
        </div>
    {/each}
</div>
