import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './store.jsx'
import { I18nProvider } from './i18n.jsx'
import Nav from './components/Nav.jsx'
import PoMI from './pages/PoMI.jsx'
import Wallet from './pages/Wallet.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  return (
    <I18nProvider>
    <AppProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/"        element={<PoMI />} />
          <Route path="/wallet"  element={<Wallet />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
    </I18nProvider>
  )
}
