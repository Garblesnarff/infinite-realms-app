import type { WorkOS } from '@workos-inc/node';

export interface PasswordLoginResult {
  accessToken: string;
  refreshToken: string;
}

export async function authenticatePassword(
  email: string,
  password: string,
  clientId: string,
  client: Pick<WorkOS, 'userManagement'>,
): Promise<PasswordLoginResult> {
  const result = await client.userManagement.authenticateWithPassword({
    email,
    password,
    clientId,
  });
  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
}
