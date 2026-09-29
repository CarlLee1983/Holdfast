// 本機開發專用：產生一組測試金鑰，讓 /admin 在沒有 Cloudflare Access 時也能用。
//   - 私鑰只寫到 .wrangler/admin-dev/（已 gitignore，不會進版控）
//   - 公鑰 JWKS 與 Access 設定寫進 apps/app/.dev.vars
//   - 簽好的 JWT 寫進 apps/web/.dev.vars（ACCESS_DEV_JWT）
// 用法：bun run admin:dev-token [email]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const TEAM_DOMAIN = "holdfast-dev.cloudflareaccess.com";
const AUDIENCE = "holdfast-dev-audience";
const KID = "holdfast-dev-key";
const TOKEN_LIFETIME_SECONDS = 30 * 24 * 3600;

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const email = process.argv[2] ?? "dev-admin@example.com";

/** 更新 .dev.vars 中指定的鍵，保留其他行；值一律用單引號包起來。 */
async function upsertDevVars(file: string, values: Record<string, string>) {
  let lines: string[] = [];
  try {
    lines = (await readFile(file, "utf8")).split("\n").filter((line) => line !== "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const kept = lines.filter((line) => !Object.keys(values).some((key) => line.startsWith(`${key}=`)));
  const added = Object.entries(values).map(([key, value]) => `${key}='${value}'`);
  await writeFile(file, [...kept, ...added].join("\n") + "\n");
}

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const meta = { alg: "RS256", use: "sig", kid: KID };
const publicJwk = { ...(await exportJWK(publicKey)), ...meta };
const privateJwk = { ...(await exportJWK(privateKey)), ...meta };

const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ email })
  .setProtectedHeader({ alg: "RS256", kid: KID })
  .setIssuer(`https://${TEAM_DOMAIN}`)
  .setAudience(AUDIENCE)
  .setIssuedAt(now)
  .setExpirationTime(now + TOKEN_LIFETIME_SECONDS)
  .sign(privateKey);

const keyDir = path.join(repoRoot, ".wrangler/admin-dev");
await mkdir(keyDir, { recursive: true });
await writeFile(path.join(keyDir, "private.jwk.json"), JSON.stringify(privateJwk), { mode: 0o600 });

await upsertDevVars(path.join(repoRoot, "apps/app/.dev.vars"), {
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUDIENCE,
  ACCESS_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
});
await upsertDevVars(path.join(repoRoot, "apps/web/.dev.vars"), { ACCESS_DEV_JWT: token });

console.log(`已寫入 apps/app/.dev.vars 與 apps/web/.dev.vars（操作者 ${email}，效期 30 天）。`);
console.log("重新啟動 bun run dev / bun run preview 後生效。");
