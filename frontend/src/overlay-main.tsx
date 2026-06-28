import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import OverlayApp from './components/OverlayApp'

const container = document.getElementById('overlay-root')!
createRoot(container).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)
