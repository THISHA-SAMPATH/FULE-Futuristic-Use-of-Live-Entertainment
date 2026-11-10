import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(dirname(fileURLToPath(import.meta.url)), 'triage_scenarios.json');
const groups = [
  {
    category: 'explicit_help', expected: 'CRITICAL', source: 'button', risk: 'standard',
    texts: [
      'Help me now, someone is following me.', 'I am being attacked; please send help.',
      'A person threatened me with a knife.', 'I am trapped and cannot get away.',
      'Someone is hurting me right now.', 'I am being followed and feel unsafe.',
      'There is a weapon here; call for help.', 'I was assaulted near the station.',
      'They will not leave and I am scared.', 'Help, I cannot get away from them.',
      'Someone threatened to hurt me tonight.', 'I am trapped in the stairwell with them.',
      'I am being harassed and followed home.', 'Please help me now; I am in danger.',
      'An attacker is outside and will not leave.', 'I am scared, they have a gun.',
      'Someone is stalking me and is here now.', 'I am being hurt; this is an emergency.',
      'I cannot leave and need someone immediately.', 'They are following me and I need help now.'
    ]
  },
  {
    category: 'missed_checkin', expected: 'ELEVATED', source: 'safe_walk_timeout', risk: 'standard',
    texts: Array(20).fill('')
  },
  {
    category: 'ambiguous', expected: 'LOW', source: 'chat', risk: 'standard',
    texts: [
      'It is a quiet walk and I am checking in.', 'I feel a little uncomfortable in this crowd.',
      'I might be lost; can someone confirm the route?', 'The street is unfamiliar but I am okay.',
      'I am concerned about the weather, not in danger.', 'Could someone stay online while I walk?',
      'This area feels strange, but I have a safe route.', 'I am alone and would like a quick check-in.',
      'I heard a noise and feel uncertain.', 'Everything is okay; I am just checking the app.',
      'The bus is late and I am waiting at the stop.', 'I am uncomfortable with how crowded this is.',
      'Can a guardian confirm this entrance is open?', 'I am taking a different route home tonight.',
      'I feel uneasy, but there is no immediate problem.', 'My phone battery is low; I am still safe.',
      'I am concerned that I missed my usual bus.', 'Please keep the check-in reminder active.',
      'I am alone at the station and waiting for my ride.', 'The path is dark; I am walking with a friend.'
    ]
  },
  {
    category: 'false_alarm', expected: 'LOW', source: 'button', risk: 'standard',
    texts: [
      'I pressed the button by mistake; I am safe.', 'False alarm, please close this test alert.',
      'I was testing the screen; no assistance needed.', 'I am safe and the trigger was accidental.',
      'Cancel this practice activation, everything is fine.', 'This was an accidental tap during setup.',
      'No emergency; I only wanted to inspect the button.', 'I am okay and this alert is not needed.',
      'The screen registered my touch while I was navigating.', 'I do not need help, this is a test.',
      'Please mark this as a drill; I am at home.', 'I accidentally started the demo flow.',
      'I am safe, please cancel the practice incident.', 'This is not an emergency; the button was tapped accidentally.',
      'I am fine and no one needs to respond.', 'Cancel the test alert, I am safe.',
      'I pressed SOS while exploring the interface.', 'This is a routine test with no danger.',
      'No assistance required; I am ending the demo.', 'I am safe; that was an accidental activation.'
    ]
  },
  {
    category: 'quiet_duress', expected: 'CRITICAL', source: 'duress_pin', risk: 'high',
    texts: Array(20).fill('')
  }
];

const scenarios = [];
for (const group of groups) {
  group.texts.forEach((text, index) => {
    const variation = index % 4;
    scenarios.push({
      scenario_id: `${group.category}-${String(index + 1).padStart(3, '0')}`,
      category: group.category,
      description: `${group.category.replaceAll('_', ' ')} synthetic case ${index + 1}`,
      input: {
        audio_transcript_snippet: text,
        source: group.source,
        local_hour: [1, 9, 17, 23][variation],
        risk_level: variation === 2 ? 'elevated' : group.risk
      },
      expected_threat_level: group.expected
    });
  });
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ dataset_version: '1.0.0', description: 'Synthetic, non-personal rule-triage evaluation cases.', scenario_count: scenarios.length, scenarios }, null, 2)}\n`);
console.log(`Wrote ${scenarios.length} versioned synthetic scenarios to ${output}`);
