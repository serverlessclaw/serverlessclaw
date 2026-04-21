# ClawCenter Dashboard: Interface & Real-time Signals

> **Navigation**: [← Index Hub](../../INDEX.md)

This document describes the design system, real-time communication protocols, and visual standards for the ClawCenter dashboard.

## 🚢 Dashboard Architecture

The dashboard is built with **Next.js (App Router)** and **Tailwind CSS**. It serves as the primary visual interface for monitoring agent swarms and performing system audits.

### Mission Control Mode

A specialized, high-density dashboard state for human-agent collaboration, featuring real-time task visualization, trust monitoring, and human-in-the-loop (HITL) intervention gates.

---

## 🕹️ Mission Control Components

The dashboard introduces a set of specialized interactive components for co-managing the swarm:

### 1. Interactive Swarm Canvas (React Flow)

Visualizes the execution DAG of the swarm in real-time.

- **Node Deep-Dive**: Clicking a node opens the **TraceDetailSidebar**, providing real-time streaming logs (via AG-UI) and tool usage audit.
- **Attachment Presence**: Visualizes staged media (📎) directly on the task nodes to show data flow.

### 2. Council Judge Panel

A decision-gate component that activates when the **Council of Agents** requires human governance.

- **Synthesis Engine**: Merges conflicting reviews from Security, Architect, and Performance specialists.
- **Action Suite**: Provides "Overrule", "Approve with Directives", or "Veto" capabilities.

### 3. The Scales (Trust & Cognitive Health)

A real-time metrics cluster showing the stability and reputation of the active swarm.

- **Anomaly Highlight**: Triggers visual warnings when reasoning loops or cognitive degradation are detected.
- **Autonomy Mode**: Allows global toggling between `AUTO` and `HITL` modes.

---

### Real-time Communication (MQTT)

ClawCenter uses **AWS IoT Core** to provide low-latency, bi-directional communication between the serverless backend and the browser.

| Channel Type       | Endpoint (MQTT Topic)   | Purpose                                                     |
| :----------------- | :---------------------- | :---------------------------------------------------------- |
| **Agent Chunks**   | `users/{userId}/chunks` | Streaming text fragments from agents                        |
| **System Signals** | `users/{userId}/signal` | Deployment status and health alerts and per-session signals |
| **Trace Updates**  | `users/{userId}/traces` | Real-time DAG execution updates                             |

#### Topic Taxonomy (application namespaces)

The realtime Bridge and publisher code use these application-level topic namespaces which the IoT custom authorizer grants access to:

- `users/{userId}/...` (primary per-user channel, includes `signal`, `chunks`, `sessions/{sessionId}/signal`, `traces`, etc.)
- `workspaces/{workspaceId}/signal`
- `collaborations/{collaborationId}/signal`
- `system/metrics` (global system telemetry)

These topics are used by the `RealtimeBridge` implementation which routes EventBridge events into the appropriate MQTT topic (see core/handlers/bridge.ts).

#### Signal Flow

1. **Backend**: A Lambda agent emits a signal to the `AgentBus`.
2. **Bridge**: The `Real-time Bridge` handler captures the event.
3. **IoT**: The Bridge publishes the event to the user's MQTT topic.
4. **Browser**: The dashboard (via `useRealtime` hook) receives and renders the signal.

---

#### Realtime Auth Contract

The dashboard connects to AWS IoT using a WebSocket `wss://.../mqtt` URL returned by the config API. Connection details are exposed by the server via the dashboard config endpoint (`/api/config`) and consumed by the client `useRealtime` hook.

- Connection URL: the client connects to the WebSocket path at the `realtime.url` value and appends query parameters:
  - `x-amz-customauthorizer-name=<AuthorizerName>` — _optional_; included when the IoT custom authorizer name is provided by the config API.
  - `token=<clientToken>` — **required** by the custom authorizer. The dashboard will generate and persist a short, non-sensitive client token in browser `localStorage` under the key `sc_realtime_token` so reconnects reuse the same token.

- Token constraints: the custom authorizer requires a token string (server-side logic expects at least 10 characters). The token is not a credential with IAM rights; it is a lightweight client identifier used by the custom authorizer for session scoping.

- Implementation notes: The `useRealtime` hook constructs the full `mqtt.connect(...)` WebSocket URL (adds the authorizer name when present and the `token` query param), uses `protocol: 'wss'` and a generated `clientId`, and manages default subscriptions to `users/{userId}/#`.

- Important: do **not** rely on HTTP Basic username/password placeholders for IoT WebSocket auth — the correct contract is the query-parameter `token` (and optional custom authorizer name) as implemented by `useRealtime` and validated by `core/handlers/realtime-auth.ts`.

---

## 🎨 Design System & Theme

The dashboard follows a "Cyber-Industrial" aesthetic, prioritized for high-density information display and tactical observability.

### Color Palette (The "Stellar" Palette)

The theme is entirely driven by CSS variables defined in [`dashboard/src/globals.css`](../../dashboard/src/globals.css).

| Category        | Variable        | Purpose                                      |
| :-------------- | :-------------- | :------------------------------------------- |
| **Background**  | `--background`  | Main surface color (Pitch black / Off-white) |
| **Foreground**  | `--foreground`  | Primary text and high-contrast lines         |
| **Cyber Green** | `--cyber-green` | Success, running, and healthy states         |
| **Cyber Amber** | `--cyber-amber` | Warnings and in-progress tasks               |
| **Cyber Red**   | `--cyber-red`   | Errors, failures, and circuit breaker active |

### UI Best Practices

1. **Avoid Hardcoded Hex Codes**: Always use Tailwind's semantic utility classes (e.g., `text-foreground` instead of `text-white`).
2. **Adaptive Transparency**: Use Tailwind's opacity modifier for borders (e.g., `border-foreground/10`) to ensure they scale with the theme.
3. **Micro-animations**: Use subtle transitions on hover and state changes to make the interface feel alive.
4. **Smart Tooltips**: Use the `CyberTooltip` component for all action buttons and information icons. It uses React Portals to avoid stacking context issues and features smart positioning to stay within the viewport.

---

## Observation & Metrics Integrity

The dashboard enables high-fidelity observation of system internals, ensuring the backend trace state matches external reporting.

### 1. Consistency Probing

To detect drift between raw metrics and visual reporting, the **ConsistencyProbe** cross-references independent data sources:

- **Source A**: CloudWatch Metrics / DynamoDB Rollups (`TokenRollup`).
- **Source B**: The `TraceTable` (queried via `AgentIdIndex` GSI).
- **Goal**: Ensure completion counts, success rates, and `p95DurationMs` latency metrics match across the stack.

### 2. Trace Performance Tracking

Execution latency and token consumption are tracked per-agent and per-trace:

- **Metrics**: Percentiles (p50, p95) are calculated via the `CognitiveMetrics` background handlers and visualized in the System Pulse.

### 3. Proactive Failure Emission

Dashboard errors are emitted immediately for live remediation:

- **Signal**: `DASHBOARD_FAILURE_DETECTED` event.
- **Optics**: The `CognitiveHealthAPI` reads from the `HEALTH#SNAPSHOT#` prefix to provide instant system health visualization.

---

## 🧪 Development & Testing

To work on the dashboard UI locally:

```bash
# Start local dev server
cd dashboard
npm run dev
```

The dashboard uses **Vitest** for component testing. Ensure all UI changes pass before deploying:

```bash
cd dashboard
npm test
```

> [!TIP]
> Use the `THEME_DEBUG` toggle in the settings panel to quickly switch between Dark and Light modes for contrast testing.
