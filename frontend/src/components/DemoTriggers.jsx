import { useState } from 'react';
import { MessageCircle, Radio, Siren, TicketCheck } from 'lucide-react';

const SCENARIOS = {
  night: { label: 'Walking alone at night', transcript: 'I am walking alone at night and someone is following me. Please help.' },
  transit: { label: 'Harassment on transit', transcript: 'Someone is harassing me on public transit and I feel unsafe. Please help.' },
  campus: { label: 'Campus emergency', transcript: 'Emergency on campus. I am being threatened and need help now.' }
};

export default function DemoTriggers({ onTrigger, disabled, sending }) {
  const [scenario, setScenario] = useState('night');
  const [transcript, setTranscript] = useState(SCENARIOS.night.transcript);
  const run = (source) => onTrigger(source, transcript);

  return <section className="demo-triggers" aria-labelledby="demo-triggers-title">
    <div className="demo-triggers-heading"><div><span className="demo-mode-badge">DEMO MODE</span><h2 id="demo-triggers-title">Demo Triggers</h2></div><span className="demo-identity">Demo Streamer · simulated coordinates</span></div>
    <div className="demo-scenario-row"><label htmlFor="demo-scenario">Scenario</label><select id="demo-scenario" value={scenario} onChange={(event) => { const next = event.target.value; setScenario(next); setTranscript(SCENARIOS[next].transcript); }}>{Object.entries(SCENARIOS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></div>
    <label className="demo-transcript-label" htmlFor="demo-transcript">Incident transcript</label>
    <textarea id="demo-transcript" rows="3" maxLength="1000" value={transcript} onChange={(event) => setTranscript(event.target.value)} />
    <div className="demo-trigger-actions">
      <button type="button" onClick={() => run('button')} disabled={disabled || sending} aria-label="Run demo Button SOS"><Siren size={15}/>Button SOS</button>
      <button type="button" onClick={() => run('chat')} disabled={disabled || sending} aria-label="Run demo !sos chat trigger"><MessageCircle size={15}/>!sos chat</button>
      <button type="button" onClick={() => run('redeem')} disabled={disabled || sending} aria-label="Run demo Silent SOS redeem"><TicketCheck size={15}/>Silent SOS redeem</button>
    </div>
    <p><Radio size={13}/> Simulated only. No Twitch message, reward, or emergency service is contacted.</p>
  </section>;
}
