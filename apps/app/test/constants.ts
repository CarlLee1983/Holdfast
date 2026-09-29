// vitest.config.ts（Node）與測試（workerd）共用的常數
export const TEST_KID = "test-key-1";
/** 內嵌 JWKS 模式的保留網域（與 scripts/dev-keys.ts 的 LOCAL_TEAM_DOMAIN 相同）。 */
export const TEST_TEAM_DOMAIN = "local.invalid";
/** 遠端 JWKS 模式（抓 certs 端點）用的團隊網域。 */
export const TEST_REMOTE_TEAM_DOMAIN = "holdfast-test.cloudflareaccess.com";
export const TEST_AUD = "test-audience-tag";
