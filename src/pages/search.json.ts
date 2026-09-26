import { POST_KINDS } from '../site.config';
import { getPosts, getProjects, getLibrary, getTrajectories } from '../lib/content';
import { orbitById } from '../lib/orbits';
import { href, stationDate, isoDate } from '../lib/util';

/** Strip Markdown down to searchable words. */
const plain = (md = '') =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);

export async function GET() {
  const [posts, projects, library, trajectories] = await Promise.all([
    getPosts(),
    getProjects(),
    getLibrary(),
    getTrajectories(),
  ]);

  const docs = [
    ...posts.map((p) => ({
      type: 'TRANSMISSION',
      title: p.data.title,
      summary: p.data.summary,
      url: href(`/transmissions/${p.id}/`),
      color: orbitById(p.data.orbit).color,
      meta: `${POST_KINDS[p.data.kind]} · ${stationDate(p.data.date)}`,
      tags: [...p.data.tags, orbitById(p.data.orbit).name],
      body: plain(p.body),
      date: isoDate(p.data.date),
    })),
    ...projects.map((p) => ({
      type: 'MISSION',
      title: p.data.title,
      summary: p.data.summary,
      url: href(`/log/${p.id}/`),
      color: orbitById(p.data.orbit).color,
      meta: p.data.status,
      tags: [...p.data.stack, orbitById(p.data.orbit).name],
      body: plain(p.body),
      date: p.data.started ? isoDate(p.data.started) : '',
    })),
    ...library.map((l) => ({
      type: 'LIBRARY',
      title: l.data.title,
      summary: l.data.note,
      url: href('/library/'),
      color: orbitById(l.data.orbit).color,
      meta: [l.data.type, l.data.author].filter(Boolean).join(' · ').toUpperCase(),
      tags: [l.data.shelf, orbitById(l.data.orbit).name],
      body: '',
      date: '',
    })),
    ...trajectories.map((t) => ({
      type: 'TRAJECTORY',
      title: t.data.title,
      summary: t.data.note,
      url: href('/trajectories/'),
      color: orbitById(t.data.orbit).color,
      meta: t.data.reached ? 'REACHED' : t.data.horizon,
      tags: [orbitById(t.data.orbit).name],
      body: '',
      date: '',
    })),
  ];

  return new Response(JSON.stringify(docs), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
