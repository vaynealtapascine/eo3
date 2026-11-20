<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: chapter = documentText(text);
</script>

<div class="fic-chapter">
    <div class="fic-chapter-heading">
        {#if chapter.meta.chapter}<p class="fic-chapter-number" data-edit-field="Chapter">{chapter.meta.chapter}</p>{/if}
        {#if chapter.meta.title}<h3 data-edit-field="Title">{chapter.meta.title}</h3>{/if}
        {#if chapter.meta.subtitle}<p class="fic-chapter-subtitle" data-edit-field="Subtitle">{chapter.meta.subtitle}</p>{/if}
    </div>
    {#if chapter.meta.epigraph}<blockquote class="fic-chapter-epigraph"><p data-edit-field="Epigraph"><FicText text={chapter.meta.epigraph} /></p>{#if chapter.meta.attribution}<p class="fic-chapter-attribution" data-edit-field="Attribution">{chapter.meta.attribution}</p>{/if}</blockquote>{/if}
    <div class="fic-chapter-prose" data-edit-input="draft"><FicText text={chapter.body} mode="blocks" /></div>
</div>
