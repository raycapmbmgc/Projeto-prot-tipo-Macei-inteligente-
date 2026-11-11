import {createRoot} from 'react-dom/client';
import App from './App';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './original.css';
import './layout.css';

createRoot(document.getElementById('root')!).render(<App/>);
if('serviceWorker' in navigator && !import.meta.env.DEV) navigator.serviceWorker.register('/sw.js').catch(()=>{});
