import { describe, expect, it } from "vitest";
import { bookingCancellation } from "./cancellation";

const cutoff = 1000;

describe("bookingCancellation", () => {
  it("已確認且早於取消截止時間為可取消", () => {
    expect(bookingCancellation({ status: "confirmed", cancellableUntil: cutoff }, cutoff - 1)).toBe("cancellable");
  });

  it("已確認且剛好等於取消截止時間仍可取消", () => {
    expect(bookingCancellation({ status: "confirmed", cancellableUntil: cutoff }, cutoff)).toBe("cancellable");
  });

  it("已確認且晚於取消截止時間為已過截止", () => {
    expect(bookingCancellation({ status: "confirmed", cancellableUntil: cutoff }, cutoff + 1)).toBe("past-cutoff");
  });

  it("已取消（會員取消或管理者取消）不適用，與是否過截止無關", () => {
    expect(bookingCancellation({ status: "cancelled", cancellableUntil: cutoff }, cutoff - 1)).toBe("not-applicable");
    expect(bookingCancellation({ status: "cancelled", cancellableUntil: cutoff }, cutoff + 1)).toBe("not-applicable");
  });
});
