export function memberIdentity(value: {
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
}): string {
  return value.memberName || value.memberEmail || value.memberId;
}
