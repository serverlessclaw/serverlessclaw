/**
 * Shared MockDynamo for infra tests.
 */
export class MockDynamo {
  arn: string;
  nodes: Record<string, unknown>;
  constructor(
    public name: string,
    public args: Record<string, unknown> = {}
  ) {
    this.arn = `arn:aws:dynamodb:us-east-1:123456789012:table/${name}`;
    this.nodes = {
      table: {
        arn: {
          apply: (fn: (arn: string) => unknown) => fn(this.arn),
        },
      },
    };
  }
}
