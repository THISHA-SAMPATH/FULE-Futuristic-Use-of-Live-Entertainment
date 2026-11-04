import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../config.js';

export default function EvidenceRecorder({ incident, streamerToken }) {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState(0);
  const startedForIncident = useRef('');
  const activeRef = useRef(false);
  activeRef.current = Boolean(incident && ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status));

  useEffect(() => {
    const active = incident && ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status);
    if (active && streamerToken && startedForIncident.current !== incident.incident_id && navigator.mediaDevices?.getUserMedia) {
      startedForIncident.current = incident.incident_id;
      void begin(false);
    }
    return () => {
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [incident?.incident_id, streamerToken]);

  useEffect(() => {
    if (incident && !['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status) && recorderRef.current?.state !== 'inactive') stop();
  }, [incident?.status]);

  async function begin(includeVideo) {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: includeVideo });
      if (!activeRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const formats = includeVideo ? ['video/webm;codecs=vp8,opus', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/webm'];
      const mimeType = formats.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser cannot record a supported evidence format.');
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = async (event) => {
        if (!event.data.size) return;
        try {
          const response = await fetch(`${API_URL}/api/incidents/${incident.incident_id}/evidence`, { method: 'POST', headers: { 'Content-Type': mimeType.split(';')[0], 'X-Streamer-Evidence-Token': streamerToken }, body: event.data });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Evidence upload failed.');
          setUploaded((count) => count + 1);
        } catch (uploadError) { setError(uploadError.message); }
      };
      recorder.start(10_000);
      setRecording(true);
    } catch (captureError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setError(captureError.message || 'Microphone/camera permission was not granted.');
    }
  }

  function stop() {
    if (recorderRef.current?.state && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }

  if (!incident || !streamerToken || !['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status)) return null;
  return <section className="evidence-capture" aria-label="Private evidence capture">
    <div><strong>Private evidence capture</strong><span>10-second encrypted-in-transit chunks · stored for verified case access</span></div>
    {recording ? <button type="button" onClick={stop}>Stop capture · {uploaded} uploaded</button> : <div className="evidence-actions"><button type="button" onClick={() => begin(false)}>Share audio chunks</button><button type="button" onClick={() => begin(true)}>Share audio + video</button></div>}
    {error && <small role="alert">{error}</small>}
    {!recording && uploaded === 0 && <small>Starts only after you grant microphone/camera access.</small>}
  </section>;
}
