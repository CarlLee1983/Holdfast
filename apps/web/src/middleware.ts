import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { isAuthPath } from "./auth/member";

export const onRequest = defineMiddleware(async (context, next) => {
  // 登入、回呼、登出都由 App Worker 的 Better Auth 處理；redirect 要原樣（302 + Location）回給瀏覽器，
  // 不能在 Worker 內被追隨，所以明確設 manual
  if (isAuthPath(context.url.pathname)) {
    return env.APP.fetch(new Request(context.request, { redirect: "manual" }));
  }

  // 沒有 cookie 就不打 RPC。session 是否有效完全由 App 判斷，Web 只把結果放進 locals
  const cookie = context.request.headers.get("cookie");
  context.locals.member = cookie ? await env.APP.getMemberSession(cookie) : null;
  return next();
});
