export function memberIdentity(value: {
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
}): string {
  return value.memberName || value.memberEmail || value.memberId;
}

/** 會員帳號已刪除、姓名也不在時的顯示文字（日程表沒有 email 與 memberId 可退回）。 */
export const DELETED_MEMBER_LABEL = "已刪除的會員";
