import { useMemo } from 'react';
import { ArrowRight, Radio, UsersRound } from 'lucide-react';
import StreamCard from './StreamCard.jsx';
import GuardianCard from './GuardianCard.jsx';
import { DEMO_GUARDIANS, DEMO_STREAMS } from '../demo/seedData.js';
import { filterGuardiansBySearch, filterStreamsByCategory } from '../communityFilters.js';

const CATEGORIES = ['Women’s Safety', 'Night Commute', 'Campus Watch', 'Civic Alerts', 'Community Help'];

export function CategoryChips({ selected, onSelect }) {
  return <nav className="category-chips" aria-label="Filter safety streams">{CATEGORIES.map((category) => <button key={category} className={selected === category ? 'active' : ''} aria-pressed={selected === category} onClick={() => onSelect(category)}>{category}</button>)}</nav>;
}

function SectionTitle({ eyebrow, title, detail, href }) {
  return <div className="section-heading"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{href && <a href={href} aria-label={`See all ${title}`}>SEE ALL <ArrowRight size={14}/></a>}</div>;
}

export function LiveStreamsSection({ demoMode, incidents, search, category }) {
  const streams = useMemo(() => {
    const query = search.trim().toLowerCase();
    const data = demoMode ? DEMO_STREAMS.filter((stream) => !query || [stream.title, stream.streamer, stream.region].some((item) => item.toLowerCase().includes(query))) : [];
    return demoMode ? filterStreamsByCategory(data, category) : data;
  }, [demoMode, incidents, search, category]);
  return <section className="content-section" id="streams"><SectionTitle eyebrow="Live now" title="Live safety streams" detail={demoMode ? 'Neighbors checking in and sharing the way home' : 'Private incident streams are shared only with authorized responders'} href="#streams"/><div className="stream-grid" aria-live="polite">{streams.length ? streams.map((stream, index) => <StreamCard key={stream.id} stream={stream} index={index} demoMode={demoMode}/>) : <div className="section-empty"><Radio size={19}/><strong>{search ? 'No streams match your search' : 'No live safety streams yet'}</strong><span>{demoMode ? 'Try another neighborhood or category.' : 'A private feed appears for accepted guardians during an active incident.'}</span></div>}</div></section>;
}

export function TopGuardiansSection({ demoMode, search = '', title = 'Top Guardians' }) {
  const guardians = useMemo(() => filterGuardiansBySearch(DEMO_GUARDIANS, search), [search]);
  return <section className="content-section" id="guardian-directory"><SectionTitle eyebrow="People who show up" title={title} detail={demoMode ? 'Verified responders around the city' : 'Responder presence from the live network'} href="#guardian-directory"/>
    {demoMode ? guardians.length ? <div className="guardian-grid" id="community">{guardians.map((guardian, index) => <GuardianCard key={guardian.id} guardian={guardian} index={index}/>)}</div> : <div className="section-empty slim"><UsersRound size={18}/><strong>No guardians match your search</strong></div> : <div className="section-empty slim" id="community"><UsersRound size={18}/><strong>Guardian directory unavailable</strong><span>The live socket currently reports your verified connection only.</span></div>}
  </section>;
}
