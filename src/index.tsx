import { createRoot } from 'react-dom/client';
import { initStorage, MemoryStorage } from './storage';
import ApplicationFrame from './ui';

let canInit = true;
{
    // check support for <dialog>
    if (!HTMLDialogElement.prototype.showModal) canInit = false;
}

if (canInit) {
    document.querySelector('#script-not-executed')?.remove();

    const container = document.createElement('div');
    container.id = 'eo3-root';
    document.body.appendChild(container);
    const reactRoot = createRoot(container);

    initStorage()
        .then((storage) => {
            reactRoot.render(<ApplicationFrame storage={storage} />);
        })
        .catch((err) => {
            console.error(err);

            const storage = new MemoryStorage();
            reactRoot.render(
                <ApplicationFrame storage={storage} isMemoryStorage storageError={err} />
            );
        });
}
