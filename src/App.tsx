/**
 * @file src/App.tsx
 * @description Root SPA entry wrapper re-exporting the canonical `@kartik/frontend` React 19 application
 * and registering the bundled Firebase Web Auth Google Popup handler.
 */

import './lib/firebase.ts';

export { App, default } from '../frontend/src/App.js';
