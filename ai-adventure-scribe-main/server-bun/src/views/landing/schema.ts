import type { SiteConfig } from '../../config/site.js';

export interface FAQItem {
  question: string;
  answer: string;
}

export interface PageMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
  keywords?: string[];
  datePublished?: string;
  dateModified?: string;
}

/**
 * Creates FAQPage schema for landing pages
 * @see https://schema.org/FAQPage
 */
export function createFAQSchema(questions: FAQItem[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

/**
 * Creates WebPage schema for landing pages
 * @see https://schema.org/WebPage
 */
export function createWebPageSchema(site: SiteConfig, meta: PageMeta): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${meta.canonicalUrl}#webpage`,
    url: meta.canonicalUrl,
    name: meta.title,
    description: meta.description,
    inLanguage: 'en-US',
    isPartOf: {
      '@type': 'WebSite',
      '@id': `${site.url}#website`,
      url: site.url,
      name: site.name,
      publisher: {
        '@type': 'Organization',
        '@id': `${site.url}#organization`,
        name: site.name,
        logo: {
          '@type': 'ImageObject',
          url: site.logoUrl,
        },
      },
    },
    primaryImageOfPage: meta.imageUrl
      ? {
          '@type': 'ImageObject',
          url: meta.imageUrl,
        }
      : undefined,
    datePublished: meta.datePublished,
    dateModified: meta.dateModified,
    keywords: meta.keywords?.join(', '),
  };
}

/**
 * Creates SoftwareApplication schema for the product
 * @see https://schema.org/SoftwareApplication
 */
export function createSoftwareAppSchema(site: SiteConfig): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: site.softwareApplication.name,
    applicationCategory: site.softwareApplication.applicationCategory,
    operatingSystem: site.softwareApplication.operatingSystem,
    description: site.description,
    url: site.url,
    offers: {
      '@type': 'Offer',
      price: site.softwareApplication.offers.price,
      priceCurrency: site.softwareApplication.offers.priceCurrency,
      description: 'Free beta access - join the waitlist',
      availability: 'https://schema.org/PreOrder',
    },
    publisher: {
      '@type': 'Organization',
      '@id': `${site.url}#organization`,
      name: site.name,
      logo: {
        '@type': 'ImageObject',
        url: site.logoUrl,
      },
    },
  };
}


/**
 * Combines multiple schema objects into a graph
 */
export function combineSchemas(...schemas: object[]): object {
  return {
    '@context': 'https://schema.org',
    '@graph': schemas.map((schema) => {
      // Remove @context from individual schemas when combining
      const { '@context': _, ...rest } = schema as Record<string, unknown>;
      return rest;
    }),
  };
}
