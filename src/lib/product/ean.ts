// GTIN/EAN handling. An EAN turns product matching from fuzzy inference into a JOIN —
// but ONLY if it is validated. An unchecked barcode is worse than none, because it merges
// unrelated products with total confidence (see CLAUDE.md → Matching).

/**
 * Validate an EAN-8 / UPC-A / EAN-13 / GTIN-14 checksum.
 * @returns the digits when the checksum is valid, otherwise "".
 */
export function parseEan(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return "";
  const nums = digits.split("").map(Number);
  const check = nums.pop()!;
  let sum = 0;
  // weights alternate 3/1 leftwards from the check digit
  for (let i = nums.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += nums[i] * w;
  const expected = (10 - (sum % 10)) % 10;
  return expected === check ? digits : "";
}

/** True when the string carries a checksum-valid GTIN. */
export function isValidEan(raw: string | null | undefined): boolean {
  return parseEan(raw) !== "";
}
