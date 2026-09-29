export interface ReservationState {
  status: "held" | "confirmed" | "released" | "cancelled";
  expiresAt?: number;
  cancelledBy: "admin" | "member" | null;
}

/** 到期由時間判定，即使背景釋放尚未執行也應顯示為過期。 */
export function reservationStatus(reservation: ReservationState, now: number): string {
  if (reservation.status === "held") return reservation.expiresAt !== undefined && reservation.expiresAt <= now ? "已過期" : "保留中";
  if (reservation.status === "released") return "已釋放";
  if (reservation.status === "cancelled") return reservation.cancelledBy === "admin" ? "管理者已取消" : "已取消";
  return "已訂位";
}

export function memberIdentity(reservation: {
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
}): string {
  return reservation.memberName || reservation.memberEmail || reservation.memberId;
}
