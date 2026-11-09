import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import ts from 'typescript-eslint';
import config from '../eslint.config.js';
const ruleId = 'local/array-emptiness';
const entry = config.find((item) => item.rules?.[ruleId]);
assert.ok(entry, 'The array emptiness rule must be configured');
assert.equal(entry.rules?.[ruleId], 'error');
const root = mkdtempSync(join(tmpdir(), 'unfold-array-lint-'));
writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', jsx: 'preserve', noEmit: true },
    include: ['*.ts', '*.tsx']
}));
const helperPath = resolve(dirname(fileURLToPath(import.meta.url)), '../shared/arrays.ts');
const imports = `import { isEmpty, isNotEmpty } from ${JSON.stringify(helperPath)};\n`;
const declarations = `declare const items: string[];
declare const optional: string[] | undefined;
declare const nullable: string[] | null;
declare const nested: { items: string[] } | undefined;
declare const text: string;
declare const object: { length: number };
declare const bytes: Uint8Array;
declare const mixed: string[] | string;
declare const anything: any;
declare const readonlyItems: readonly string[];
declare const tuple: readonly [string, ...string[]];
`;
const linter = new Linter({ cwd: root });
const configs = [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: ts.parser } },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                parser: ts.parser,
                project: join(root, 'tsconfig.json'),
                tsconfigRootDir: root,
            }
        },
        plugins: entry.plugins ?? {},
        rules: { [ruleId]: 'error' }
    }
];
let sequence = 0;
const cases = [];
function check(code, jsx = false) {
    const filename = join(root, `fixture-${sequence++}.${jsx ? 'tsx' : 'ts'}`);
    const source = `${imports}${declarations}${code}`;
    writeFileSync(filename, source);
    return { source, filename, messages: linter.verify(source, configs, { filename }) };
}
for (const [code, helper] of [
    ['items.length === 0;', 'isEmpty'],
    ['0 === items.length;', 'isEmpty'],
    ['items["length"] == 0;', 'isEmpty'],
    ['items.length <= 0;', 'isEmpty'],
    ['0 >= items.length;', 'isEmpty'],
    ['items.length !== 0;', 'isNotEmpty'],
    ['items.length > 0;', 'isNotEmpty'],
    ['0 < items.length;', 'isNotEmpty'],
    ['if (items.length) {}', 'isNotEmpty'],
    ['while (items.length) {}', 'isNotEmpty'],
    ['for (; items.length;) {}', 'isNotEmpty'],
    ['items.length ? "yes" : "no";', 'isNotEmpty'],
    ['!items.length;', 'isEmpty'],
    ['!!items.length;', 'isNotEmpty'],
    ['Boolean(items.length);', 'isNotEmpty'],
    ['const all = items.length && items.every(Boolean);', 'isNotEmpty'],
    ['const className = items.length && "filled";', 'isNotEmpty'],
    ['if (optional?.length) {}', 'isNotEmpty'],
    ['optional?.length === 0;', 'isEmpty'],
    ['!nullable?.length;', 'isEmpty'],
    ['readonlyItems.length > 0;', 'isNotEmpty'],
    ['tuple.length > 0;', 'isNotEmpty'],
    [
        'function generic<T extends readonly string[]>(value: T) { return value.length === 0; }',
        'isEmpty'
    ]
]) {
    cases.push(test(`reports ${code}`, () => {
        const { messages } = check(code);
        assert.equal(messages.length, 1, JSON.stringify(messages));
        assert.equal(messages[0]?.ruleId, ruleId);
        assert.ok(messages[0].message.includes(helper));
    }));
}
for (const code of [
    'items.length === 1;',
    'items.length > 1;',
    'items.length < 2;',
    'items.length + 1;',
    'const count = items.length;',
    'const count = optional?.length ?? 0;',
    'const count = items.length || 10;',
    'const count = items.length && (items.length - 1);',
    'Boolean(items.length, sideEffect());',
    'items.length = 0;',
    'for (let i = 0; i < items.length; i++) {}',
    'text.length === 0;',
    'if (text.length) {}',
    'object.length > 0;',
    'bytes.length === 0;',
    'mixed.length === 0;',
    'anything.length === 0;',
    'isEmpty(items);',
    'isNotEmpty(items);'
]) {
    cases.push(test(`preserves ${code}`, () => {
        assert.deepEqual(check(code).messages, []);
    }));
}
cases.push(test('fixes ordinary checks with existing helper imports and stays stable', () => {
    const { source, filename } = check('const empty = !items.length; const present = items.length > 0;');
    const fixed = linter.verifyAndFix(source, configs, { filename });
    assert.equal(fixed.output, `${imports}${declarations}const empty = isEmpty(items); const present = isNotEmpty(items);`);
    assert.deepEqual(fixed.messages, []);
    assert.equal(linter.verifyAndFix(fixed.output, configs, { filename }).fixed, false);
}));
for (const code of [
    'optional?.length === 0;',
    '!nullable?.length;',
    '!nested?.items.length;',
    'items.length /* keep this explanation */ === 0;',
    'function example(isEmpty: () => boolean) { return items.length === 0; }',
    'const label = items.length && "filled";'
]) {
    cases.push(test(`does not autofix an unsafe or ambiguous replacement: ${code}`, () => {
        const { source, filename } = check(code);
        const fixed = linter.verifyAndFix(source, configs, { filename });
        assert.equal(fixed.fixed, false);
        assert.equal(fixed.messages[0]?.ruleId, ruleId);
    }));
}
for (const code of ['const view = items.length > 0 && <div/>;', 'const view = !items.length && <div/>;', 'const view = items.length && <div/>;']) {
    cases.push(test(`enforces JSX conditions: ${code}`, () => {
        const { messages } = check(code, true);
        assert.equal(messages.length, 1, JSON.stringify(messages));
        assert.equal(messages[0]?.ruleId, ruleId);
    }));
}
after(() => {
    rmSync(root, { recursive: true, force: true });
});

await Promise.all(cases);
