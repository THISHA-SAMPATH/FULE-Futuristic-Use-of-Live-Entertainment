import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import DispatchConsole from './components/DispatchConsole.jsx';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import './styles.css';
import './professionalTheme.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{window.location.pathname === '/dispatch' ? <DispatchConsole/> : <App />}</React.StrictMode>
);
