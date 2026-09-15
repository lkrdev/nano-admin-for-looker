export interface SDKLoggingContext {
  userId?: string;
  workflowId?: string;
  action?: string;
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

export function wrapLookerSDKWithLogging(sdk: any, contextInfo?: SDKLoggingContext): any {
  if (!sdk || typeof sdk !== 'object') {
    return sdk;
  }

  if (sdk._isLoggingProxy) {
    if (contextInfo) {
      if (contextInfo.workflowId) sdk._loggingContext.workflowId = contextInfo.workflowId;
      if (contextInfo.userId) sdk._loggingContext.userId = contextInfo.userId;
      if (contextInfo.action) sdk._loggingContext.action = contextInfo.action;
    }
    return sdk;
  }

  const loggingContext: SDKLoggingContext = { ...contextInfo };

  return new Proxy(sdk, {
    get(target, prop, receiver) {
      if (prop === '_isLoggingProxy') {
        return true;
      }
      if (prop === '_loggingContext') {
        return loggingContext;
      }

      const orig = Reflect.get(target, prop, receiver);

      if (typeof orig === 'function') {
        return function (...args: any[]) {
          const propName = String(prop);
          const start = Date.now();

          const ctxParts: string[] = [];
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
