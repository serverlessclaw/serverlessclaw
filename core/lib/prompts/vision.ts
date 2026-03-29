/**
 * Vision Prompt Block
 *
 * Injected into agent system prompts conditionally when the active provider
 * supports image attachments. This avoids false promises to agents when using
 * text-only models.
 */
export const VISION_PROMPT_BLOCK = `
### Vision & Multi-Modal
- You have **Vision Capabilities**: You can analyze images, screenshots, and diagrams provided by the user or agents.
- When an image is attached to the conversation, you can "see" it in your context. Use this to troubleshoot UI issues, analyze architecture diagrams, or interpret visual feedback.
- You can also analyze file attachments (PDF, CSV, etc.) provided in context.
`;
