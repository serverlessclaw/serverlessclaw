import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('Deployer IAM Policy', () => {
  it('should not contain broad iam:* permissions', () => {
    const content = fs.readFileSync('deployer.ts', 'utf8');

    expect(content).not.toContain("'iam:*'");
    expect(content).toContain("'iam:PassRole'");
    expect(content).toContain("'iam:GetRole'");
  });
});
