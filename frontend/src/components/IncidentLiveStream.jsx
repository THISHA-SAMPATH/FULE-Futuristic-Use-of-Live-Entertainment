import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Activity, Camera, Mic, Radio, WifiOff } from 'lucide-react';
import { API_URL } from '../config.js';

function drawTestPattern(canvas) {
  const context = canvas.getContext('2d'); let frame = 0; let stopped = false;
  const paint = () => {
    if (stopped) return;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#0F1B33'); gradient.addColorStop(1, '#172544');
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#F6EFE3'; context.font = '600 20px sans-serif'; context.fillText('FULE · SIMULATED TEST FEED', 18, 34);
    context.fillStyle = '#FF7A6B'; context.beginPath(); context.arc(80 + Math.sin(frame / 30) * 25, 82, 16, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#A9B4C9'; context.font = '14px sans-serif'; context.fillText('No camera or live connection required', 18, 126);
    frame += 1; requestAnimationFrame(paint);
  };
  paint();
  return () => { stopped = true; };
}

const IncidentLiveStream = forwardRef(function IncidentLiveStream({ incident, streamerId, streamerToken, accountAccessToken = '', guardianToken = '', role = 'streamer', autoStart = false, compact = false }, ref) {
  const [status, setStatus] = useState('idle');
  const [quality, setQuality] = useState('unknown');
  const [audioOnly, setAudioOnly] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [message, setMessage] = useState('Stream unavailable until a circle member joins.');
  const [remoteVideo, setRemoteVideo] = useState(null);
  const [remoteAudio, setRemoteAudio] = useState(null);
  const [viewerGrant, setViewerGrant] = useState(null);
  const roomRef = useRef(null);
  const connectingIncidentRef = useRef(null);
  const mediaRef = useRef(null);
  const canvasRef = useRef(null);
  const isPublisher = role === 'streamer';
  const incidentOpen = Boolean(incident && incident.dispatch_stage !== 'STAND_DOWN' && ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status));

  const startCapture = async () => {
    if (mediaRef.current || import.meta.env.VITE_DEMO_MODE === 'true') return true;
    if (!navigator.mediaDevices?.getUserMedia) { setAudioOnly(true); setMessage('Camera unavailable. You can still send audio.'); return false; }
    const { createLocalTracks, VideoPresets } = await import('livekit-client');
    try {
      const tracks = await createLocalTracks({ audio: { echoCancellation: true, noiseSuppression: true }, video: { facingMode: { ideal: 'environment' }, resolution: VideoPresets.h480.resolution } });
      mediaRef.current = tracks;
      return true;
    } catch {
      try { mediaRef.current = await createLocalTracks({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); setAudioOnly(true); setMessage('Low bandwidth or camera unavailable. Audio-only mode is active.'); return true; }
      catch { setAudioOnly(true); setMessage('Microphone and camera unavailable. SOS and guardian response remain active.'); return false; }
    }
  };

  useImperativeHandle(ref, () => ({ startCapture }));

  useEffect(() => {
    if (!incidentOpen || (!autoStart && !viewerGrant) || connectingIncidentRef.current === incident.incident_id) return undefined;
    connectingIncidentRef.current = incident.incident_id;
    let cancelled = false;
    let stopPattern = null;
    const connect = async () => {
      setStatus('connecting'); setMessage('Connecting your private safety stream…');
      try {
        const { Room, RoomEvent, ConnectionQuality } = await import('livekit-client');
        let access = viewerGrant;
        if (!access) {
          const response = await fetch(`${API_URL}/api/incidents/${encodeURIComponent(incident.incident_id)}/stream-token`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(isPublisher ? { 'X-Streamer-Evidence-Token': streamerToken || '', ...(accountAccessToken ? { Authorization: `Bearer ${accountAccessToken}` } : {}) } : { Authorization: `Bearer ${guardianToken}` }) },
            body: JSON.stringify(isPublisher ? { streamer_id: streamerId } : {})
          });
          access = await response.json();
          if (!response.ok) throw new Error(access.error || 'Stream token unavailable.');
        }
        if (cancelled) return;
        setRecordingEnabled(Boolean(access.recording_enabled));
        if (access.mode === 'demo') {
          const canvas = canvasRef.current;
          if (canvas) { stopPattern = drawTestPattern(canvas); canvas.captureStream?.(8); }
          setStatus('live'); setQuality('simulated'); setMessage('You are live to your circle · simulated demo feed'); return;
        }
        const room = new Room({ adaptiveStream: true, dynacast: true }); roomRef.current = room;
        room.on(RoomEvent.ConnectionStateChanged, (state) => { if (state === 'connected') { setStatus('live'); setMessage(isPublisher ? 'You are live to your circle' : 'Private guardian stream connected'); } else if (state === 'reconnecting') { setStatus('reconnecting'); setMessage('Stream reconnecting…'); } else if (state === 'disconnected') { setStatus('unavailable'); setMessage('Stream unavailable. Acknowledge the alert or use emergency services.'); } });
        room.on(RoomEvent.ConnectionQualityChanged, (nextQuality, participant) => {
          if (isPublisher && participant.identity === room.localParticipant.identity && nextQuality === ConnectionQuality.Poor) {
            setAudioOnly(true); setMessage('Weak network detected. Switching to audio-only.');
            for (const publication of room.localParticipant.videoTrackPublications.values()) void publication.track?.mute();
          }
          setQuality(nextQuality);
        });
        room.on(RoomEvent.TrackSubscribed, (track) => {
          const element = track.attach();
          if (track.kind === 'video') setRemoteVideo(element);
          if (track.kind === 'audio') setRemoteAudio(element);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach(); if (track.kind === 'video') setRemoteVideo(null); if (track.kind === 'audio') setRemoteAudio(null); });
        room.on(RoomEvent.Disconnected, () => { setStatus('reconnecting'); setMessage('Connection interrupted. Reconnecting…'); });
        await room.connect(access.server_url, access.token, { autoSubscribe: !isPublisher });
        if (isPublisher) {
          const ready = mediaRef.current ? true : await startCapture();
          if (!ready) { setStatus('unavailable'); return; }
          for (const track of mediaRef.current || []) await room.localParticipant.publishTrack(track, {
            simulcast: false,
            ...(track.kind === 'video' ? { videoEncoding: { maxBitrate: 400_000, maxFramerate: 15 } } : {})
          });
          setStatus('live'); setMessage(audioOnly ? 'Audio-only safety stream is live to your circle' : 'You are live to your circle');
        }
      } catch (error) { setStatus('unavailable'); setMessage(error.message || 'Stream unavailable. Alert response is not affected.'); }
    };
    void connect();
    return () => {
      cancelled = true; stopPattern?.(); void roomRef.current?.disconnect(); roomRef.current = null;
      for (const track of mediaRef.current || []) track.stop?.(); mediaRef.current = null;
      connectingIncidentRef.current = null; setStatus('idle');
    };
  }, [incident?.incident_id, incident?.status, autoStart, viewerGrant, streamerId, streamerToken, accountAccessToken, guardianToken, isPublisher]);

  useEffect(() => { if (remoteVideo) { const host = document.getElementById(`livekit-video-${incident?.incident_id}`); host?.replaceChildren(remoteVideo); } }, [remoteVideo, incident?.incident_id]);
  useEffect(() => { if (remoteAudio) { remoteAudio.autoplay = true; document.body.append(remoteAudio); return () => remoteAudio.remove(); } }, [remoteAudio]);

  if (!incident) return <span className="stream-prepare-sentinel" aria-hidden="true"/>;
  return <section className={`incident-live-stream ${compact ? 'compact' : ''}`} aria-label="Private incident live stream">
    <div className="incident-live-stage">
      <canvas ref={canvasRef} width="320" height="180" aria-label="Simulated test stream" className={status === 'live' && import.meta.env.VITE_DEMO_MODE === 'true' ? 'simulated-visible' : 'simulated-hidden'}/>
      <div id={`livekit-video-${incident.incident_id}`} className="livekit-remote-video"/>
      {isPublisher && mediaRef.current?.find((track) => track.kind === 'video')?.attach && <LocalVideoTrack tracks={mediaRef.current} />}
      {status !== 'live' && <span className="stream-unavailable"><WifiOff size={18}/>{status === 'reconnecting' ? 'Reconnecting private stream…' : 'Stream unavailable · alert response remains active'}</span>}
    </div>
    <div className="incident-live-footer"><span><i className={status === 'live' ? 'is-live' : ''}/>{message}</span>{status === 'live' && <small><Activity size={12}/>{quality === 'simulated' ? 'Demo feed' : audioOnly ? 'Audio only' : `Connection ${quality}`}{isPublisher && quality !== 'simulated' ? ` · ${recordingEnabled ? 'recording evidence' : 'recording unavailable'}` : ''}</small>}</div>
    {isPublisher && ['idle', 'unavailable'].includes(status) && incidentOpen && <button type="button" className="stream-start-button" onClick={() => void startCapture()} aria-label="Prepare microphone and rear camera for a private live stream"><Camera size={15}/>{status === 'unavailable' ? 'Try private stream again' : 'Prepare private stream'}</button>}
    {!isPublisher && ['idle', 'unavailable'].includes(status) && <button type="button" className="stream-start-button" onClick={async () => {
      try {
        const response = await fetch(`${API_URL}/api/incidents/${encodeURIComponent(incident.incident_id)}/stream-token`, { method: 'POST', headers: { Authorization: `Bearer ${guardianToken}`, 'Content-Type': 'application/json' }, body: '{}' });
        const access = await response.json(); if (!response.ok) throw new Error(access.error || 'You must accept this response before joining.');
        setViewerGrant(access);
      } catch (error) { setMessage(error.message); setStatus('unavailable'); }
    }}><Radio size={15}/>Join private stream</button>}
    {status === 'connecting' && <span className="stream-connecting"><Mic size={13}/>Securing incident room…</span>}
  </section>;
});

function LocalVideoTrack({ tracks }) {
  const ref = useRef(null);
  useEffect(() => { const track = tracks.find((item) => item.kind === 'video'); if (track && ref.current) track.attach(ref.current); return () => track?.detach(ref.current); }, [tracks]);
  return <video ref={ref} autoPlay muted playsInline className="livekit-local-video" aria-label="Your private live camera feed"/>;
}

export default IncidentLiveStream;
