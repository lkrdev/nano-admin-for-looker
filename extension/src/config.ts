// This file is auto-generated but now retrieves values injected via Webpack's DefinePlugin.
declare const process: any;

export const BACKEND_URL = typeof process !== 'undefined' && process.env && process.env.BACKEND_URL
  ? process.env.BACKEND_URL
  : 'http://localhost:8081';

export const PUBLIC_PATH = typeof process !== 'undefined' && process.env && process.env.PUBLIC_PATH
  ? process.env.PUBLIC_PATH
  : '';
