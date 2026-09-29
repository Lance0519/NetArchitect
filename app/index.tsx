/**
 * Entry redirect.
 *
 * The tab group is the app, so `/` goes straight to Home. `<Redirect>` rather than
 * `useEffect` + `router.replace`, because the effect version renders the previous
 * route for one frame first - visible as a flash of nothing, and worse on web
 * where it briefly shows the wrong URL before replacing it.
 */

import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/(tabs)" />;
}
