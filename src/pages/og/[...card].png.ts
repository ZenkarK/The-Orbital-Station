/* READ-02 — one PNG per transmission, mission and orbit:
     /og/transmissions/<slug>.png   /og/log/<slug>.png   /og/orbits/<id>.png
   Paths mirror the pages that link to them (transmissions/[...slug].astro,
   log/[...slug].astro, orbits/[orbit].astro). getStaticPaths draws from the same
   getters/exports those pages use, so a card only ever exists for — and only ever
   shows — what its own page already shows (MODEL-07): a hidden orbit has no
   entry here at all, same as it has no orbit page. */
import type { APIContext } from 'astro';
import { getPosts, getProjects } from '../../lib/content';
import { displayedOrbits } from '../../lib/visibility';
import { transmissionCard, missionCard, orbitCard, renderCard, type CardData } from '../../lib/og-card';

interface Props {
  data: CardData;
}

export async function getStaticPaths() {
  const [posts, projects] = await Promise.all([getPosts(), getProjects()]);
  return [
    ...posts.map((post) => ({
      params: { card: `transmissions/${post.id}` },
      props: { data: transmissionCard(post) },
    })),
    ...projects.map((project) => ({
      params: { card: `log/${project.id}` },
      props: { data: missionCard(project) },
    })),
    ...displayedOrbits.map((o) => ({
      params: { card: `orbits/${o.id}` },
      props: { data: orbitCard(o) },
    })),
  ];
}

export async function GET({ props }: APIContext<Props>) {
  const png = await renderCard(props.data);
  // Response's BodyInit wants a plain ArrayBuffer-backed view; Buffer's type is
  // generic over ArrayBufferLike, which TS won't structurally match — copy it out.
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
