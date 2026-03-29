# Environment Strategy & Stages

Serverless Claw follows a streamlined 2-tier environment strategy, moving from local experimentation to production with minimal complexity.

## 1. Local Development (`local`)
- **Purpose**: Rapid iteration, debugging, and testing new agent capabilities.
- **Trigger**: `make dev`
- **Identity**: Uses the bot token and secrets defined in your `.env` (prefixed with `SST_SECRET_`).
- **Webhook**: Pointed to your local SST proxy/API via `make telegram-setup ENV=local`.
- **Cleanup**: `make remove-local`

## 2. Production (`prod`)
- **Purpose**: Live environment for end-users. Managed manually for maximum control.
- **Trigger**: `make deploy ENV=prod`
- **Identity**: Uses production-only SST Secrets stored in AWS.
- **Webhook**: Pointed to the `PROD_API_URL` via `make telegram-setup ENV=prod`.

---

## Tooling Consistency

### Telegram Webhook Management
The `make telegram-setup` command resolves the correct API endpoint from your `.env` by looking up `<STAGE>_API_URL`.

| Command | Target URL Source |
| :--- | :--- |
| `make telegram-setup ENV=local` | `LOCAL_API_URL` |
| `make telegram-setup ENV=prod` | `PROD_API_URL` |

### Environment Files
Makefile targets automatically load environment files in the following order of priority:
1. `.env.$(ENV).local`
2. `.env.$(ENV)`
3. `.env.local`
4. `.env`

---

## 🔐 Secrets & Integrations

Serverless Claw supports multi-platform notifications. To enable these, you must configure the following SST Secrets:

| Secret Key | Platform | Description |
| :--- | :--- | :--- |
| `TelegramBotToken` | Telegram | Bot token from @BotFather |
| `DiscordBotToken` | Discord | Bot token from Discord Developer Portal |
| `SlackBotToken` | Slack | Bot User OAuth Token (starts with `xoxb-`) |

### Setting Secrets
**Local Development:**
Add to your `.env.local`:
```bash
SST_SECRET_TelegramBotToken=your_token
SST_SECRET_DiscordBotToken=your_token
SST_SECRET_SlackBotToken=your_token
```

**Production:**
Use the SST CLI to set secrets in AWS:
```bash
npx sst secret set TelegramBotToken your_token
npx sst secret set DiscordBotToken your_token
npx sst secret set SlackBotToken your_token
```

---

> [!IMPORTANT]
> **No CI/CD**: Automatic deployments via GitHub Actions have been disabled. All infrastructure changes and deployments must be performed via the local `make deploy` recipe to ensure intentionality and local verification.

> [!TIP]
> Always check your current API status with `make telegram-info` before starting a testing session to ensure the bot is pointing to the environment you are currently working in.
