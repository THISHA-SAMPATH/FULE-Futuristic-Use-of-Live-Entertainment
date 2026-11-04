import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import DispatchConsole from './components/DispatchConsole.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{window.location.pathname === '/dispatch' ? <DispatchConsole/> : <App />}</React.StrictMode>
);
