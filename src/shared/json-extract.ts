/**
 * Tolerant JSON-object extraction from LLM replies.
 *
 * Extracted verbatim from src/main/workflow-runtime.ts (07-11 image-workflow)
 * so renderer-side workflow draft parsing can reuse the exact same behavior.
 */

/** Parse a JSON object out of an LLM reply, tolerating ```json fences and surrounding prose. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(text)
  if (direct) return direct
  const match = text.match(/\{[\s\S]*\}/)
  return match ? tryParse(match[0]) : null
}
