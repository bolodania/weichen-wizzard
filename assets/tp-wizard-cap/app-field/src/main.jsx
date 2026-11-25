import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
import '@ui5/webcomponents-base/dist/FontFace.css';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';

setTheme('sap_horizon');
document.body.classList.add('sapUiSizeCozy');
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
