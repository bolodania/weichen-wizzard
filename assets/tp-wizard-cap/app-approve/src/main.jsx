import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

setTheme('sap_horizon');
document.body.classList.add('sapUiSizeCompact'); // desktop: smaller spacing, 32px row height
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
