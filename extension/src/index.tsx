import React from 'react';
import ReactDOM from 'react-dom/client';
import { connectExtensionHost } from '@looker/extension-sdk';
import { App } from './App';
import { PUBLIC_PATH } from './config';

// Declare Webpack dynamic public path variable
declare global {
  let __webpack_public_path__: string;
}

// Override publicPath at runtime for loading lazy chunks
if (typeof PUBLIC_PATH !== 'undefined' && PUBLIC_PATH) {
  __webpack_public_path__ = PUBLIC_PATH;
}

// Create a container element dynamically since Looker runs the bundle in an empty iframe body
const container = document.createElement('div');
container.id = 'extension-root';
document.body.appendChild(container);

// Apply base styles to body for layout consistency
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.boxSizing = 'border-box';

connectExtensionHost()
  .then((extensionSDK) => {
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App extensionSDK={extensionSDK} />
      </React.StrictMode>
    );
  })
  .catch((error) => {
    console.error('Failed to connect to Looker extension host:', error);
    // Render a fallback error UI
    const root = ReactDOM.createRoot(container);
    root.render(
      <div style={{ padding: '24px', fontFamily: 'sans-serif', color: '#c53929' }}>
        <h3>Connection Error</h3>
        <p>Failed to establish a connection with the Looker parent window. Make sure this extension is loaded inside Looker.</p>
      </div>
    );
  });
