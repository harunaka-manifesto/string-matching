/**
 * Flags text layers that are almost certainly not UX copy (amounts, dates,
 * system chrome), so writers start with them skipped. Writers can unskip.
 */

export type NonCopyInput = {
  characters: string;
  layerName: string;
  /** Names of ancestor layers (instances, frames, groups) from the layer up to the root. */
  ancestorNames: readonly string[];
};

const MONTHS =
  'jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec|' +
  'januari|january|februari|february|maret|march|april|juni|june|juli|july|' +
  'agustus|august|september|oktober|october|november|desember|december';

const NUMBER_OR_AMOUNT =
  /^[-+]?\s*(rp|idr|usd|\$)?\s*[-+]?\s*\d[\d.,\s]*(\s*(%|x|×|rb|ribu|jt|juta|k|m|mb|gb|kb))?$/iu;
const TIME = /^\d{1,2}[:.]\d{2}(\s?(am|pm|wib|wita|wit))?$/iu;
const NUMERIC_DATE = /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/u;
const WORD_DATE = new RegExp(
  `^(\\d{1,2}\\s+(${MONTHS})\\.?(\\s+\\d{2,4})?|(${MONTHS})\\.?\\s+\\d{1,2}(,?\\s+\\d{2,4})?)` +
    `(,?\\s+\\d{1,2}[:.]\\d{2}(\\s?(am|pm|wib|wita|wit))?)?$`,
  'iu',
);
const PHONE = /^(\+62[\s-]?|62|0)8[\d\s-]{7,14}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/iu;
const MASKED = /^[*•·]{2,}[\s*•·\d]*$|^[\d\s]*[*•·]{3,}[\d\s*•·]*$/u;
const SYSTEM_CHROME =
  /\b(status ?bar|keyboard|home ?indicator|navigation ?bar ?(ios|android)|system ?bar|notch|dynamic ?island)\b/iu;
const DATA_LAYER_NAME =
  /^(amount|price|nominal|balance|saldo|date|time|tanggal|waktu|phone|phone ?number|no\.? ?hp|email|user ?name|name|nama|account ?number|no\.? ?rekening|counter|count|badge ?count|timer|otp)$/iu;

export function nonCopyReason(input: NonCopyInput): string | null {
  const text = input.characters.replace(/\s+/gu, ' ').trim();
  if (!text) return 'Empty';
  if ([...text].length <= 1) return 'Single character';
  if (input.ancestorNames.some((name) => SYSTEM_CHROME.test(name))) return 'System UI';
  if (TIME.test(text)) return 'Time';
  if (NUMERIC_DATE.test(text) || WORD_DATE.test(text)) return 'Date';
  if (PHONE.test(text)) return 'Phone number';
  if (EMAIL.test(text)) return 'Email';
  if (MASKED.test(text)) return 'Masked data';
  if (NUMBER_OR_AMOUNT.test(text)) return 'Number or amount';
  if (DATA_LAYER_NAME.test(input.layerName.trim())) return 'Dynamic data layer';
  return null;
}
