import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const text = (path: string) => readFileSync(resolve(root, path), 'utf8');
test('MCP is registered in both settings shells and uses the shared preview controller', () => {
    const classic = text('web/src/components/settings-dialog.ts');
    expect(classic).toContain("id: 'mcp', label: 'MCP'");
    expect(classic).toContain("import('./settings/mcp.js').then(mod => mod.McpSection)");
    expect(classic).toContain("case 'mcp': return html`<${Comp} />`");
    expect(text('web/static/visual/frontend/src/panels/SettingsPanel.tsx')).toContain('import "./settings/McpSection"');
    expect(text('web/static/visual/frontend/src/panels/settings/McpSection.tsx')).toContain("registerSettingsPane({ id: 'mcp', label: 'MCP'");
    for (const path of ['web/src/components/settings/mcp.ts', 'web/static/visual/frontend/src/panels/settings/McpSection.tsx']) {
        const source = text(path);
        expect(source).toContain('createMcpSettingsController');
        expect(source).toContain('Preview compatibility');
        expect(source).toContain('Apply codemode');
        expect(source).toContain('acknowledged');
        expect(source).toContain('nativeBlockReason');
        expect(source).not.toContain('/apply'); expect(source).not.toContain('/save');
    }
    expect((text('web/src/utils/i18n.ts').match(/'settings\.section\.mcp': 'MCP'/g) || []).length).toBe(3);
});
