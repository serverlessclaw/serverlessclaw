import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { resolve } from 'path';

describe('Deployer IAM Policy', () => {
  it('should not contain broad iam:* permissions', () => {
    const filePath = fs.existsSync(resolve(__dirname, 'deployer.ts'))
      ? resolve(__dirname, 'deployer.ts')
      : 'infra/deployer.ts';
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).not.toContain("'iam:*'");
    expect(content).toContain("'iam:PassRole'");
    expect(content).toContain("'iam:GetRole'");
  });
});
