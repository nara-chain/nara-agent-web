import { NavLink } from 'react-router-dom'
import { useApp } from '../store.jsx'
import { useI18n } from '../i18n.jsx'
import './Nav.css'

const IconMine    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
const IconWallet  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
const IconSettings = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>

export default function Nav() {
  const { wallet, modelOk } = useApp()
  const { t } = useI18n()

  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-brand">
          <span className="nav-logo">N</span>
          <span className="nav-name">NARA</span>
        </div>

        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconMine />
            <span>{t('nav.pomi')}</span>
          </NavLink>
          <NavLink to="/wallet" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconWallet />
            <span>{t('nav.wallet')}</span>
            {!wallet && <span className="nav-dot nav-dot-warn" />}
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconSettings />
            <span>{t('nav.settings')}</span>
            {!modelOk && <span className="nav-dot nav-dot-warn" />}
          </NavLink>
        </div>
      </div>
    </nav>
  )
}
