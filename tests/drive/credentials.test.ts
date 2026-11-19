import { generateKeyPairSync } from "node:crypto";
import { IdentityPoolClient, JWT } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { createAuthClient, DRIVE_SCOPES } from "@/lib/drive/credentials";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(() => Promise.resolve("vercel-oidc-token")),
}));

// The fields google-auth-library keeps from the configuration; TypeScript marks them private.
type WifInternals = {
  audience: string;
  tokenUrl: string;
  serviceAccountImpersonationUrl: string;
  scopes: string[];
  subjectTokenSupplier: { getSubjectToken: () => Promise<string> };
};

// These tests check the configuration handed to google-auth-library. They never request a token:
// the library's token exchange uses its own HTTP client, which a test cannot isolate from the
// network. The exchange itself is verified on a deployed instance (operations 1.3).
describe("createAuthClient", () => {
  it("configures Workload Identity Federation with the Vercel OIDC token and no key", async () => {
    const client = createAuthClient({
      kind: "workload_identity",
      projectNumber: "123456789012",
      serviceAccountEmail: "readmyagent-drive@project.iam.gserviceaccount.com",
      poolId: "vercel",
      providerId: "vercel-provider",
    });

    expect(client).toBeInstanceOf(IdentityPoolClient);
    const wif = client as unknown as WifInternals;
    expect(wif.audience).toBe(
      "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel-provider",
    );
    expect(wif.tokenUrl).toBe("https://sts.googleapis.com/v1/token");
    expect(wif.serviceAccountImpersonationUrl).toBe(
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/readmyagent-drive@project.iam.gserviceaccount.com:generateAccessToken",
    );
    expect(wif.scopes).toEqual(DRIVE_SCOPES);
    await expect(wif.subjectTokenSupplier.getSubjectToken()).resolves.toBe("vercel-oidc-token");
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
