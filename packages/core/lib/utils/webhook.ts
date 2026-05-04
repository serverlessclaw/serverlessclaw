/**
 * Verifies an HMAC signature for a webhook payload.
 *
 * @param payload - The raw string body of the webhook.
 * @param signature - The signature header value (e.g. sha256=...).
 * @param secret - The configured webhook secret.
 * @param prefix - Optional prefix used in the signature (e.g. 'sha256=').
 */
export { verifySecret, verifyHmacSignature } from './crypto';
