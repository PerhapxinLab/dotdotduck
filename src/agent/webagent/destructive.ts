/**
 * Default destructive-action pattern list.
 *
 * Any tool whose name matches one of these regexes is auto-gated on a
 * `confirm` event before its handler runs. Hosts can override via
 * `WebAgentConfig.destructivePatterns`; per-action
 * `requireConfirmation: false` opts a single action out of the pattern
 * match even when its name would match.
 *
 * The list captures the verbs that show up across CRUD apps, billing
 * surfaces, comms, and account lifecycle — actions whose effect a user
 * cannot trivially undo by clicking around.
 */

export const DEFAULT_DESTRUCTIVE_PATTERNS: RegExp[] = [
  // Data destruction / mutation that's hard to reverse.
  /^(delete|remove|destroy|drop|purge|erase|wipe|clear|reset)(_|$)/i,
  // Outbound communication / publishing.
  /^(send|email|sms|notify|post|publish|share|broadcast|tweet)(_|$)/i,
  // Money movement.
  /^(pay|charge|transfer|refund|withdraw|invoice|subscribe|cancel_subscription)(_|$)/i,
  // Account / session lifecycle.
  /^(logout|signout|sign_out|deactivate|disable|suspend|ban)(_|$)/i,
  // Confirmation-shaped verbs commonly indicating an irreversible step.
  /^(confirm_purchase|place_order|submit_order|finalize_)/i,
];

export function isDestructiveByPattern(actionName: string, patterns: RegExp[]): boolean {
  for (const p of patterns) if (p.test(actionName)) return true;
  return false;
}
