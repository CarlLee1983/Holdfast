import { toNumber, toText, type FormLike } from "../shared/form-values";

/** 保留表單 → RPC 輸入。 */
export function holdFormToInput(form: FormLike) {
  return {
    slotId: toNumber(form.get("slotId")),
    seats: toNumber(form.get("seats")),
    idempotencyKey: toText(form.get("idempotencyKey")),
  };
}
