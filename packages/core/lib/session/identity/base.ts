import { MEMORY_KEYS } from '../../constants';
import { BaseMemoryProvider } from '../../memory/base';

/**
 * Base class for identity operations providing shared keys and memory provider access.
 */
export class IdentityBase {
  protected base: BaseMemoryProvider;

  constructor(base: BaseMemoryProvider) {
    this.base = base;
  }

  protected getUserKey(userId: string, orgId?: string): string {
    const prefix = orgId ? MEMORY_KEYS.ORG_PREFIX : MEMORY_KEYS.WORKSPACE_PREFIX;
    const scope = orgId ? `ORG#${orgId}#` : '';
    return `${prefix}${scope}USER#${userId}`;
  }

  protected getSessionKey(sessionId: string, orgId?: string): string {
    const prefix = orgId ? MEMORY_KEYS.ORG_PREFIX : MEMORY_KEYS.WORKSPACE_PREFIX;
    const scope = orgId ? `ORG#${orgId}#` : '';
    return `${prefix}${scope}SESSION#${sessionId}`;
  }

  protected getAclKey(resourceType: string, resourceId: string, orgId?: string): string {
    const prefix = orgId ? MEMORY_KEYS.ORG_PREFIX : MEMORY_KEYS.WORKSPACE_PREFIX;
    const scope = orgId ? `ORG#${orgId}#` : '';
    return `${prefix}${scope}ACL#${resourceType}#${resourceId}`;
  }
}
