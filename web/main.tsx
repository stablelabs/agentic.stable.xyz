import { hydrateRoot } from 'react-dom/client';
import App from './App';
import './style.css';
hydrateRoot(document.getElementById('root')!, <App />);
