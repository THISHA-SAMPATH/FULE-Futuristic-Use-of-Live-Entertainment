import { randomBytes } from 'node:crypto';
import { addGuardianInvite } from '../services/guardianRegistry.js';

const guardianId = process.argv[2];
if (!guardianId) {
  console.error('Usage: node scripts/createGuardianInvite.js <guardian_id>');
  process.exit(1);
}

const inviteCode = randomBytes(24).toString('base64url');
try {
  addGuardianInvite({ guardianId, inviteCode });
  console.log(`Guardian invite created for ${guardianId}. Store this code securely; it is shown once:\n${inviteCode}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
