<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: letter = documentText(text);
</script>

<div class="fic-letter">
    {#if letter.meta.label}<p class="fic-letter-label">{letter.meta.label}</p>{/if}
    {#if letter.meta.date || letter.meta.place}<p class="fic-letter-date">{letter.meta.date || ''}{#if letter.meta.place}<br />{letter.meta.place}{/if}</p>{/if}
    {#if letter.meta.to}<p class="fic-letter-salutation">{letter.meta.to}</p>{/if}
    <FicText text={letter.body} mode="blocks" />
    {#if letter.meta.closing || letter.meta.from}<p class="fic-letter-signature">{letter.meta.closing || ''}{#if letter.meta.from}<br /><span>{letter.meta.from}</span>{/if}</p>{/if}
    {#if letter.meta.ps}<p class="fic-letter-postscript">P.S. <FicText text={letter.meta.ps} /></p>{/if}
</div>
