import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import App from './App'
import './styles/global.css'

/* One MotionConfig at the root: every animation in the product honours the
   reader's reduced-motion preference because it is set once, here, rather than
   remembered in each component. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
