# 🍴 OSS Fork & Sync Strategy

> **Agent Context Loading**: Load this file when you are managing a community fork of ServerlessClaw and need to stay synchronized with the canonical Mother Hub.

ServerlessClaw is built on the principle of **Co-evolution**. Whether you are a core maintainer or a community member with a custom fork, staying up to date with the "Canonical Blueprint" ensures you benefit from the latest security guardrails and architectural innovations.

---

## 🛠️ Choosing Your Sync Path

There are two primary ways to track the Mother Hub:

| Method            | Best For...                              | Complexity | Reliability |
| :---------------- | :--------------------------------------- | :--------- | :---------- |
| **Standard Fork** | Users modifying the entire stack         | Low        | High        |
| **Subtree Sync**  | Users embedding Claw as a core component | Moderate   | Highest     |

---

## 🚀 Workflow 1: The Standard Fork

This is the recommended path for most OSS users. You treat the Mother Hub as an `upstream` remote.

### 1. Setup Upstream

```bash
git remote add upstream https://github.com/serverlessclaw/serverlessclaw.git
```

### 2. Fetch and Merge

```bash
git fetch upstream main
git merge upstream/main -m "chore: sync with canonical hub"
```

### 3. Resolve Conflicts

Focus on keeping your custom logic in separate directories or behind adapters to minimize merge friction.

---

## 🏗️ Workflow 2: The Subtree Method

Best for projects that include ServerlessClaw as a managed "core" directory (e.g., `core/`).

### 1. Initial Addition

```bash
git subtree add --prefix=core/ https://github.com/serverlessclaw/serverlessclaw.git main --squash
```

### 2. Pulling Evolution

```bash
git subtree pull --prefix=core/ https://github.com/serverlessclaw/serverlessclaw.git main --squash
```

---

## 🎛️ The Nerve: `claw-sync` CLI

For a unified experience, use the `@serverlessclaw/cli` (The Nerve) to manage your synchronization.

```bash
# Sync via Standard Fork
claw-sync --hub serverlessclaw/serverlessclaw --method fork

# Sync via Subtree
claw-sync --hub serverlessclaw/serverlessclaw --method subtree --prefix core/
```

> [!TIP]
> The CLI handles remote configuration and `git fetch` automatically, ensuring consistent settings across your fleet.

---

## 🧠 Co-evolution Contribution

If you develop an optimization in your fork that would benefit the entire ecosystem, we encourage you to **promote** it back to the Hub:

1.  **Extract**: Identify the reusable logic.
2.  **Abstract**: Remove any client-specific or PII data.
3.  **Contribute**: Open a Pull Request to the Mother Hub with the `evolution-contribution` label.

By contributing back, your innovation becomes part of the "Canonical Blueprint" and is broadcasted to all other managed and OSS spokes.

---

## 🛡️ Best Practices for OSS Forks

1.  **Strict Core Separation**: Avoid modifying files in the `core/` directory unless you plan to contribute them back.
2.  **Use Adapters**: Wrap canonical logic in adapters to handle your specific integrations.
3.  **Frequent Syncs**: Sync often to avoid large evolutionary gaps that become difficult to resolve.
