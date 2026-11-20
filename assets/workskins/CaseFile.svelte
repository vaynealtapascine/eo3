<script>
    import { documentText, sections } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: report = documentText(text);
</script>

<div class="fic-case">
    {#if report.meta.classification}<p class="fic-case-classification" data-edit-field="Classification">{report.meta.classification}</p>{/if}
    <h3 data-edit-field="Title">{report.meta.title || 'Case file'}{#if report.meta.number}<span data-edit-field="Number" data-edit-prefix="No. ">No. {report.meta.number}</span>{/if}</h3>
    <dl class="fic-case-fields">
        {#each Object.entries(report.meta).filter(([key]) => !['classification', 'title', 'number', 'footer'].includes(key)) as [key, value]}
            <dt>{key}</dt><dd data-edit-field={key}>{value}</dd>
        {/each}
    </dl>
    <div data-edit-input="draft">
        {#each sections(report.body) as section}
            {#if section.title}<h4>{section.title}</h4>{/if}
            <FicText text={section.body} mode="blocks" />
        {/each}
    </div>
    {#if report.meta.footer}<p class="fic-case-footer" data-edit-field="Footer">{report.meta.footer}</p>{/if}
</div>
