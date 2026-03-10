export interface ILockManager {
  acquire(lockId: string, ttlSeconds: number): Promise<boolean>;
  release(lockId: string): Promise<void>;
}

export interface SSTResource {
  AgentBus: { name: string };
  TelegramBotToken: { value: string };
}
