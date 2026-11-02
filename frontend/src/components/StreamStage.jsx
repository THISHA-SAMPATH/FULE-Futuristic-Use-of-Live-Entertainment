import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';

export default function StreamStage({ streamUrl, active }) {
  const [streamError, setStreamError] = useState(false);
  const channel = streamUrl?.split('/').filter(Boolean).pop();
  const playerUrl = channel ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(window.location.hostname)}&muted=true` : null;
  useEffect(() => setStreamError(false), [playerUrl]);
  return <section className={`stream-card ${active ? 'emergency-active' : ''}`} aria-label="Guardian live stream">
    <div className="stream-card-head"><div><span className="eyebrow">FULE PROTECT · LIVE FEED</span><h1>{active ? 'Emergency stream' : 'Community stream'}</h1></div><span className={`stream-state ${active ? 'active' : ''}`}><i/>{active ? 'LIVE EMERGENCY' : 'AWAITING INCIDENT'}</span></div>
    <div className="stream-viewport">
      {playerUrl && !streamError ? <iframe src={playerUrl} title="Twitch guardian stream" allow="autoplay; fullscreen" allowFullScreen onError={() => setStreamError(true)}/> : <div className="stream-placeholder" role="status"><Radio size={28}/><strong>{streamError ? 'Stream could not be loaded' : 'No live stream available'}</strong><span>{streamError ? 'Check the channel connection and retry.' : 'A verified streamer feed appears here when an incident is active.'}</span></div>}
      {active && <div className="live-emergency-overlay"><span className="pulse-dot"/>LIVE EMERGENCY</div>}
    </div>
  </section>;
}
