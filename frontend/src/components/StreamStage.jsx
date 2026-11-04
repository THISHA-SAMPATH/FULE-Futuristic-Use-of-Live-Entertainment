import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { twitchPlayerUrl } from '../streamAccess.js';

export default function StreamStage({ streamUrl, active, guardianVerified = false }) {
  const [streamError, setStreamError] = useState(false);
  const canEmbed = guardianVerified && active;
  const playerUrl = canEmbed ? twitchPlayerUrl(streamUrl, window.location.hostname) : null;
  useEffect(() => setStreamError(false), [playerUrl]);
  return <section className={`stream-card ${canEmbed ? 'emergency-active' : ''}`} aria-label="Guardian live stream">
    <div className="stream-card-head"><div><span className="eyebrow">FULE PROTECT · LIVE FEED</span><h1>{canEmbed ? 'Emergency stream' : 'Guardian stream access'}</h1></div><span className={`stream-state ${canEmbed ? 'active' : ''}`}><i/>{canEmbed ? 'LIVE EMERGENCY' : 'AWAITING VERIFIED GUARDIAN'}</span></div>
    <div className="stream-viewport">
      {playerUrl && !streamError ? <iframe src={playerUrl} title="Twitch guardian stream" allow="autoplay; fullscreen" allowFullScreen onError={() => setStreamError(true)}/> : <div className="stream-placeholder" role="status"><Radio size={28}/><strong>{streamError ? 'Stream could not be loaded' : 'No live stream available'}</strong><span>{streamError ? 'Check the channel connection and retry.' : 'A verified streamer feed appears here when an incident is active.'}</span></div>}
      {canEmbed && <div className="live-emergency-overlay"><span className="pulse-dot"/>LIVE EMERGENCY</div>}
    </div>
  </section>;
}
