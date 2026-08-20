import { useEffect, useState } from 'react';

// Reactively track a CSS media query. Used to swap the Scheduled table for a
// stacked card layout on narrow screens (one source of data, no duplicate DOM).
export default function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
