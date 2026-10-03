import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { deserializeV1 } from '../../src/storage/versions/v1';
import { workskinGroup } from '../../scripts/workskin-documents.mjs';
import catalog from '../../assets/examples/workskins.json';
import {
    collapsedStyles,
    GROUP_FRAME_PADDING,
    GROUP_HEADER_HEIGHT,
    layoutNodes,
} from '../../src/ui/components/module-graph/auto-layout';
import { groupCards } from '../../src/ui/components/module-graph/group-cards';
import {
    GRID_SIZE,
    MIN_COL_GAP,
    MOD_BASE_WIDTH,
} from '../../src/ui/components/module-graph/consts';

// Only port capabilities are needed here; the real plugins import browser editors.
vi.mock('../../src/plugins', () => ({
    MODULES: Object.fromEntries(
        [
            'source.text',
            'source.shared-styles',
            'source.svelte',
            'source.svelte-component',
            'source.settings',
        ].map((id) => [
            id,
            {
                load: async () => ({
                    id,
                    acceptsInputs: id === 'source.svelte' || id === 'source.shared-styles',
                    acceptsNamedInputs: id === 'source.svelte',
                }),
            },
        ])
    ),
}));

type Box = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Box, b: Box) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function checkLayout(doc: Document, expanded: string[]) {
    const groups = groupCards(doc, collapsedStyles(doc), expanded);
    const layout = layoutNodes(doc, groups);
    const stride = Math.ceil((MOD_BASE_WIDTH + MIN_COL_GAP) / GRID_SIZE) * GRID_SIZE;
    const boxes = new Map(
        [...layout.layouts].map(([id, node]) => [
            id,
            {
                left: node.column * stride,
                right: node.column * stride + MOD_BASE_WIDTH,
                top: node.y,
                bottom: node.y + node.height,
            },
        ])
    );
    const entries = [...boxes];
    for (let i = 0; i < entries.length; i++) {
        for (const [otherId, other] of entries.slice(i + 1)) {
            expect(overlaps(entries[i][1], other), `${entries[i][0]} overlaps ${otherId}`).toBe(
                false
            );
        }
    }
    const frames: Box[] = [];
    for (const card of groups.cards.filter((card) => card.expanded)) {
        const members = card.members.map((id) => boxes.get(id)!);
        const frame = {
            left: Math.min(...members.map((b) => b.left)) - GROUP_FRAME_PADDING,
            right: Math.max(...members.map((b) => b.right)) + GROUP_FRAME_PADDING,
            top: Math.min(...members.map((b) => b.top)) - GROUP_HEADER_HEIGHT,
            bottom: Math.max(...members.map((b) => b.bottom)) + GROUP_FRAME_PADDING,
        };
        for (const [id, box] of boxes) {
            if (!card.members.includes(id)) {
                expect(overlaps(frame, box), `${id} is inside ${card.title}`).toBe(false);
            }
        }
        for (const previous of frames) expect(overlaps(frame, previous)).toBe(false);
        frames.push(frame);
    }
    return { groups, boxes };
}

describe('workskin example layouts', () => {
    for (const item of catalog) {
        it(`${item.title}: flows left to right without overlaps in either group view`, async () => {
            const doc = deserializeV1(fs.readFileSync(`assets/examples/${item.file}`, 'utf8'));
            await doc.resolveUnloaded();
            expect(doc.modules.every((mod) => mod.graphPos === null)).toBe(true);
            const [writing, styles, compose] = doc.modules;
            const settings = doc.modules[6];
            const output = doc.parts[0].outputId;
            const collapsed = checkLayout(doc, []);
            const card = collapsed.boxes.get(collapsed.groups.cards[0].nodeId)!;
            expect(card.right).toBeLessThan(collapsed.boxes.get(output)!.left);
            expect(collapsed.boxes.get(styles.id)!.top).toBeGreaterThan(card.bottom);

            const expanded = checkLayout(
                doc,
                doc.groups.map((group) => group.id)
            );
            const members = doc.groups[0].moduleIds.map((id) => expanded.boxes.get(id)!);
            // The block's inputs (its text and its details) come before the renderer.
            for (const input of [writing, settings]) {
                expect(expanded.boxes.get(input.id)!.right).toBeLessThan(
                    expanded.boxes.get(compose.id)!.left
                );
            }
            expect(expanded.boxes.get(compose.id)!.right).toBeLessThan(
                expanded.boxes.get(output)!.left
            );
            expect(expanded.boxes.get(styles.id)!.top).toBeGreaterThan(
                Math.max(...members.map((box) => box.bottom))
            );
        });
    }

    it('keeps multiple imported groups and chapter outputs outside each other’s frames', async () => {
        const doc = new Document();
        const output = doc.parts[0].outputId;
        const secondOutput = doc.addPart('Second chapter').outputId;
        for (const [index, item] of catalog.slice(0, 2).entries()) {
            const group = await doc.insertGroupFile(workskinGroup(item));
            const target = index ? secondOutput : output;
            for (const moduleIndex of [1, 2]) {
                const module = doc.findModule(group.moduleIds[moduleIndex])!.shallowClone();
                module.sends = [target];
                doc.insertModule(module);
            }
        }
        checkLayout(doc, []);
        checkLayout(doc, [doc.groups[0].id]);
        checkLayout(
            doc,
            doc.groups.map((group) => group.id)
        );
    });
});
