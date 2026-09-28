import { defineCollection, reference } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';
import { parse as parseYaml } from 'yaml';
import {
  ORBIT_IDS,
  POST_KINDS,
  PROJECT_STATUSES,
  LIBRARY_TYPES,
  LIBRARY_SHELVES,
  HORIZONS,
} from './site.config';

/* Files or folders starting with "_" are ignored, so they can hold notes/templates.
   A post can be a single file (my-post.md) or a folder (my-post/index.md) when it
   has its own images — both publish at /transmissions/my-post/. */
const stripIndex = ({ entry }: { entry: string }) =>
  entry.replace(/\.(md|mdx)$/i, '').replace(/\/index$/i, '').toLowerCase();

/* Collections don't keep file order, so stamp each YAML entry with its position. */
const orderedYaml = (text: string) =>
  (parseYaml(text) ?? []).map((entry: Record<string, unknown>, i: number) => ({ ...entry, position: i }));

const orbit = z.enum(ORBIT_IDS);
const kinds = Object.keys(POST_KINDS) as [keyof typeof POST_KINDS, ...(keyof typeof POST_KINDS)[]];

const posts = defineCollection({
  loader: glob({ pattern: ['**/*.{md,mdx}', '!**/_*', '!**/_*/**'], base: './src/content/posts', generateId: stripIndex }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      /** One or two sentences for lists, search, RSS and link previews.
          Leave it out and the opening paragraph is used instead. */
      summary: z.string().default(''),
      orbit,
      kind: z.enum(kinds).default('essay'),
      tags: z.array(z.string()).default([]),
      /** Slug of a project in src/content/projects (links the post to that mission). */
      project: reference('projects').optional(),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      /** Drafts are visible in `npm run dev` but never built for production. */
      draft: z.boolean().default(false),
    }),
});

const projects = defineCollection({
  loader: glob({ pattern: ['**/*.{md,mdx}', '!**/_*', '!**/_*/**'], base: './src/content/projects', generateId: stripIndex }),
  schema: z.object({
    title: z.string().min(1),
    /** One line for the Flight Log. Falls back to the brief's opening lines. */
    summary: z.string().default(''),
    orbit,
    status: z.enum(PROJECT_STATUSES).default('PLANNED'),
    started: z.coerce.date().optional(),
    ended: z.coerce.date().optional(),
    /** Lower numbers list first in the Flight Log. */
    order: z.number().default(100),
    stack: z.array(z.string()).default([]),
    repo: z.url().optional(),
    demo: z.url().optional(),
    draft: z.boolean().default(false),
  }),
});

const library = defineCollection({
  loader: file('./src/content/library.yaml', { parser: orderedYaml }),
  schema: z.object({
    id: z.string(),
    position: z.number(),
    title: z.string(),
    type: z.enum(LIBRARY_TYPES).default('BOOK'),
    author: z.string().default(''),
    orbit,
    shelf: z.enum(LIBRARY_SHELVES).default('QUEUE'),
    link: z.url().optional(),
    note: z.string().default(''),
    added: z.coerce.date().optional(),
  }),
});

const trajectories = defineCollection({
  loader: file('./src/content/trajectories.yaml', { parser: orderedYaml }),
  schema: z.object({
    id: z.string(),
    position: z.number(),
    title: z.string(),
    orbit,
    horizon: z.enum(HORIZONS).default('THIS YEAR'),
    note: z.string().default(''),
    /** Mark true once you arrive — the card stays, stamped REACHED. */
    reached: z.boolean().default(false),
  }),
});

/* GROW-06 — one profile record (id 'main', the object's only top-level key)
   backing /professional/ and the CV PDF it's generated from. A file loader
   over an object (rather than an array) keys entries by that object's own
   top-level keys — see astro's file() loader. */
const profile = defineCollection({
  loader: file('./src/content/profile.yaml'),
  schema: z.object({
    headline: z.string().default(''),
    summary: z.string().default(''),
    roles: z
      .array(
        z.object({
          title: z.string(),
          org: z.string().optional(),
          start: z.string(),
          end: z.string().optional(),
          summary: z.string().default(''),
        }),
      )
      .default([]),
    expertise: z
      .array(z.object({ area: z.string(), items: z.array(z.string()).default([]) }))
      .default([]),
    selectedWork: z
      .array(
        z.object({
          title: z.string().optional(),
          summary: z.string().optional(),
          link: z.url().optional(),
          /** Points at a Flight Log mission instead of writing title/summary by hand.
              Non-public or draft missions still never show — see lib/content.ts. */
          project: reference('projects').optional(),
        }),
      )
      .default([]),
    education: z
      .array(z.object({ degree: z.string(), institution: z.string().optional(), year: z.string().optional() }))
      .default([]),
  }),
});

export const collections = { posts, projects, library, trajectories, profile };
