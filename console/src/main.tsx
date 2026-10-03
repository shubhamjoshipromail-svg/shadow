import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Home from './pages/Home'
import Console from './pages/Console'
import MapPage from './pages/MapPage'
import ProofPage from './pages/ProofPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:sid" element={<Console />} />
        <Route path="/s/:sid/map" element={<MapPage />} />
        <Route path="/s/:sid/proof" element={<ProofPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
