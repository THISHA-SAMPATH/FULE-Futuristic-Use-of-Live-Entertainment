export default function FuleLogo({ compact = false }) {
  return <span className={`fule-lockup ${compact ? 'is-compact' : ''}`} aria-label="Fule">
    <svg className="fule-logo-mark" viewBox="0 0 48 48" role="img" aria-hidden="true">
      <path d="M24 3.5c-9.2 0-16.7 7.4-16.7 16.6 0 11.2 13.1 22 15.4 23.8a2.1 2.1 0 0 0 2.6 0c2.3-1.8 15.4-12.6 15.4-23.8C40.7 10.9 33.2 3.5 24 3.5Z" fill="currentColor"/>
      <path d="M15 21.2a9.7 9.7 0 0 1 18 0M18.4 22a6.1 6.1 0 0 1 11.2 0" fill="none" stroke="#F6EFE3" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="24" cy="26.2" r="2.3" fill="#FF7A6B"/>
    </svg>
    {!compact && <span className="fule-wordmark">Fule</span>}
  </span>;
}
