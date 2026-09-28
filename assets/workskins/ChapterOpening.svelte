<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: chapter = documentText(text);
</script>

<div class="fic-chapter">
    <div class="fic-chapter-heading">
        {#if chapter.meta.chapter}<p class="fic-chapter-number">{chapter.meta.chapter}</p>{/if}
        {#if chapter.meta.title}<h3>{chapter.meta.title}</h3>{/if}
        {#if chapter.meta.subtitle}<p class="fic-chapter-subtitle">{chapter.meta.subtitle}</p>{/if}
    </div>
    {#if chapter.meta.epigraph}<blockquote class="fic-chapter-epigraph"><p><FicText text={chapter.meta.epigraph} /></p>{#if chapter.meta.attribution}<p class="fic-chapter-attribution">{chapter.meta.attribution}</p>{/if}</blockquote>{/if}
    <div class="fic-chapter-prose"><FicText text={chapter.body} mode="blocks" /></div>
</div>
