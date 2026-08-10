// This file retrieves values injected via Webpack's DefinePlugin during deployment.
declare const process: any;

export const BACKEND_URL = process.env.BACKEND_URL || '';
export const PUBLIC_PATH = process.env.PUBLIC_PATH || '';
