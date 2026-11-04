export function isBalanceRequest(text) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/, '');
  return (
    /^(?:(?:what(?:'s| is)|show(?: me)?|check|tell me|how much|can you (?:show(?: me)?|check|tell me)|i want to (?:see|check)|do i have)\s+)?(?:my\s+)?(?:kudos\s+)?balance$/.test(
      normalized,
    ) ||
    /^(?:(?:show(?: me)?|tell me|how many)\s+)?(?:my\s+)?kudos(?:\s+balance)?(?:\s+(?:do i have|do i have left))?$/.test(
      normalized,
    )
  );
}
