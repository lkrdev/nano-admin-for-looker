import {
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope } from '../scope';

export async function getUserCredentialsAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const sdk = context.sdk;
  const user = await sdk.ok(sdk.user(targetUserId));

  let emailCreds: any = user?.credentials_email || null;
  if (!emailCreds && typeof sdk.user_credentials_email === 'function') {
    try {
      emailCreds = await sdk.ok(sdk.user_credentials_email(targetUserId));
    } catch (err) {
      emailCreds = null;
    }
  }

  let totpCreds: any = user?.credentials_totp || null;
  if (!totpCreds && typeof sdk.user_credentials_totp === 'function') {
    try {
      totpCreds = await sdk.ok(sdk.user_credentials_totp(targetUserId));
    } catch (err) {
      totpCreds = null;
    }
  }

  let sessions: any[] = [];
  if (typeof sdk.all_user_sessions === 'function') {
    try {
      sessions = await sdk.ok(sdk.all_user_sessions(targetUserId));
    } catch (err) {
      sessions = [];
    }
  }

  const ssoTypes: string[] = [];
  if (user?.credentials_saml) ssoTypes.push('SAML');
  if (user?.credentials_oidc) ssoTypes.push('OIDC');
  if (user?.credentials_google) ssoTypes.push('Google');
  if (user?.credentials_ldap) ssoTypes.push('LDAP');
  if (user?.credentials_looker_openid) ssoTypes.push('Looker OpenID');

  return {
    user_id: targetUserId,
    capabilities: params.credentials,
    email_credentials: emailCreds
      ? {
          email: emailCreds.email || user?.email || '',
          created_at: emailCreds.created_at || null,
          logged_in_at: emailCreds.logged_in_at || null,
          is_disabled: Boolean(emailCreds.is_disabled),
          forced_password_reset_at_next_login: Boolean(emailCreds.forced_password_reset_at_next_login)
        }
      : null,
    has_totp: Boolean(totpCreds && (totpCreds.id || totpCreds.created_at || totpCreds.is_disabled !== undefined)),
    totp_info: totpCreds
      ? {
          created_at: totpCreds.created_at || null,
          is_disabled: Boolean(totpCreds.is_disabled)
        }
      : null,
    sso_providers: ssoTypes,
    sessions: (sessions || []).map((s: any) => ({
      id: String(s.id),
      ip_address: s.ip_address || '',
      browser: s.browser || '',
      operating_system: s.operating_system || '',
      city: s.city || '',
      country: s.country || '',
      credentials_type: s.credentials_type || '',
      created_at: s.created_at || ''
    }))
  };
}

export async function sendPasswordResetAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.credentials.allow_password_reset) {
    throw new Error('403 Forbidden: Sending password reset emails is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  // Strictly use send_user_credentials_email_password_reset and never return any reset URL to the browser
  await context.sdk.ok(context.sdk.send_user_credentials_email_password_reset(targetUserId));

  return {
    success: true,
    user_id: targetUserId,
    message: `Password reset email sent to user ${targetUserId}'s registered email address.`
  };
}

export async function createEmailCredentialsAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.credentials.allow_email_credentials) {
    throw new Error('403 Forbidden: Managing email credentials is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const user = await context.sdk.ok(context.sdk.user(targetUserId));
  const existingEmail = String(user?.email || '').trim();
  const requestedEmail = String(payload?.email || existingEmail).trim();

  if (!requestedEmail) {
    throw new Error('An email address is required to create email credentials.');
  }

  if (
    existingEmail &&
    existingEmail.toLowerCase() !== requestedEmail.toLowerCase() &&
    !params.profile.allow_update_email
  ) {
    throw new Error(
      '403 Forbidden: Changing an existing user\'s email address is not permitted for this workflow.'
    );
  }

  await context.sdk.ok(
    context.sdk.create_user_credentials_email(targetUserId, { email: requestedEmail })
  );

  return {
    success: true,
    user_id: targetUserId,
    email: requestedEmail,
    message: `Created email credentials for user ${targetUserId}.`
  };
}

export async function deleteEmailCredentialsAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.credentials.allow_email_credentials) {
    throw new Error('403 Forbidden: Managing email credentials is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  await context.sdk.ok(context.sdk.delete_user_credentials_email(targetUserId));

  return {
    success: true,
    user_id: targetUserId,
    message: `Deleted email credentials for user ${targetUserId}.`
  };
}

export async function resetTotpAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.credentials.allow_totp_reset) {
    throw new Error('403 Forbidden: Resetting 2FA/TOTP is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  await context.sdk.ok(context.sdk.delete_user_credentials_totp(targetUserId));

  return {
    success: true,
    user_id: targetUserId,
    message: `Reset 2FA/TOTP credentials for user ${targetUserId}.`
  };
}

export async function revokeSessionAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.credentials.allow_session_revoke) {
    throw new Error('403 Forbidden: Revoking user sessions is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const sessionId = String(payload?.session_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!sessionId) {
    throw new Error('session_id is required.');
  }

  await context.sdk.ok(context.sdk.delete_user_session(targetUserId, sessionId));

  return {
    success: true,
    user_id: targetUserId,
    session_id: sessionId,
    message: `Revoked session ${sessionId} for user ${targetUserId}.`
  };
}
