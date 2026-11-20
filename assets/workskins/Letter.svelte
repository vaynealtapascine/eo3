<script>
    import { documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: letter = documentText(text);
</script>

<div class="fic-letter">
    {#if letter.meta.label}<p class="fic-letter-label" data-edit-field="Label">{letter.meta.label}</p>{/if}
    {#if letter.meta.date || letter.meta.place}<p class="fic-letter-date"><span data-edit-field="Date">{letter.meta.date || ''}</span>{#if letter.meta.place}<br /><span data-edit-field="Place">{letter.meta.place}</span>{/if}</p>{/if}
    {#if letter.meta.to}<p class="fic-letter-salutation" data-edit-field="To">{letter.meta.to}</p>{/if}
    <div data-edit-input="draft"><FicText text={letter.body} mode="blocks" /></div>
    {#if letter.meta.closing || letter.meta.from}<p class="fic-letter-signature" data-edit-field="Closing">{letter.meta.closing || ''}{#if letter.meta.from}<br /><span data-edit-field="From">{letter.meta.from}</span>{/if}</p>{/if}
    {#if letter.meta.ps}<p class="fic-letter-postscript">P.S. <span data-edit-field="PS"><FicText text={letter.meta.ps} /></span></p>{/if}
</div>
