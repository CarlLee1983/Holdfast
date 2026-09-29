export interface HoldOrBookingState {
  status: "held" | "expired" | "released" | "confirmed" | "cancelled";
  cancelledBy: "admin" | "member" | null;
}

/** App 回傳有效狀態；Web 僅將每個狀態轉為顯示文字。 */
export function holdOrBookingStatus(value: HoldOrBookingState): string {
  switch (value.status) {
    case "held": return "保留中";
    case "expired": return "已過期";
    case "released": return "已釋放";
    case "confirmed": return "已訂位";
    case "cancelled": return value.cancelledBy === "admin" ? "管理者已取消" : "已取消";
    default: {
      const unreachable: never = value.status;
      return unreachable;
    }
  }
}
