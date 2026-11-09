// Live Google rating and reviews through the Maps JavaScript API (Places). Needs VITE_GOOGLE_MAPS_KEY,
// restricted to the site's domains. Without it the page keeps the static rating link.

const KEY = (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_MAPS_KEY;
const QUERY = 'Jonučių gėlės, Artojų g. 12, Teleičiai';
const MIN_STARS = 4;
const MAX_SHOWN = 3;

interface GReview {
  rating: number | null;
  text: string | null;
  originalText?: string | null;
  relativePublishTimeDescription: string | null;
  googleMapsURI?: string | null;
  authorAttribution: { displayName: string; uri: string | null } | null;
}
interface GPlace { rating: number | null; reviews: GReview[] | null; googleMapsURI: string | null }
type Win = Window & { google?: { maps: { importLibrary(n: string): Promise<{ Place: { searchByText(r: object): Promise<{ places: GPlace[] }> } }> } }; __gmReady?: () => void };

function loadMaps(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as Win;
    w.__gmReady = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY ?? '')}&loading=async&language=lt&callback=__gmReady`;
    s.async = true;
    s.onerror = () => reject(new Error('maps script'));
    document.head.append(s);
  });
}

export async function loadReviews(): Promise<void> {
  if (!KEY) return;
  try {
    await loadMaps();
    const { Place } = await (window as Win).google!.maps.importLibrary('places');
    const { places } = await Place.searchByText({ textQuery: QUERY, fields: ['rating', 'reviews', 'googleMapsURI'], language: 'lt', maxResultCount: 1 });
    const p = places[0];
    if (!p) return;
    if (p.rating) for (const el of document.querySelectorAll('[data-rating]')) el.textContent = p.rating.toFixed(1).replace('.', ',');
    const good = (p.reviews ?? []).filter((r) => (r.rating ?? 0) >= MIN_STARS && (r.originalText ?? r.text)).slice(0, MAX_SHOWN);
    const list = document.querySelector('.reviews__list');
    const section = document.getElementById('atsiliepimai');
    if (!good.length || !list || !section) return;
    for (const r of good) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'review';
      a.href = r.googleMapsURI ?? p.googleMapsURI ?? '#';
      a.target = '_blank';
      a.rel = 'noopener';
      const stars = document.createElement('span');
      stars.className = 'review__stars';
      stars.textContent = '★'.repeat(Math.round(r.rating ?? 5));
      stars.setAttribute('aria-label', `${r.rating} iš 5`);
      const text = document.createElement('p');
      text.className = 'review__text';
      text.textContent = r.originalText ?? r.text ?? '';
      const who = document.createElement('p');
      who.className = 'review__who';
      who.textContent = [r.authorAttribution?.displayName, r.relativePublishTimeDescription].filter(Boolean).join(', ');
      a.append(stars, text, who);
      li.append(a);
      list.append(li);
    }
    section.hidden = false;
  } catch (e) {
    console.warn('[reviews] not loaded', e);
  }
}
