<script>
    import { documentText } from './writing';
    export let text = '';
    $: log = documentText(text);
</script>

<div class="fic-terminal">
    <p class="fic-terminal-bar">{log.meta.title || 'Terminal / Session 001'}</p>
    {#each log.body.split('\n') as line}
        {#if line.trim()}<p class={line.startsWith('$ ') ? 'fic-terminal-command' : /\b(?:WARN|ERROR)\b/.test(line) ? 'fic-terminal-warning' : ''}>{line}</p>{:else}<br />{/if}
    {/each}
</div>
