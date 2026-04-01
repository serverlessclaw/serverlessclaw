# Scaling Serverless Claw: Parallel Merging & MCP Code Investigation

## Objective
Enhance the self-evolution stack by solving the parallel Coder race condition (Item 2) and integrating advanced MCP-based codebase investigation tools (Item 3). This plan provides the blueprint for Kilo/Cline to execute.

---

## Part 1: Implement the Patch & Merge Pattern (Item 2)

**Goal:** Allow multiple Coder agents to operate in parallel isolated Lambdas without overwriting each other's changes in the Staging S3 Bucket.

### Step 1: Update Coder Agent Output
- **Target File:** `core/agents/coder.ts`
- **Action:** Instead of triggering `triggerDeployment` or `stageChanges` which zips the whole directory, the Coder Agent must output a standard Git `.patch` file.
- **Details:** 
  - After the LLM successfully writes the code, execute a system command `git diff > task-<taskId>.patch`.
  - Modify the Coder's JSON schema (or metadata return payload) to include the patch string or S3 URI to the patch file.
  - Remove the direct call to S3 staging from the Coder's local execution block.

### Step 2: Create the Merger Agent / Handler
- **Target File:** Create `core/handlers/merger.ts` or update `core/lib/agent/parallel-aggregator.ts`.
- **Action:** Introduce a node that acts as the single choke point for concurrent edits.
- **Details:**
  - This node listens for `PARALLEL_TASK_COMPLETED` events where `aggregationType: 'summary'`.
  - It pulls a fresh copy of the trunk codebase into its `/tmp` directory.
  - It loops through the results and applies patches sequentially: `git apply <patch_string>`.

### Step 3: Implement Conflict Resolution Loop
- **Target File:** The new Merger logic.
- **Action:** Handle `git apply` failures gracefully.
- **Details:**
  - If `git apply` returns a non-zero exit code (merge conflict), catch the error.
  - Emit a `CONTINUATION_TASK` back to the specific Coder Agent that failed.
  - Payload should include: *"Merge conflict encountered applying your patch. The trunk has moved on. Here is the new file state. Please regenerate your patch."*

### Step 4: Finalize Deployment
- **Target File:** The new Merger logic.
- **Action:** Trigger the actual AWS CodeBuild.
- **Details:**
  - Once all valid patches are applied, the Merger Node zips the finalized `/tmp` directory.
  - The Merger Node calls `stageChanges` and `triggerDeployment`, passing the combined `gapIds`.

---

## Part 2: Integrate MCP Codebase Investigation (Item 3)

**Goal:** Equip agents with AST-aware and Ripgrep MCP servers so they can navigate the codebase dynamically without needing hub-spoke markdown files.

### Step 1: Add MCP Servers to Workspace Definition
- **Target File:** A configuration script (e.g., `core/tools/knowledge/config.ts` or via the Dashboard's System Pulse).
- **Action:** Register two community MCP servers via the existing `registerMCPServer` utility.
- **Details:**
  - **Server 1 (Structural):** `code-index-mcp`
    - Command: `npx -y @anaisbetts/code-index-mcp .`
    - Purpose: Allows agents to "resolve definitions" and understand AST structure.
  - **Server 2 (Regex/Speed):** `mcp-ripgrep`
    - Command: `npx -y mcp-ripgrep@latest`
    - Purpose: Fast text searching.

### Step 2: Update Agent Tool Binding
- **Target File:** `core/agents/coder.ts` & `core/agents/strategic-planner.ts`
- **Action:** Bind the newly registered MCP tools to these agents.
- **Details:**
  - Use `installSkill` or modify the `getAgentTools` registry lookup so that Coders and Planners receive tools like `resolve_definition`, `find_usages`, and `rg_search`.

### Step 3: Update Prompts
- **Target File:** `core/agents/prompts/...` (or the `systemPrompt` for Planner/Coder).
- **Action:** Instruct agents to use these tools dynamically.
- **Details:**
  - Add instructions: *"When investigating the codebase, do not guess file locations. Use 'rg_search' to find keywords and 'resolve_definition' to understand how functions are imported and structured before making edits."*