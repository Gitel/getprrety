import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Must load before the app renders: it initialises i18next synchronously.
import './lib/i18n'
import App from '../App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
