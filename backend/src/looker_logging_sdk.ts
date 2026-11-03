import crypto from 'crypto';
import { LookerNodeSDK } from '@looker/sdk-node';

type RawLookerSDK = ReturnType<typeof LookerNodeSDK.init40>;

export interface SDKLoggingContext {
  instanceHost?: string;
  userId?: string;
  workflowId?: string;
  action?: string;
}

/**
 * Restricted Looker SDK interface for the Nano Admin backend.
 * Omits `update_session` at compile time and blocks workspace mutations at runtime
 * so the shared backend Service Account session can never be switched to the 'dev' workspace.
 */
export type LookerBackendSDK = Omit<RawLookerSDK, 'update_session'> & {
  _isLoggingProxy?: boolean;
  _loggingContext?: SDKLoggingContext;
  _rawTarget?: any;
  [key: string]: any;
};

/**
 * Formats an instance hostname for compact log output (max 16 chars).
 * If longer than 16 characters, uses the first 12 characters followed by a 4-char SHA-256 hex digest.
 */
export function formatHostForLog(host: string): string {
  const clean = (host || '').trim().toLowerCase();
  if (clean.length <= 16) {
    return clean;
  }
  const hash4 = crypto.createHash('sha256').update(clean).digest('hex').substring(0, 4);
  return `${clean.substring(0, 12)}${hash4}`;
}

export function initLookerBackendSDK(settings?: any, contextInfo?: SDKLoggingContext): LookerBackendSDK {
  const rawSdk = LookerNodeSDK.init40(settings);
  return wrapLookerSDKWithLogging(rawSdk, contextInfo);
}

function formatResultSummary(res: any): string {
  if (res === null || res === undefined) {
    return 'null';
  }

  if (Array.isArray(res)) {
    return `[Array of ${res.length} item(s)]`;
  }

  if (typeof res === 'object') {
    const idVal = res.id ?? res.name ?? res.user_id ?? res.group_id ?? res.role_id;
    if (idVal !== undefined && idVal !== null) {
      return `[Object id: "${idVal}"]`;
    }
    if (Array.isArray(res.data)) {
      return `[Object data: ${res.data.length} item(s)]`;
    }
    const keys = Object.keys(res);
    return `[Object keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}]`;
  }

  if (typeof res === 'string') {
    if (res.length > 100) {
      return `[String (${res.length} chars)]`;
    }
    return `"${res}"`;
  }

  return String(res);
}

export function wrapLookerSDKWithLogging(sdk: any, contextInfo?: SDKLoggingContext): LookerBackendSDK {
  if (!sdk || typeof sdk !== 'object') {
    return sdk;
  }

  const rawTarget = sdk._isLoggingProxy && sdk._rawTarget ? sdk._rawTarget : sdk;
  const loggingContext: SDKLoggingContext = {
    ...(sdk._loggingContext || {}),
    ...(contextInfo || {})
  };

  return new Proxy(rawTarget, {
    get(target, prop, receiver) {
      if (prop === '_isLoggingProxy') {
        return true;
      }
      if (prop === '_loggingContext') {
        return loggingContext;
      }
      if (prop === '_rawTarget') {
        return rawTarget;
      }

      if (prop === 'update_session') {
        return function () {
          throw new Error(
            'Security Violation: Calling update_session or switching the backend Looker SDK session to the "dev" workspace is strictly forbidden.'
          );
        };
      }

      const orig = Reflect.get(target, prop, receiver);

      if (typeof orig === 'function') {
        return function (...args: any[]) {
          const propName = String(prop);

          if (
            (propName === 'patch' || propName === 'put') &&
            typeof args[0] === 'string' &&
            args[0].includes('/session')
          ) {
            throw new Error(
              'Security Violation: Mutating the backend Looker SDK session workspace is strictly forbidden.'
            );
          }

          const start = Date.now();

          const ctxParts: string[] = [];
          if (loggingContext.instanceHost) ctxParts.push(`host:${formatHostForLog(loggingContext.instanceHost)}`);
          if (loggingContext.userId) ctxParts.push(`user:${loggingContext.userId}`);
          if (loggingContext.workflowId) ctxParts.push(`workflow:${loggingContext.workflowId}`);
          if (loggingContext.action) ctxParts.push(`action:${loggingContext.action}`);
          const contextTag = ctxParts.length > 0 ? `[${ctxParts.join(' ')}] ` : '';
          const tag = `[Looker SDK API] sdk.${propName}`;

          let argsSummary = '';
          try {
            argsSummary = JSON.stringify(args, (key, value) => {
              if (typeof value === 'string' && value.length > 150) {
                return value.substring(0, 150) + '...[truncated]';
              }
              return value;
            });
          } catch {
            argsSummary = '[Unserializable Args]';
          }

          console.log(`${tag} CALL ${contextTag}Params: ${argsSummary}`);

          let result: any;
          try {
            result = orig.apply(target, args);
          } catch (err: any) {
            const duration = Date.now() - start;
            console.error(`${tag} ERROR (${duration}ms) ${contextTag}Error:`, err.message || err);
            throw err;
          }

          if (result && typeof result.then === 'function') {
            return result
              .then((res: any) => {
                const duration = Date.now() - start;
                const summary = formatResultSummary(res);
                console.log(`${tag} SUCCESS (${duration}ms) ${contextTag}Result: ${summary}`);
                return res;
              })
              .catch((err: any) => {
                const duration = Date.now() - start;
                console.error(`${tag} ERROR (${duration}ms) ${contextTag}Error:`, err.message || err);
                throw err;
              });
          }

          const duration = Date.now() - start;
          const summary = formatResultSummary(result);
          console.log(`${tag} SUCCESS (${duration}ms) ${contextTag}Result: ${summary}`);
          return result;
        };
      }

      return orig;
    }
  });
}
