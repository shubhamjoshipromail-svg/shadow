import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Home from './pages/Home'
import Console from './pages/Console'
import MapPage from './pages/MapPage'
import ProofPage from './pages/ProofPage'
import DataPage from './pages/DataPage'
import AgentPage from './pages/AgentPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:sid" element={<Console />} />
        <Route path="/s/:sid/map" element={<MapPage />} />
        <Route path="/s/:sid/proof" element={<ProofPage />} />
        <Route path="/s/:sid/data" element={<DataPage />} />
        <Route path="/s/:sid/agent" element={<AgentPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
