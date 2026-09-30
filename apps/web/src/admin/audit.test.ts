import { describe, expect, it } from "vitest";
import { auditAction, auditCursor, auditDetail } from "./audit";

describe("audit display", () => {
  it("shows readable known actions while retaining their code", () => {
    expect(auditAction("booking.cancel")).toBe("取消訂位（booking.cancel）");
    expect(auditAction("future.action")).toBe("future.action");
    expect(auditAction("constructor")).toBe("constructor");
  });

  it("formats JSON and retains its original text; malformed text stays raw", () => {
    expect(auditDetail('{"reason":"<script>"}')).toEqual({
      display: '{\n  "reason": "<script>"\n}',
      raw: '{"reason":"<script>"}',
    });
    expect(auditDetail("{oops <script>")).toEqual({ display: "{oops <script>", raw: null });
  });

  it("parses only positive safe decimal IDs and keeps invalid values for App validation", () => {
    expect(auditCursor(null)).toBeUndefined();
    expect(auditCursor("51")).toBe(51);
    for (const invalid of ["", "0", "-1", "1.5", "01", "1e3", "9007199254740992"]) {
      expect(auditCursor(invalid)).toBe(invalid);
    }
  });
});
