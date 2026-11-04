export function filterStreamsByCategory(streams, category) {
  const patterns = {
    'Women’s Safety': /safety|walk|women|together|check-in|nightline|guardian/i,
    'Night Commute': /train|night|walk|commute|last train/i,
    'Campus Watch': /campus|university|student/i,
    'Civic Alerts': /civic|community desk|public service/i,
    'Community Help': /community|guardian|support|together|check-in|walk/i,
  };
  const pattern = patterns[category];
  return pattern ? streams.filter((stream) => pattern.test(`${stream.title} ${stream.streamer} ${stream.region}`)) : streams;
}

export function filterGuardiansBySearch(guardians, search) {
  const query = String(search || '').trim().toLowerCase();
  return query ? guardians.filter((guardian) => [guardian.name, guardian.id].some((value) => value.toLowerCase().includes(query))) : guardians;
}
