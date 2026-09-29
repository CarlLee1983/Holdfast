import { z } from "zod";
import { invalidInput, type InvalidInput } from "../shared/result";

const DEFAULT_HOLD_TTL_SECONDS = 600;

const wholeNumber = (label: string) =>
  z.number({ error: `${label}必須是數字` }).int(`${label}必須是整數`);

const name = z
  .string({ error: "名稱必須是文字" })
  .trim()
  .min(1, "名稱不可為空");

const holdTtlSeconds = wholeNumber("保留期限").positive("保留期限必須大於 0");
const seatsPerHold = wholeNumber("單筆名額上限").min(1, "單筆名額上限至少為 1");
const cancellationCutoffSeconds = wholeNumber("取消截止時間").min(0, "取消截止時間不可為負");

/** 建立資源：保留期限省略時預設 10 分鐘。 */
export const createResourceInput = z.object({
  name,
  holdTtlSeconds: holdTtlSeconds.default(DEFAULT_HOLD_TTL_SECONDS),
  seatsPerHold,
  cancellationCutoffSeconds,
});

/** 修改資源：表單一次送出全部欄位，所以保留期限在這裡是必填，避免省略時悄悄被重設成預設值。 */
export const updateResourceInput = z.object({
  id: wholeNumber("資源").positive("資源編號無效"),
  name,
  holdTtlSeconds,
  seatsPerHold,
  cancellationCutoffSeconds,
});

export const createSlotInput = z
  .object({
    resourceId: wholeNumber("資源").positive("資源編號無效"),
    startsAt: wholeNumber("開始時間"),
    endsAt: wholeNumber("結束時間"),
    capacity: wholeNumber("容量").min(1, "容量至少為 1"),
  })
  .refine((slot) => slot.startsAt < slot.endsAt, {
    path: ["endsAt"],
    error: "結束時間必須晚於開始時間",
  });

export type CreateResourceInput = z.output<typeof createResourceInput>;
export type UpdateResourceInput = z.output<typeof updateResourceInput>;
export type CreateSlotInput = z.output<typeof createSlotInput>;

/** 在 RPC 邊界驗證未知輸入；失敗時轉成 `invalid_input`，欄位錯誤放在 `fields`（整體錯誤在 `_form`）。 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.output<S> } | InvalidInput {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const fields: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    (fields[field] ??= []).push(issue.message);
  }
  return invalidInput(fields);
}
