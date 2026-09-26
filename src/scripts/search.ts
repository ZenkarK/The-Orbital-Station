/* =============================================================
   Station search — loads /search.json on first use and ranks
   matches client-side. No third-party service, no tracking.
   ============================================================= */

export interface SearchDoc {
  type: 'TRANSMISSION' | 'MISSION' | 'LIBRARY' | 'TRAJECTORY';
  title: string;
  summary: string;
  url: string;
  color: string;
  meta: string;
  tags: string[];
  body: string;
  date: string;
}

interface Indexed extends SearchDoc {
  _t: string;
  _s: string;
  _g: string;
  _b: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

let indexPromise: Promise<Indexed[]> | null = null;
function loadIndex(): Promise<Indexed[]> {
  if (!indexPromise) {
    const url = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/search.json`;
    indexPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`search index: ${r.status}`);
        return r.json() as Promise<SearchDoc[]>;
      })
      .then((docs) =>
        docs.map((d) => ({ ...d, _t: norm(d.title), _s: norm(d.summary), _g: norm(d.tags.join(' ')), _b: norm(d.body) })),
      )
      .catch((err) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

function rank(docs: Indexed[], query: string): Indexed[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { d: Indexed; score: number }[] = [];
  outer: for (const d of docs) {
    let score = 0;
    for (const term of terms) {
      let s = 0;
      if (d._t.includes(term)) s += d._t.startsWith(term) ? 14 : 10;
      if (d._g.includes(term)) s += 6;
      if (d._s.includes(term)) s += 4;
      if (d._b.includes(term)) s += 1;
      if (!s) continue outer; // every term must match somewhere
      score += s;
    }
    scored.push({ d, score });
  }
  return scored.sort((a, b) => b.score - a.score || b.d.date.localeCompare(a.d.date)).map((x) => x.d).slice(0, 30);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function highlight(text: string, query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const safe = esc(text);
  if (!terms.length) return safe;
  return safe.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>');
}

/** Wire up one [data-search-box]. Returns a function that focuses the input. */
export function mountSearch(box: HTMLElement): { focus: () => void; input: HTMLInputElement } {
  const input = box.querySelector<HTMLInputElement>('[data-search-input]')!;
  const list = box.querySelector<HTMLUListElement>('[data-search-results]')!;
  const note = box.querySelector<HTMLElement>('[data-search-note]')!;
  const status = box.querySelector<HTMLElement>('[data-search-status]')!;
  let active = -1;
  let seq = 0;

  const links = () => [...list.querySelectorAll<HTMLAnchorElement>('a')];
  const setActive = (i: number) => {
    const all = links();
    if (!all.length) return;
    active = (i + all.length) % all.length;
    all.forEach((a, j) => a.setAttribute('aria-selected', String(j === active)));
    all[active].scrollIntoView({ block: 'nearest' });
  };

  async function run() {
    const q = input.value;
    const mine = ++seq;
    if (!q.trim()) {
      list.innerHTML = '';
      note.hidden = false;
      note.textContent = 'Type to search every transmission, mission, library holding and trajectory.';
      status.textContent = '';
      return;
    }
    let docs: Indexed[];
    try {
      docs = await loadIndex();
    } catch {
      note.hidden = false;
      note.textContent = 'The search index could not be loaded. Try again in a moment.';
      return;
    }
    if (mine !== seq) return;
    const hits = rank(docs, q);
    active = -1;
    list.innerHTML = hits
      .map(
        (d) => `<li><a href="${esc(d.url)}">
          <span class="sr-kind"><span class="sq" style="background:${esc(d.color)}"></span>${esc(d.type)}${d.meta ? ' · ' + esc(d.meta) : ''}</span>
          <span class="sr-title">${highlight(d.title, q)}</span>
          ${d.summary ? `<span class="sr-sum">${highlight(d.summary, q)}</span>` : ''}
        </a></li>`,
      )
      .join('');
    note.hidden = hits.length > 0;
    if (!hits.length) note.textContent = `No signal for “${q.trim()}”. Try fewer or different words.`;
    status.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      const target = links()[active >= 0 ? active : 0];
      if (target) {
        e.preventDefault();
        target.click();
      }
    }
  });
  // Warm the index as soon as someone shows intent.
  input.addEventListener('focus', () => void loadIndex().catch(() => {}), { once: true });

  if (input.value) void run();
  return { focus: () => input.focus(), input };
}
