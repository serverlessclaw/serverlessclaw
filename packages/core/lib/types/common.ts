/**
 * Common reusable type definitions for the Serverless Claw system.
 */

/**
 * User roles for RBAC.
 */
export enum UserRole {
  /** Full system access. */
  OWNER = 'owner',
  /** Can manage agents, settings, and members. */
  ADMIN = 'admin',
  /** Can interact with agents and view traces. */
  MEMBER = 'member',
  /** Read-only access to dashboard. */
  VIEWER = 'viewer',
}

/**
 * A generic map for dynamic metadata, ensuring all values are reachable via indexed access.
 * Use this over Record<string, any> for metadata structures.
 */
export interface MetadataMap {
  [key: string]: unknown;
}

/**
 * Represents a standard DynamoDB item with string keys and serializable values.
 */
export interface DynamoDBItem {
  [key: string]: string | number | boolean | null | undefined | MetadataMap | unknown[];
}

/**
 * Type-safe definition for DynamoDB BatchWriteCommand 'RequestItems' input.
 */
export interface DynamoDBBatchWriteRequest {
  [tableName: string]: Array<{
    PutRequest?: {
      Item: DynamoDBItem;
    };
    DeleteRequest?: {
      Key: Record<string, string | number>;
    };
  }>;
}

/**
 * Represents the usage statistics for an LLM request.
 */
export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
}

/**
 * Type for SST Resource proxy in logic code.
 */
export interface SSTConfigResource {
  ConfigTable: { name: string };
  MemoryTable?: { name: string };
  TraceTable?: { name: string };
}
