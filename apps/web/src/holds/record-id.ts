const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** 網址上的保留或訂位編號（同一筆資料、同一個 id）：正整數的標準寫法（不含前導 0、正負號、小數），否則 null。 */
export function parseRecordId(raw: string | undefined): number | null {
  if (raw === undefined || !POSITIVE_INTEGER.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
