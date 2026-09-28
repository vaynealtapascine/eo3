<script>
    import { normalize, documentText } from './writing';
    import FicText from './FicText.svelte';
    export let text = '';
    $: messages = normalize(text).split(/\n--- message ---\n/).map(documentText);
</script>

{#each messages as message}
    <div class="fic-email">
        <p class="fic-email-folder">{message.meta.folder || 'Inbox / Correspondence'}</p>
        {#if message.meta.subject}<h3>{message.meta.subject}</h3>{/if}
        <div class="fic-email-headers">
            {#each Object.entries(message.meta).filter(([key]) => !['folder', 'attachment', 'signature'].includes(key)) as [key, value]}
                <p><strong>{key[0].toUpperCase() + key.slice(1)}:</strong> {value}</p>
            {/each}
        </div>
        <div class="fic-email-body"><FicText text={message.body} mode="blocks" />
            {#if message.meta.signature}<p><FicText text={message.meta.signature} /></p>{/if}
        </div>
        {#if message.meta.attachment}<p class="fic-email-attachment">Attachment: {message.meta.attachment}</p>{/if}
    </div>
{/each}
