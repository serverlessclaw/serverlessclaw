# Neural Path Tracing Architecture

> **Last Updated**: 23 March 2026

Serverless Claw uses a **Branched Neural Path Tracing** model to visualize complex, parallel multi-agent workflows.

## Trace Graph Model

Instead of a linear log, the system records a **Directed Acyclic Graph (DAG)** of execution nodes.

```text
 [ User Msg ] 
      |
   (root) 
  SuperClaw
      |
      +---------------------------+
      |                           |
  (node_A)                    (node_B)
  Planner Agent               Coder Agent
      |                           |
   [Research]                  [Fix Code]
      |                           |
      +------------+--------------+
                   |
                (node_C)
                QA Agent
```

1. **Trace ID Propagation**: A global `traceId` links all nodes in a single request lifecycle.
2. **Node Branching**: When an agent uses `dispatchTask`, a child `nodeId` is generated, linked to the `parentId`.
3. **DAG Visualization**: The ClawCenter dashboard renders this as a neural map, allowing users to drill down into specific parallel execution branches.

## Storage Optimization

To support efficient retrieval of entire execution graphs, the **TraceTable** (DynamoDB) uses a **Composite Primary Key**:
- **Hash Key (`traceId`)**: Links all nodes in a single user request.
- **Range Key (`nodeId`)**: Identifies individual agent executions or parallel branches.

This structure allows a single `Query` operation to retrieve the complete neural path for visualization.
