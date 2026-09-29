import { loginUrl } from "../auth/member";
import { CANCEL_INTENT, handleCancelPost } from "./cancel";
import { CONFIRM_INTENT, handleConfirmPost } from "./confirm";
import type { MemberPostOutcome } from "./member-post";
import { describeConfirmFailure } from "./reasons";

interface MePostContext {
  member: { memberId: string } | null;
  request: Request;
  app: Pick<Env["APP"], "confirmHold" | "cancelBooking">;
  url: URL;
}

/** 會員頁所有表單 POST 的入口：表單只解析一次，依 `intent` 分派；缺少或未知的 intent 一律 422。 */
export async function handleMePost({ member, request, app, url }: MePostContext): Promise<MemberPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303 };

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: describeConfirmFailure("invalid_input"), status: 422 };
  }

  switch (form.get("intent")) {
    case CONFIRM_INTENT:
      return handleConfirmPost({ member, form, app, url });
    case CANCEL_INTENT:
      return handleCancelPost({ member, form, app, url });
    default:
      return { error: describeConfirmFailure("invalid_input"), status: 422 };
  }
}
