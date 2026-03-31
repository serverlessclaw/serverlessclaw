import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TestImpactAnalyzer, CONFIG_TRIGGERS } from './test-affected';

function createTmpDir(): string {
  const dir = join(tmpdir(), `test-affected-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('TestImpactAnalyzer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('CONFIG_TRIGGERS', () => {
    it('should include vitest.config.ts', () => {
      expect(CONFIG_TRIGGERS).toContain('vitest.config.ts');
    });

    it('should include tsconfig.json', () => {
      expect(CONFIG_TRIGGERS).toContain('tsconfig.json');
    });

    it('should include package.json', () => {
      expect(CONFIG_TRIGGERS).toContain('package.json');
    });

    it('should include pnpm-lock.yaml', () => {
      expect(CONFIG_TRIGGERS).toContain('pnpm-lock.yaml');
    });
  });

  describe('extractImports', () => {
    it('should extract ES6 named imports', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(file, `import { foo, bar } from './other';\n`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toContain('./other');
    });

    it('should extract ES6 default imports', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(file, `import foo from './other';\n`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toContain('./other');
    });

    it('should extract ES6 namespace imports', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(file, `import * as foo from './other';\n`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toContain('./other');
    });

    it('should extract require statements', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(file, `const foo = require('./other');\n`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toContain('./other');
    });

    it('should extract dynamic imports', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(file, `const foo = import('./other');\n`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toContain('./other');
    });

    it('should extract multiple imports', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(
        file,
        `import { a } from './a';\nimport b from './b';\nconst c = require('./c');\n`
      );

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toContain('./a');
      expect(imports).toContain('./b');
      expect(imports).toContain('./c');
    });

    it('should return empty array for nonexistent files', () => {
      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(join(tmpDir, 'nonexistent.ts'));
      expect(imports).toEqual([]);
    });

    it('should return empty array for files with no imports', () => {
      const file = join(tmpDir, 'test.ts');
      writeFileSync(file, `export const foo = 42;\n`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const imports = analyzer.extractImports(file);
      expect(imports).toEqual([]);
    });
  });

  describe('resolveImportPath', () => {
    it('should resolve relative imports', () => {
      const srcDir = join(tmpDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'a.ts'), `export const a = 1;`);
      writeFileSync(join(srcDir, 'b.ts'), `import { a } from './a';`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const resolved = analyzer.resolveImportPath('./a', join(srcDir, 'b.ts'));
      expect(resolved).toBe(join(srcDir, 'a.ts'));
    });

    it('should resolve imports with different extensions', () => {
      const srcDir = join(tmpDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'a.tsx'), `export const a = 1;`);
      writeFileSync(join(srcDir, 'b.ts'), `import { a } from './a';`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const resolved = analyzer.resolveImportPath('./a', join(srcDir, 'b.ts'));
      expect(resolved).toBe(join(srcDir, 'a.tsx'));
    });

    it('should resolve index files in directories', () => {
      const srcDir = join(tmpDir, 'src');
      const moduleDir = join(srcDir, 'module');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, 'index.ts'), `export const a = 1;`);
      writeFileSync(join(srcDir, 'b.ts'), `import { a } from './module';`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const resolved = analyzer.resolveImportPath('./module', join(srcDir, 'b.ts'));
      expect(resolved).toBe(join(moduleDir, 'index.ts'));
    });

    it('should return null for bare specifiers', () => {
      const analyzer = new TestImpactAnalyzer(tmpDir);
      const resolved = analyzer.resolveImportPath('lodash', join(tmpDir, 'a.ts'));
      expect(resolved).toBeNull();
    });

    it('should return null for nonexistent relative imports', () => {
      const srcDir = join(tmpDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'a.ts'), `import { x } from './nonexistent';`);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const resolved = analyzer.resolveImportPath('./nonexistent', join(srcDir, 'a.ts'));
      expect(resolved).toBeNull();
    });

    it('should resolve alias imports when aliases are loaded', () => {
      const dashboardSrc = join(tmpDir, 'dashboard', 'src');
      const componentsDir = join(dashboardSrc, 'components');
      mkdirSync(componentsDir, { recursive: true });
      writeFileSync(join(componentsDir, 'Button.tsx'), `export default Button;`);
      writeFileSync(join(dashboardSrc, 'app.tsx'), `import Button from '@/components/Button';`);

      // Create a vitest config with the @ alias
      writeFileSync(
        join(tmpDir, 'vitest.config.ts'),
        `import path from 'node:path';\nexport default { test: { alias: { '@': path.resolve(__dirname, './dashboard/src') } } };\n`
      );

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const resolved = analyzer.resolveImportPath(
        '@/components/Button',
        join(dashboardSrc, 'app.tsx')
      );
      expect(resolved).toBe(join(componentsDir, 'Button.tsx'));
    });
  });

  describe('findSourceFiles', () => {
    it('should find TypeScript files', () => {
      writeFileSync(join(tmpDir, 'a.ts'), ``);
      writeFileSync(join(tmpDir, 'b.tsx'), ``);
      writeFileSync(join(tmpDir, 'c.js'), ``);
      writeFileSync(join(tmpDir, 'd.jsx'), ``);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const files = analyzer.findSourceFiles();
      expect(files.length).toBe(4);
    });

    it('should ignore node_modules', () => {
      const nmDir = join(tmpDir, 'node_modules');
      mkdirSync(nmDir, { recursive: true });
      writeFileSync(join(tmpDir, 'a.ts'), ``);
      writeFileSync(join(nmDir, 'b.ts'), ``);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const files = analyzer.findSourceFiles();
      expect(files.length).toBe(1);
      expect(files[0]).toContain('a.ts');
    });

    it('should ignore dot directories', () => {
      const dotDir = join(tmpDir, '.sst');
      mkdirSync(dotDir, { recursive: true });
      writeFileSync(join(tmpDir, 'a.ts'), ``);
      writeFileSync(join(dotDir, 'b.ts'), ``);

      const analyzer = new TestImpactAnalyzer(tmpDir);
      const files = analyzer.findSourceFiles();
      expect(files.length).toBe(1);
      expect(files[0]).toContain('a.ts');
    });
  });

  describe('isConfigChange', () => {
    it('should detect vitest.config.ts changes', () => {
      const analyzer = new TestImpactAnalyzer(tmpDir);
      const result = analyzer.isConfigChange([join(tmpDir, 'vitest.config.ts')]);
      expect(result).toBe(true);
    });

    it('should detect tsconfig.json changes', () => {
      const analyzer = new TestImpactAnalyzer(tmpDir);
      const result = analyzer.isConfigChange([join(tmpDir, 'tsconfig.json')]);
      expect(result).toBe(true);
    });

    it('should detect dashboard/tsconfig.json changes', () => {
      const analyzer = new TestImpactAnalyzer(tmpDir);
      const result = analyzer.isConfigChange([join(tmpDir, 'dashboard/tsconfig.json')]);
      expect(result).toBe(true);
    });

    it('should not detect non-config changes', () => {
      const analyzer = new TestImpactAnalyzer(tmpDir);
      const result = analyzer.isConfigChange([join(tmpDir, 'src/app.ts')]);
      expect(result).toBe(false);
    });
  });

  describe('findAffectedTests', () => {
    it('should detect directly affected test files', () => {
      const srcDir = join(tmpDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, 'utils.ts'),
        `export const add = (a: number, b: number) => a + b;`
      );
      writeFileSync(
        join(srcDir, 'utils.test.ts'),
        `import { add } from './utils';\ndescribe('add', () => { it('works', () => {}); });`
      );

      const analyzer = new TestImpactAnalyzer(tmpDir);
      analyzer.buildDependencyGraph();
      analyzer.findTestFiles();

      const affected = analyzer.findAffectedTests([join(srcDir, 'utils.ts')]);
      expect(affected).toContain(join(srcDir, 'utils.test.ts'));
    });

    it('should detect transitive dependents', () => {
      const srcDir = join(tmpDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'base.ts'), `export const base = 1;`);
      writeFileSync(
        join(srcDir, 'middle.ts'),
        `import { base } from './base';\nexport const mid = base + 1;`
      );
      writeFileSync(
        join(srcDir, 'middle.test.ts'),
        `import { mid } from './middle';\ndescribe('mid', () => { it('works', () => {}); });`
      );

      const analyzer = new TestImpactAnalyzer(tmpDir);
      analyzer.buildDependencyGraph();
      analyzer.findTestFiles();

      const affected = analyzer.findAffectedTests([join(srcDir, 'base.ts')]);
      expect(affected).toContain(join(srcDir, 'middle.test.ts'));
    });

    it('should return empty when no tests are affected', () => {
      const srcDir = join(tmpDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'a.ts'), `export const a = 1;`);
      writeFileSync(join(srcDir, 'b.ts'), `export const b = 2;`);
      writeFileSync(
        join(srcDir, 'b.test.ts'),
        `import { b } from './b';\ndescribe('b', () => { it('works', () => {}); });`
      );

      const analyzer = new TestImpactAnalyzer(tmpDir);
      analyzer.buildDependencyGraph();
      analyzer.findTestFiles();

      const affected = analyzer.findAffectedTests([join(srcDir, 'a.ts')]);
      expect(affected).toEqual([]);
    });
  });
});
