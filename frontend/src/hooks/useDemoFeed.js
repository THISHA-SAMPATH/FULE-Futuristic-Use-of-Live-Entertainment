import { useEffect, useState } from 'react';
import { createDemoIncident } from '../demo/seedData.js';

export default function useDemoFeed(enabled) {
  const [incidents, setIncidents] = useState(() => enabled ? [createDemoIncident()] : []);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!enabled) { setIncidents([]); return undefined; }
    setIncidents([createDemoIncident(cycle)]);
    const loop = window.setInterval(() => setCycle((value) => value + 1), 32_000);
    return () => window.clearInterval(loop);
  }, [enabled, cycle]);
  return incidents;
}
