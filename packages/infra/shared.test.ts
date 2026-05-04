import { describe, it, expect } from 'vitest';
import { getValidSecrets } from './shared';

describe('infra/shared utils', () => {
  describe('getValidSecrets', () => {
    it('should filter out undefined secrets', () => {
      const secrets = {
        ValidSecretOne: { name: 'ValidSecretOne', type: 'Secret', value: 'secret1' },
        MissingSecret: undefined,
        ValidSecretTwo: { name: 'ValidSecretTwo', type: 'Secret', value: 'secret2' },
      };

      const valid = getValidSecrets(secrets as any);

      expect(valid.length).toBe(2);
      expect(valid.find((s: any) => s.name === 'ValidSecretOne')).toBeDefined();
      expect(valid.find((s: any) => s.name === 'MissingSecret')).toBeUndefined();
    });

    it('should return empty array if all secrets are undefined', () => {
      const secrets = {
        MissingSecret: undefined,
      };

      const valid = getValidSecrets(secrets as any);

      expect(valid.length).toBe(0);
    });
  });
});
