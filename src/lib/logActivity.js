import { api } from './api';
import { getLocation } from './location';

// Fire-and-forget. Never throws — activity logging is non-blocking.
export async function logActivity(event) {
  try {
    const location = await getLocation();
    await api.post('/api/activity', { event, location });
  } catch {
    // silent — don't interrupt the user flow
  }
}
