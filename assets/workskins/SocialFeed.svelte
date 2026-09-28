<script>
    import { normalize, documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: posts = normalize(text).split(/\n--- post ---\n/).map(documentText);
</script>

<div class="fic-feed">
    <p class="fic-feed-heading">Following / Posts</p>
    {#each posts as post}
        <div class={'fic-feed-post' + (post.meta.reply ? ' fic-feed-reply' : '')}>
            {#if post.meta.reply}<p class="fic-feed-reply-label">Replying to {post.meta.reply}</p>{/if}
            <p class="fic-feed-name">{post.meta.name || ''}<span>{post.meta.handle || ''}{#if post.meta.time} · {post.meta.time}{/if}</span></p>
            <FicText text={post.body} mode="blocks" />
            {#if post.meta.metrics}<p class="fic-feed-metrics">{post.meta.metrics}</p>{/if}
        </div>
    {/each}
</div>
