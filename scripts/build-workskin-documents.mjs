import fs from 'node:fs';
import path from 'node:path';
import { documentToml, root, workskinDocument } from './workskin-documents.mjs';
const catalog = JSON.parse(
    fs.readFileSync(path.join(root, 'assets/examples/workskins.json'), 'utf8')
);
for (const item of catalog)
    fs.writeFileSync(
        path.join(root, 'assets/examples', item.file),
        documentToml(workskinDocument(item))
    );
console.log(`Built ${catalog.length} modular workskin documents.`);
