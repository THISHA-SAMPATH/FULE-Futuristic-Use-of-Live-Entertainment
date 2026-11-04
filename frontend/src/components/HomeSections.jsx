import { ArrowRight, BookOpenCheck, HeartHandshake, ShieldCheck, UsersRound } from 'lucide-react';

const categories = [
  { title: 'Women’s Safety', count: '2.4k', guardians: 84, scene: 'poster-women', selected: true },
  { title: 'Night Commute', count: '1.8k', guardians: 62, scene: 'poster-night' },
  { title: 'Campus Watch', count: '980', guardians: 38, scene: 'poster-campus' },
  { title: 'Civic Alerts', count: '1.2k', guardians: 44, scene: 'poster-civic' },
  { title: 'Community Help', count: '3.1k', guardians: 106, scene: 'poster-help' },
];

export function SafetyCategories({ selected, onSelect }) {
  return <section className="home-section" id="categories" aria-labelledby="categories-title"><div className="home-section-heading"><div><span className="section-kicker">Find your community</span><h2 id="categories-title">Safety Categories</h2></div><a href="#communities">See all <ArrowRight size={14}/></a></div><div className="poster-row" role="list">{categories.map((item) => <button type="button" role="listitem" key={item.title} className={`poster-card ${item.scene} ${selected === item.title ? 'is-selected' : ''}`} onClick={() => onSelect(item.title)} aria-pressed={selected === item.title}><span className="poster-art" aria-hidden="true"><i className="poster-orb"/><i className="poster-line"/><i className="poster-figure"/></span><span className="poster-copy"><strong>{item.title}</strong><small><UsersRound size={13}/>{item.count} members <span>·</span><ShieldCheck size={13}/>{item.guardians}</small></span></button>)}</div></section>;
}

export function FeatureBanners() {
  return <section className="banner-row" aria-label="Community resources"><article className="feature-banner training-banner"><span className="banner-art" aria-hidden="true"><i/><i/><i/></span><div><span className="section-kicker">LEARN TO RESPOND</span><h2>Guardian Training</h2><p>Build confidence with short, practical safety lessons.</p><a href="#guardians">Explore training <ArrowRight size={14}/></a></div><BookOpenCheck className="banner-icon" size={24}/></article><article className="feature-banner tips-banner"><span className="banner-art" aria-hidden="true"><i/><i/><i/></span><div><span className="section-kicker">SMALL STEPS, MORE SAFETY</span><h2>Safety Tips</h2><p>Simple ideas for check-ins, commutes, and community care.</p><a href="#settings">Read safety tips <ArrowRight size={14}/></a></div><HeartHandshake className="banner-icon" size={24}/></article></section>;
}
