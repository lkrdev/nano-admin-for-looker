// This file retrieves values injected via Webpack's DefinePlugin during deployment.
declare const process: any;

export const BACKEND_URL = process.env.BACKEND_URL || '';
export const PUBLIC_PATH = process.env.PUBLIC_PATH || '';
export const BUILD_HASH = process.env.BUILD_HASH || '';
export const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || '';
export const INSTANCE_AUTH_MODES = process.env.INSTANCE_AUTH_MODES || '';
export const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'nano_admin_oauth_client';
