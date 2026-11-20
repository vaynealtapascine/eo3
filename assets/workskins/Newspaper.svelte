<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: article = documentText(text);
</script>

<div class="fic-news">
    {#if article.meta.paper}<p class="fic-news-masthead" data-edit-field="Paper">{article.meta.paper}</p>{/if}
    <p class="fic-news-edition" data-edit-field="Edition">{article.meta.edition || ''}{#if article.meta.date}<span data-edit-field="Date">{article.meta.date}</span>{/if}</p>
    {#if article.meta.section}<p class="fic-news-section" data-edit-field="Section">{article.meta.section}</p>{/if}
    {#if article.meta.title}<h3 data-edit-field="Title">{article.meta.title}</h3>{/if}
    {#if article.meta.deck}<p class="fic-news-deck" data-edit-field="Deck"><FicText text={article.meta.deck} /></p>{/if}
    {#if article.meta.by}<p class="fic-news-byline">By <span data-edit-field="By">{article.meta.by}</span></p>{/if}
    <div class="fic-news-copy" data-edit-input="draft"><FicText text={article.body} mode="blocks" /></div>
    {#if article.meta.footer}<p class="fic-news-footer" data-edit-field="Footer">{article.meta.footer}</p>{/if}
</div>
