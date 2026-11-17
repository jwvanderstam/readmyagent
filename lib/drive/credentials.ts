import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";
import { type AuthClient, ExternalAccountClient, JWT } from "google-auth-library";
import type { DriveCredentials } from "@/lib/config";

// Drive scope, effectively limited to the one folder shared with the service account (ADR-0006).
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * An auth client for the configured credentials. Workload Identity Federation exchanges the
 * Vercel OIDC token for a short-lived token of the service account; no Google secret is stored
 * (ADR-0008). The key is a fallback for environments without Vercel OIDC.
 */
export function createAuthClient(credentials: DriveCredentials): AuthClient {
  if (credentials.kind === "service_account_key") {
    return new JWT({
      email: credentials.clientEmail,
      key: credentials.privateKey,
      scopes: DRIVE_SCOPES,
    });
  }
  const { projectNumber, poolId, providerId, serviceAccountEmail } = credentials;
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    scopes: DRIVE_SCOPES,
  });
  if (!client) throw new Error("Could not create the Workload Identity Federation client.");
  return client;
}
