import { getCollection, type CollectionEntry } from 'astro:content';
import { excerpt, slugify } from './util';

export type Post = CollectionEntry<'posts'>;
export type Project = CollectionEntry<'projects'>;
export type LibraryItem = CollectionEntry<'library'>;
export type Trajectory = CollectionEntry<'trajectories'>;

/** Drafts are included in dev (and in builds run with SHOW_DRAFTS=true). */
export const SHOW_DRAFTS = import.meta.env.DEV || __SHOW_DRAFTS__;

const visible = ({ data }: { data: { draft?: boolean } }) => SHOW_DRAFTS || !data.draft;

/** A blank summary falls back to the opening paragraph. */
function withSummary<T extends Post | Project>(entry: T): T {
  if (!entry.data.summary.trim()) entry.data.summary = excerpt(entry.body);
  return entry;
}

/** All visible posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', visible);
  return posts
    .map(withSummary)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id));
}

/** Projects in Flight Log order (`order` field, then title). */
export async function getProjects(): Promise<Project[]> {
  const projects = await getCollection('projects', visible);
  return projects
    .map(withSummary)
    .sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
}

/** Library holdings in the order they appear in library.yaml. */
export async function getLibrary(): Promise<LibraryItem[]> {
  return (await getCollection('library')).sort((a, b) => a.data.position - b.data.position);
}

/** Trajectories in the order they appear in trajectories.yaml. */
export async function getTrajectories(): Promise<Trajectory[]> {
  return (await getCollection('trajectories')).sort((a, b) => a.data.position - b.data.position);
}

/** Tag → posts map, tags sorted by frequency then name. */
export async function getTags(): Promise<{ tag: string; slug: string; posts: Post[] }[]> {
  const posts = await getPosts();
  const map = new Map<string, { tag: string; slug: string; posts: Post[] }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = slugify(tag);
      if (!slug) continue;
      if (!map.has(slug)) map.set(slug, { tag, slug, posts: [] });
      map.get(slug)!.posts.push(post);
    }
  }
  return [...map.values()].sort((a, b) => b.posts.length - a.posts.length || a.slug.localeCompare(b.slug));
}

export const postsForProject = (posts: Post[], projectId: string) =>
  posts.filter((p) => p.data.project?.id === projectId);
