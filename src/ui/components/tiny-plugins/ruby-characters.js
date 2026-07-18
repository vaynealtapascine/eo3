import tinymce from 'tinymce';

tinymce.PluginManager.add('rubycharacter', function (editor, url) {
    var openRubyDialog = function () {
        var currentNode = editor.selection.getNode();
        var rubyNode = editor.dom.getParent(currentNode, 'ruby');

        var baseText = '';
        var rubyText = '';
        var useRp = true;

        if (rubyNode) {
            var rtNode = rubyNode.querySelector('rt');
            rubyText = rtNode ? rtNode.textContent : '';

            var clone = rubyNode.cloneNode(true);
            var components = clone.querySelectorAll('rt, rp');
            components.forEach(function (el) {
                el.remove();
            });
            baseText = clone.textContent.trim();

            useRp = rubyNode.querySelector('rp') !== null;
        } else {
            baseText = editor.selection.getContent({ format: 'text' });
        }

        editor.windowManager.open({
            title: rubyNode ? 'Edit Ruby Characters' : 'Insert Ruby Characters',
            body: {
                type: 'panel',
                items: [
                    { type: 'input', name: 'baseText', label: 'Base Text (e.g., 漢)' },
                    { type: 'input', name: 'rubyText', label: 'Ruby Text / Furigana (e.g., かん)' },
                    { type: 'checkbox', name: 'useRp', label: 'Include <rp> fallback tags' },
                ],
            },
            buttons: [
                { type: 'cancel', text: 'Cancel' },
                { type: 'submit', text: 'Update', primary: true },
            ],
            initialData: {
                baseText: baseText,
                rubyText: rubyText,
                useRp: useRp,
            },
            onSubmit: function (api) {
                var data = api.getData();

                if (!data.baseText || !data.rubyText) {
                    editor.notificationManager.open({
                        text: 'Fields cannot be empty.',
                        type: 'error',
                    });
                    return;
                }

                // Safety Rule 1: Prevent submitting raw html containing <ruby> inside the input text box
                if (
                    data.baseText.toLowerCase().includes('<ruby') ||
                    data.rubyText.toLowerCase().includes('<ruby')
                ) {
                    editor.notificationManager.open({
                        text: 'Nesting ruby elements is not allowed.',
                        type: 'error',
                    });
                    return;
                }

                var html = '<ruby>' + data.baseText;
                if (data.useRp) {
                    html += '<rp>(</rp><rt>' + data.rubyText + '</rt><rp>)</rp>';
                } else {
                    html += '<rt>' + data.rubyText + '</rt>';
                }
                html += '</ruby>';

                if (rubyNode) {
                    editor.selection.select(rubyNode);
                    editor.insertContent(html);
                } else {
                    editor.insertContent(html);
                }
                api.close();
            },
        });
    };

    editor.addCommand('mceRubyCharacter', openRubyDialog);

    editor.ui.registry.addToggleButton('rubybutton', {
        icon: 'character-count',
        tooltip: 'Insert/Edit Ruby Character',
        onAction: function () {
            editor.execCommand('mceRubyCharacter');
        },
        onSetup: function (api) {
            var stateSelector = function () {
                var selectionHtml = editor.selection.getContent({ format: 'html' });
                var currentNode = editor.selection.getNode();
                var isInsideRuby = editor.dom.getParent(currentNode, 'ruby') !== null;

                // Safety Rule 2: Check if selection contains unmanaged ruby tags inside it
                var containsRuby = selectionHtml.toLowerCase().includes('<ruby');

                if (isInsideRuby) {
                    // Current cursor is inside a ruby tag: Enable button and set it to active (editing mode)
                    api.setEnabled(true);
                    api.setActive(true);
                } else if (containsRuby) {
                    // Selected block spans across existing ruby tags: Disable button to block nesting
                    api.setEnabled(false);
                    api.setActive(false);
                } else {
                    // Normal state: Enable button for a brand new ruby insertion
                    api.setEnabled(true);
                    api.setActive(false);
                }
            };

            editor.on('NodeChange', stateSelector);
            return function () {
                editor.off('NodeChange', stateSelector);
            };
        },
    });
});
