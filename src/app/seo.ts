/**
 * Per-route head tags (docs/architecture.md "SEO"). TanStack Router collects each route's `head()`
 * and <HeadContent/> (in __root) writes them into document.head. English is the canonical locale
 * until translations land, so every locale variant points its canonical at the /en page — the
 * translated-locale routes render English today and must not index as duplicates.
 */
import type { AnyRouteMatch } from '@tanstack/react-router'

export const SITE_URL = 'https://learn.hamptonmakes.com'
export const SITE_NAME = "Hampton's CS Concept Lab"

export interface PageHeadOptions {
  /** Path after the locale segment, starting with '/' ('' for the landing page). */
  path: string
  /** ≤ ~60 chars; ` · ${SITE_NAME}` is appended unless the title already is the site name. */
  title: string
  description: string
  /** schema.org JSON-LD object(s) for this page. */
  jsonLd?: object[]
  noindex?: boolean
}

type Head = {
  meta: AnyRouteMatch['meta']
  links: AnyRouteMatch['links']
  scripts: AnyRouteMatch['headScripts']
}

export function pageHead(opts: PageHeadOptions): Head {
  const canonical = `${SITE_URL}/en${opts.path}`
  const title = opts.title === SITE_NAME ? opts.title : `${opts.title} · ${SITE_NAME}`
  return {
    meta: [
      { title },
      { name: 'description', content: opts.description },
      ...(opts.noindex ? [{ name: 'robots', content: 'noindex' }] : []),
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:title', content: title },
      { property: 'og:description', content: opts.description },
      { property: 'og:url', content: canonical },
      { property: 'og:image', content: `${SITE_URL}/og.png` },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [{ rel: 'canonical', href: canonical }],
    scripts: (opts.jsonLd ?? []).map((obj) => ({
      type: 'application/ld+json',
      children: JSON.stringify(obj),
    })),
  }
}

/** The site + author, used by the landing page. */
export function siteJsonLd(): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${SITE_URL}/en`,
      description:
        'Animated, step-by-step lessons on the computer science ideas working programmers usually skip — starting with CRDTs. Every value on screen is computed by real implementations.',
      author: personJsonLd(),
    },
  ]
}

export function personJsonLd(): object {
  return {
    '@type': 'Person',
    name: 'Hampton Lintorn-Catlin',
    url: 'https://hamptonmakes.com',
    sameAs: ['https://github.com/HamptonMakes'],
  }
}

/** A topic page as a schema.org LearningResource inside the course. */
export function topicJsonLd(opts: {
  path: string
  title: string
  description: string
  moduleTitle: string
}): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: opts.title,
      description: opts.description,
      url: `${SITE_URL}/en${opts.path}`,
      learningResourceType: 'Interactive lesson',
      educationalLevel: 'Professional',
      isPartOf: {
        '@type': 'Course',
        name: `${opts.moduleTitle} — ${SITE_NAME}`,
        url: `${SITE_URL}/en`,
        provider: personJsonLd(),
      },
      author: personJsonLd(),
      isAccessibleForFree: true,
      inLanguage: 'en',
    },
  ]
}
