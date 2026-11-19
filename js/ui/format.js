/**
 * Currency display; an invalid currency code falls back to "amount CODE".
 * @param {number} amount
 * @param {string} currency
 */
export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
