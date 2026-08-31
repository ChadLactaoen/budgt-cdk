export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

/**
 * CDK writes /config.json into the S3 bucket at deploy time, so the Cognito IDs are
 * never baked into the bundle and a pool change needs no rebuild.
 *
 * The dev server has no such file; supply VITE_USER_POOL_ID and
 * VITE_USER_POOL_CLIENT_ID in frontend/.env.local instead.
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch('/config.json');
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AppConfig>;
      if (parsed.userPoolId && parsed.userPoolClientId) {
        return {
          region: parsed.region ?? 'us-west-2',
          userPoolId: parsed.userPoolId,
          userPoolClientId: parsed.userPoolClientId,
        };
      }
    }
  } catch {
    // Fall through to env vars — the dev server serves index.html for unknown paths.
  }

  const env = import.meta.env;
  if (!env.VITE_USER_POOL_ID || !env.VITE_USER_POOL_CLIENT_ID) {
    throw new Error(
      'No /config.json and no VITE_USER_POOL_ID / VITE_USER_POOL_CLIENT_ID. ' +
        'Deploy the stack, or create frontend/.env.local for local development.',
    );
  }
  return {
    region: env.VITE_AWS_REGION ?? 'us-west-2',
    userPoolId: env.VITE_USER_POOL_ID,
    userPoolClientId: env.VITE_USER_POOL_CLIENT_ID,
  };
}
