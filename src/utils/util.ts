/**
 * Generate a short unique ID
 * Format: base36(timestamp) + random
 * Example: "lq8z9k3a" (8-10 chars)
 */
export function generateId(): string {
    const timestamp = Date.now().toString(36) // 7-8 chars
    const random = Math.random().toString(36).substring(2, 5) // 3 chars
    return timestamp + random // Total: 10-11 chars
}