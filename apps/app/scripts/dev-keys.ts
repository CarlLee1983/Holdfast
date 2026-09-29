// vitest.config.ts（測試）與 admin-dev-token.ts（本機開發）共用：產生 Access 測試用的 RS256 金鑰。
import { exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";

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
