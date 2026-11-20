<script>
    import { normalize, documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: messages = normalize(text).split(/\n--- message ---\n/).map(documentText);
</script>

{#each messages as message, index}
    <div class="fic-email">
        <p class="fic-email-folder" data-edit-field={index === 0 ? 'Folder' : undefined}>{message.meta.folder || 'Inbox / Correspondence'}</p>
        {#if message.meta.subject}<h3 data-edit-field={index === 0 ? 'Subject' : undefined}>{message.meta.subject}</h3>{/if}
        <div class="fic-email-headers">
            {#each Object.entries(message.meta).filter(([key]) => !['folder', 'attachment', 'signature'].includes(key)) as [key, value]}
                <p><strong>{key[0].toUpperCase() + key.slice(1)}:</strong> <span data-edit-field={index === 0 ? key[0].toUpperCase() + key.slice(1) : undefined}>{value}</span></p>
            {/each}
        </div>
        <div class="fic-email-body" data-edit-input="draft"><FicText text={message.body} mode="blocks" />
            {#if message.meta.signature}<p data-edit-field={index === 0 ? 'Signature' : undefined}><FicText text={message.meta.signature} /></p>{/if}
        </div>
        {#if message.meta.attachment}<p class="fic-email-attachment">Attachment: <span data-edit-field={index === 0 ? 'Attachment' : undefined}>{message.meta.attachment}</span></p>{/if}
    </div>
{/each}
