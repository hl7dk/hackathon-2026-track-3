import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PatientsApp from './PatientsApp.jsx';
import '../index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PatientsApp />
  </StrictMode>,
);
