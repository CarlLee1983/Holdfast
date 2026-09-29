import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";
import type { Clock } from "../shared/clock";
import { fail, ok, type Result } from "../shared/result";

/** ADR 0007：應用程式只驗 Access 簽發的 JWT，操作者以其中的 email 為準。 */
export interface AccessConfig {
  /** 例如 `team.cloudflareaccess.com`（可帶 `https://`）；空字串 = 尚未設定。 */
  teamDomain?: string;
  /** Access application 的 Audience (AUD) Tag；空字串 = 尚未設定。 */
  audience?: string;
  /** 內嵌 JWKS，僅供本機開發與測試；有值時不對外抓取。 */
  jwksJson?: string;
}

export interface AccessIdentity {
  email: string;
}

export type AccessVerifyResult = Result<AccessIdentity, "unauthorized">;

/** JWKS 快取存活時間；金鑰輪替時最久這麼久之後會重新抓取（jose 也會在遇到未知 kid 時重抓，冷卻 30 秒）。 */
const JWKS_CACHE_MAX_AGE_MS = 10 * 60_000;

// 模組層級快取：同一個 isolate 內重複請求共用抓到的 JWKS，不必每次都打 Access 的 certs 端點
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteKeySet(certsUrl: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(certsUrl);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(certsUrl), { cacheMaxAge: JWKS_CACHE_MAX_AGE_MS });
    remoteKeySets.set(certsUrl, keySet);
  }
  return keySet;
}

function normalizeTeamDomain(teamDomain: string): string {
  return teamDomain.trim().replace(/^https:\/\//, "").replace(/\/+$/, "");
}

/** 取得驗簽用的金鑰來源；設定不完整或內嵌 JWKS 損毀時回傳 null（呼叫端 fail closed）。 */
function resolveKeySet(config: AccessConfig, team: string): JWTVerifyGetKey | null {
  if (config.jwksJson) {
    try {
      return createLocalJWKSet(JSON.parse(config.jwksJson) as JSONWebKeySet);
    } catch (error) {
      console.error("ACCESS_JWKS_JSON 不是有效的 JWKS，管理 RPC 一律拒絕", error);
      return null;
    }
  }
  return remoteKeySet(`https://${team}/cdn-cgi/access/certs`);
}

/**
 * 建立 Access JWT 驗證器。任何一步失敗（缺設定、缺 JWT、簽章／aud／iss／exp 不符、沒有 email）
 * 都回傳同一個 `unauthorized`，不對呼叫端透露原因；原因只寫進 Workers Logs。
 */
export function createAccessVerifier(config: AccessConfig, clock: Clock) {
  return {
    async verify(jwt: unknown): Promise<AccessVerifyResult> {
      const team = normalizeTeamDomain(config.teamDomain ?? "");
      const audience = config.audience?.trim() ?? "";
      if (!team || !audience) {
        console.error(
          "Cloudflare Access 尚未設定（ACCESS_TEAM_DOMAIN / ACCESS_AUD 為空），管理 RPC 一律拒絕",
        );
        return fail("unauthorized");
      }
      if (typeof jwt !== "string" || jwt.length === 0) {
        return fail("unauthorized");
      }

      const keySet = resolveKeySet(config, team);
      if (!keySet) return fail("unauthorized");

      try {
        const { payload } = await jwtVerify(jwt, keySet, {
          algorithms: ["RS256"],
          issuer: `https://${team}`,
          audience,
          requiredClaims: ["exp"],
          currentDate: new Date(clock.now()),
        });
        const email = payload["email"];
        if (typeof email !== "string" || email.length === 0) {
          console.warn("Access JWT 沒有 email claim，拒絕");
          return fail("unauthorized");
        }
        return ok({ email });
      } catch (error) {
        console.warn("Access JWT 驗證失敗", error instanceof Error ? error.name : error);
        return fail("unauthorized");
      }
    },
  };
}
