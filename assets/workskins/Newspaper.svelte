<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: article = documentText(text);
</script>

<div class="fic-news">
    {#if article.meta.paper}<p class="fic-news-masthead">{article.meta.paper}</p>{/if}
    <p class="fic-news-edition">{article.meta.edition || ''}{#if article.meta.date}<span>{article.meta.date}</span>{/if}</p>
    {#if article.meta.section}<p class="fic-news-section">{article.meta.section}</p>{/if}
    {#if article.meta.title}<h3>{article.meta.title}</h3>{/if}
    {#if article.meta.deck}<p class="fic-news-deck"><FicText text={article.meta.deck} /></p>{/if}
    {#if article.meta.by}<p class="fic-news-byline">By {article.meta.by}</p>{/if}
    <div class="fic-news-copy"><FicText text={article.body} mode="blocks" /></div>
    {#if article.meta.footer}<p class="fic-news-footer">{article.meta.footer}</p>{/if}
</div>
