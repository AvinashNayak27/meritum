/** @param {string} text */
export function protectRewardOutput(text) {
  if (
    /(?:US\$|\$)\s*\d|\bUSD\s*[:=]?\s*\d|\d[\d,.]*\s*(?:USD|US dollars?|dollars?)\b|(?:provider|Bitrefill|funding)\s+(?:account\s+)?balance[^\n]{0,40}\d/i.test(
      text,
    )
  ) {
    return 'Provider funding amounts are private. I can help with your Kudos and reward face values in rupees.';
  }
  return text;
}
