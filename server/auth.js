import { timingSafeEqual } from 'node:crypto';

// HTTP Basic Auth over the whole app. Enabled only when REV_TRACKER_PASSWORD is
// set — so local `npm run dev` stays open, while the deployed container (which
// sets the env var) is gated. Username defaults to `acko`, overridable.
export function basicAuth() {
  const password = process.env.REV_TRACKER_PASSWORD || '';
  const username = process.env.REV_TRACKER_USER || 'acko';

  if (!password) {
    console.log('[auth] REV_TRACKER_PASSWORD unset — auth disabled (dev mode)');
    return (_req, _res, next) => next();
  }
  console.log(`[auth] Basic auth enabled for user "${username}"`);

  const expectUser = Buffer.from(username);
  const expectPass = Buffer.from(password);

  // constant-time compare that also resists length leakage
  const safeEqual = (a, b) => {
    const bufA = Buffer.from(a);
    if (bufA.length !== b.length) {
      timingSafeEqual(b, b); // keep timing uniform
      return false;
    }
    return timingSafeEqual(bufA, b);
  };

  return (req, res, next) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const user = decoded.slice(0, i);
      const pass = decoded.slice(i + 1);
      if (safeEqual(user, expectUser) && safeEqual(pass, expectPass)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Revenue Tracker", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  };
}
