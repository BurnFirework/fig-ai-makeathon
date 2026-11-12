import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/great-vibes/400.css'
import '@fontsource/caveat/500.css'
import './index.css'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(<React.StrictMode><App/></React.StrictMode>)
