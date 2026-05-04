import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getAgentBusName } from '../resource-helpers';

let _eventbridge: EventBridgeClient | null = null;
let _db: DynamoDBDocumentClient | null = null;
let _busName: string | null = null;
let _memoryTableName: string | null = null;

export function getEventBridge(): EventBridgeClient {
  if (!_eventbridge) _eventbridge = new EventBridgeClient({});
  return _eventbridge;
}

export function resetEventBridge(): void {
  _eventbridge = null;
}

export function getDb(): DynamoDBDocumentClient {
  if (!_db) {
    const client = new DynamoDBClient({});
    _db = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _db;
}

export function resetDb(): void {
  _db = null;
}

export async function getBusName(): Promise<string> {
  if (_busName === null) {
    _busName = getAgentBusName() ?? 'AgentBus';
  }
  return _busName;
}

export async function getMemoryTableName(): Promise<string> {
  if (_memoryTableName === null) {
    const { getMemoryTableName: getTableName } = await import('../ddb-client');
    _memoryTableName = getTableName() ?? 'MemoryTable';
  }
  return _memoryTableName;
}
