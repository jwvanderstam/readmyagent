import { generateKeyPairSync } from "node:crypto";
import { ExternalAccountClient, JWT } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthClient, DRIVE_SCOPES } from "@/lib/drive/credentials";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(() => Promise.resolve("vercel-oidc-token")),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

// These tests check the configuration handed to google-auth-library. They never request a token:
// the library's token exchange uses its own HTTP client, which a test cannot isolate from the
// network. The exchange itself is verified on a deployed instance (operations 1.3).
describe("createAuthClient", () => {
  it("configures Workload Identity Federation with the Vercel OIDC token and no key", async () => {
    const fromJSON = vi.spyOn(ExternalAccountClient, "fromJSON");

    createAuthClient({
      kind: "workload_identity",
      projectNumber: "123456789012",
      serviceAccountEmail: "readmyagent-drive@project.iam.gserviceaccount.com",
      poolId: "vercel",
      providerId: "vercel-provider",
    });

    const options = fromJSON.mock.calls[0]![0] as unknown as Record<string, unknown> & {
      subject_token_supplier: { getSubjectToken: () => Promise<string> };
    };
    expect(options).toMatchObject({
      type: "external_account",
      audience:
        "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel-provider",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url:
        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/readmyagent-drive%40project.iam.gserviceaccount.com:generateAccessToken",
      scopes: DRIVE_SCOPES,
    });
    expect(options).not.toHaveProperty("private_key");
    expect(options).not.toHaveProperty("credential_source");
    await expect(options.subject_token_supplier.getSubjectToken()).resolves.toBe(
      "vercel-oidc-token",
    );
  });

  it("creates a JWT client for the service account key fallback", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const client = createAuthClient({
      kind: "service_account_key",
      clientEmail: "sa@project.iam.gserviceaccount.com",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    expect(client).toBeInstanceOf(JWT);
  });
});
