// vitest.config.ts（測試）、admin-dev-token.ts（本機開發）與 e2e/harness/admin-access.ts（E2E）共用：產生 Access 測試用的 RS256 金鑰並簽 JWT。
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

/** 內嵌 JWKS 模式專用的保留團隊網域（.invalid 永遠不會解析到真實主機）。 */
export const LOCAL_TEAM_DOMAIN = "local.invalid";

export interface DevKeys {
  privateKey: CryptoKey;
  publicJwk: JWK;
  privateJwk: JWK;
}

export async function generateDevKeys(kid: string): Promise<DevKeys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const meta = { alg: "RS256", use: "sig", kid };
  return {
    privateKey,
    publicJwk: { ...(await exportJWK(publicKey)), ...meta },
    privateJwk: { ...(await exportJWK(privateKey)), ...meta },
  };
}

export interface AccessJwtOptions {
  privateKey: CryptoKey;
  kid: string;
  email: string;
  audience: string;
  lifetimeSeconds: number;
}

/** 簽一張 Access 風格的 JWT（RS256，iss 為 `https://local.invalid`），給內嵌 JWKS 模式使用。 */
export async function signAccessJwt({ privateKey, kid, email, audience, lifetimeSeconds }: AccessJwtOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(`https://${LOCAL_TEAM_DOMAIN}`)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(privateKey);
}
