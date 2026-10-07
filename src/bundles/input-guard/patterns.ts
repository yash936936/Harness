/**
 * Heuristic detectors for text that tries to give the model orders. DETECT-ONLY and easy to evade (paraphrase, another language,
 * encoding): a hit is evidence for the audit trail and a warning to the model, a miss proves nothing. The controls that do not depend on
 * recognising an attack are the action gates (policy-gates), the fence, and keeping untrusted text out of standing instructions (D-083).
 * Every quantifier is bounded so a hostile input cannot make a scan slow.
 */
export interface Pattern {
  id: string
  re: RegExp
}

export const PATTERNS: Pattern[] = [
  { id: 'ignore-instructions', re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|the|these)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?|constraints?)\b/i },
  { id: 'role-override', re: /\b(?:you are now|from now on,? you|act as (?:an?|the)|pretend (?:to be|you are)|your new (?:role|task|goal))\b/i },
  { id: 'new-instructions', re: /\b(?:new|updated|real|actual|secret|hidden) (?:instructions?|task|system prompt|directive)s?\s*[:\-]/i },
  { id: 'prompt-extraction', re: /\b(?:reveal|print|show|output|repeat|leak)\b[^.\n]{0,30}\b(?:system prompt|your instructions|hidden instructions|your prompt)\b/i },
  { id: 'chat-markers', re: /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<\/?s>|<<\s*SYS\s*>>/i },
  { id: 'fake-role-line', re: /(?:^|\n)[ \t]{0,8}(?:system|assistant|developer)[ \t]{0,4}:/i },
  { id: 'fence-forgery', re: /<<<[ \t]{0,4}(?:END|DATA)\b/i },
  { id: 'concealment', re: /\b(?:do not|don't|never)\b[^.\n]{0,10}\b(?:tell|inform|mention|reveal|alert|notify)\b[^.\n]{0,30}\b(?:user|owner|human|operator)\b/i },
  { id: 'exfiltration', re: /\b(?:send|post|upload|exfiltrate|forward|email|curl)\b[^.\n]{0,60}\b(?:to|at)\b[^.\n]{0,20}(?:https?:\/\/|[\w.-]{1,40}@[\w.-]{1,40})/i },
]

export function scan(text: string, maxChars = 200_000): string[] {
  const t = text.length > maxChars ? text.slice(0, maxChars) : text
  return PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id)
}
