import { MapPin, RadioTower } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

function markerOffset(value, index) {
  if (!value) return [24 + index * 17 % 57, 28 + index * 23 % 49];
  let hash = 0; for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return [17 + Math.abs(hash % 65), 17 + Math.abs((hash >> 3) % 65)];
}

export default function MapCard({ incidents, demoMode }) {
  const reduceMotion = useReducedMotion();
  const markers = (demoMode ? [{ incident_id: 'demo-map-a' }, { incident_id: 'demo-map-b' }, { incident_id: 'demo-map-c' }] : incidents).slice(0, 5);
  return <motion.section className="map-card" initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }} aria-label="Anonymized neighborhood incident map">
    <div className="map-card-heading"><div><span className="section-kicker"><RadioTower size={13}/>NEIGHBORHOOD VIEW</span><h2>Safety across the city</h2></div><span className="map-privacy"><MapPin size={13}/>Approximate only</span></div>
    <div className="city-map" role="img" aria-label={`${markers.length} anonymized neighborhood safety pulses. No precise locations are shown.`}>
      <svg className="map-roads" viewBox="0 0 700 340" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 52 C120 92 161 15 280 62 S473 135 723 60M-30 166 C115 127 231 214 345 165 S568 111 720 176M-10 293 C136 234 205 317 321 276 S530 220 718 291M97 -20 C151 75 68 122 134 206 S196 271 180 360M315 -20 C264 69 366 115 318 204 S271 285 345 360M536 -20 C484 78 588 128 521 205 S484 284 554 360"/><path className="road-highlight" d="M-10 225 C144 199 203 120 351 194 S545 249 716 116M220 -12 C208 94 439 124 405 224 S354 305 434 352"/></svg>
      <span className="map-district district-north">North Loop</span><span className="map-district district-west">West End</span><span className="map-district district-center">Central</span><span className="map-district district-east">East Ward</span>
      {markers.map((item, index) => { const [x, y] = markerOffset(item.incident_id, index); return <span className={`map-pulse map-pulse-${index % 3}`} key={item.incident_id} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true"><i/></span>; })}
      <span className="map-privacy-note">Neighborhood level only</span>
    </div>
  </motion.section>;
}
