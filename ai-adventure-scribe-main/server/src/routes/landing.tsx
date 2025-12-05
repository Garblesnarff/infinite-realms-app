import { Router } from 'express';
import { getSiteConfig } from '../config/site.js';
import { resolveAssetsForEntries } from '../lib/manifest.js';
import { streamReactResponse } from '../utils/react-stream.js';
import { LandingDocument } from '../views/landing/document.js';
import {
  createFAQSchema,
  createWebPageSchema,
  createSoftwareAppSchema,
  createOrganizationSchema,
  createHowToSchema,
  combineSchemas,
  type FAQItem,
} from '../views/landing/schema.js';
import { MainLandingPage } from '../views/landing/pages/main.js';
import { AIGameMasterPage } from '../views/landing/pages/ai-game-master.js';
import { SoloTabletopRPGPage } from '../views/landing/pages/solo-tabletop-rpg.js';

export function landingRouter() {
  const router = Router();

  // Main landing page - SSR version of LaunchPage
  router.get('/', async (_req, res) => {
    try {
      const [assets] = await Promise.all([
        resolveAssetsForEntries(['index.html', 'src/landing-client.ts']),
      ]);
      const site = getSiteConfig();

      const meta = {
        title: 'Infinite Realms | AI Game Master for Solo Tabletop RPG Adventures',
        description:
          'Play tabletop RPG adventures anytime with an AI Game Master that remembers your story. No scheduling, no prep. Join the beta waitlist for Infinite Realms.',
        canonicalUrl: site.url,
        keywords: [
          'AI Game Master',
          'solo tabletop RPG',
          'AI GM',
          'fantasy RPG',
          'solo RPG',
          'tabletop roleplaying',
          'AI storytelling',
        ],
      };

      const faqItems: FAQItem[] = [
        {
          question: 'What is an AI Game Master?',
          answer:
            'An AI Game Master is an artificial intelligence that runs tabletop roleplaying games for you. It handles storytelling, rules, NPCs, and combat - available 24/7 without scheduling.',
        },
        {
          question: 'How does it solve scheduling issues?',
          answer:
            'Play solo or async - your world persists, so you can pick up anytime without coordinating groups or waiting for a human GM.',
        },
        {
          question: 'Will NPCs really remember my choices?',
          answer:
            'Yes. Our AI remembers every decision you make. Steal from a merchant? They will spread rumors affecting future encounters. Save a village? Expect lasting gratitude.',
        },
        {
          question: 'Do I need tabletop RPG experience?',
          answer:
            'No experience needed. The AI handles all rules and mechanics. You focus on choices and roleplay - perfect for newcomers and veterans alike.',
        },
        {
          question: 'Is Infinite Realms free?',
          answer:
            'We are currently in closed beta. Join the waitlist for free early access and help shape the future of AI-powered tabletop gaming.',
        },
      ];

      const howToSteps = [
        { name: 'Join the Waitlist', text: 'Sign up with your email to get on our exclusive beta access list.' },
        { name: 'Get Early Access', text: 'Once approved, create your account and start building your campaign world.' },
        { name: 'Shape the Future', text: 'Playtest new features, provide feedback, and help us build the ultimate AI Game Master.' },
      ];

      const structuredData = [
        combineSchemas(
          createWebPageSchema(site, {
            ...meta,
            datePublished: '2024-01-01',
            dateModified: new Date().toISOString().split('T')[0],
          }),
          createSoftwareAppSchema(site),
          createOrganizationSchema(site),
          createFAQSchema(faqItems),
          createHowToSchema(
            'How to Play Tabletop RPG with an AI Game Master',
            'Get started with Infinite Realms in three simple steps',
            howToSteps
          )
        ),
      ];

      streamReactResponse(
        res,
        <LandingDocument site={site} assets={assets} meta={meta} structuredData={structuredData}>
          <MainLandingPage site={site} faqItems={faqItems} />
        </LandingDocument>,
        {
          headers: createCacheHeaders({ maxAge: 600, staleWhileRevalidate: 3600 }),
        }
      );
    } catch (error) {
      console.error('Failed to render main landing page', error);
      res.status(500).send('Failed to render landing page');
    }
  });

  // AI Game Master keyword page
  router.get('/ai-game-master', async (_req, res) => {
    try {
      const [assets] = await Promise.all([
        resolveAssetsForEntries(['index.html', 'src/landing-client.ts']),
      ]);
      const site = getSiteConfig();

      const meta = {
        title: 'AI Game Master | Play Tabletop RPG Anytime with Infinite Realms',
        description:
          'An AI Game Master runs tabletop RPG games 24/7. No scheduling, no prep, no waiting. Create epic fantasy adventures with an intelligent GM that remembers everything.',
        canonicalUrl: `${site.url}/ai-game-master`,
        keywords: [
          'AI Game Master',
          'AI GM',
          'artificial intelligence game master',
          'automated GM',
          'solo RPG',
          'AI storytelling',
          'tabletop RPG',
        ],
      };

      const faqItems: FAQItem[] = [
        {
          question: 'What is an AI Game Master?',
          answer:
            'An AI Game Master is an artificial intelligence system that runs tabletop roleplaying games. Unlike human GMs, an AI GM is available 24/7, remembers every detail of your campaign, and never needs prep time.',
        },
        {
          question: 'Can an AI really replace a human Game Master?',
          answer:
            'An AI Game Master complements rather than replaces human GMs. It is perfect for solo play, practice sessions, or when your group cannot meet. The AI provides consistent storytelling and instant availability.',
        },
        {
          question: 'How does the AI handle tabletop RPG rules?',
          answer:
            'Our AI understands classic fantasy RPG mechanics including combat, skills, spells, and character progression. It handles all dice rolls and rule interpretations so you can focus on the story.',
        },
        {
          question: 'Is the AI Game Master free?',
          answer:
            'We are currently in closed beta with free access for early adopters. Join the waitlist to be among the first to experience AI-powered tabletop gaming.',
        },
        {
          question: 'How does the AI remember my campaign history?',
          answer:
            'Infinite Realms uses advanced memory systems to track every character, location, choice, and consequence. Your world persists across sessions and evolves based on your actions.',
        },
      ];

      const structuredData = [
        combineSchemas(
          createWebPageSchema(site, {
            ...meta,
            datePublished: '2024-01-01',
            dateModified: new Date().toISOString().split('T')[0],
          }),
          createSoftwareAppSchema(site),
          createFAQSchema(faqItems)
        ),
      ];

      streamReactResponse(
        res,
        <LandingDocument site={site} assets={assets} meta={meta} structuredData={structuredData}>
          <AIGameMasterPage site={site} faqItems={faqItems} />
        </LandingDocument>,
        {
          headers: createCacheHeaders({ maxAge: 600, staleWhileRevalidate: 3600 }),
        }
      );
    } catch (error) {
      console.error('Failed to render AI Game Master page', error);
      res.status(500).send('Failed to render landing page');
    }
  });

  // Solo Tabletop RPG keyword page
  router.get('/solo-tabletop-rpg', async (_req, res) => {
    try {
      const [assets] = await Promise.all([
        resolveAssetsForEntries(['index.html', 'src/landing-client.ts']),
      ]);
      const site = getSiteConfig();

      const meta = {
        title: 'Solo Tabletop RPG | Play Fantasy Adventures Alone with AI',
        description:
          'Experience solo tabletop RPG adventures with an AI Game Master. No group needed. Create your character, build your world, and embark on epic quests anytime.',
        canonicalUrl: `${site.url}/solo-tabletop-rpg`,
        keywords: [
          'solo tabletop RPG',
          'solo RPG',
          'play RPG alone',
          'single player tabletop',
          'solo fantasy game',
          'AI Game Master',
        ],
      };

      const faqItems: FAQItem[] = [
        {
          question: 'Can you play tabletop RPG alone?',
          answer:
            'Yes! Solo tabletop RPG is a growing hobby. With an AI Game Master like Infinite Realms, you get the full tabletop experience - character creation, exploration, combat, and storytelling - all on your own schedule.',
        },
        {
          question: 'Is solo RPG as fun as playing with a group?',
          answer:
            'Solo RPG offers a different but equally rewarding experience. You have complete freedom to explore at your pace, make decisions without compromise, and immerse deeply in your character arc.',
        },
        {
          question: 'How does solo tabletop RPG work with AI?',
          answer:
            'The AI acts as your Game Master - describing scenes, voicing NPCs, running combat, and tracking your campaign. You make the choices; the AI brings your adventure to life.',
        },
        {
          question: 'Do I need any tabletop RPG experience?',
          answer:
            'No experience required. The AI handles all rules and mechanics. Perfect for curious newcomers and experienced players who want to play more often.',
        },
        {
          question: 'Can I play anytime I want?',
          answer:
            'Absolutely. Unlike group games that require scheduling, solo tabletop RPG with AI is available 24/7. Play for 10 minutes or 10 hours - your world is always ready.',
        },
      ];

      const structuredData = [
        combineSchemas(
          createWebPageSchema(site, {
            ...meta,
            datePublished: '2024-01-01',
            dateModified: new Date().toISOString().split('T')[0],
          }),
          createSoftwareAppSchema(site),
          createFAQSchema(faqItems)
        ),
      ];

      streamReactResponse(
        res,
        <LandingDocument site={site} assets={assets} meta={meta} structuredData={structuredData}>
          <SoloTabletopRPGPage site={site} faqItems={faqItems} />
        </LandingDocument>,
        {
          headers: createCacheHeaders({ maxAge: 600, staleWhileRevalidate: 3600 }),
        }
      );
    } catch (error) {
      console.error('Failed to render Solo Tabletop RPG page', error);
      res.status(500).send('Failed to render landing page');
    }
  });

  return router;
}

function createCacheHeaders({ maxAge, staleWhileRevalidate }: { maxAge: number; staleWhileRevalidate: number }) {
  const directive = `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
  return {
    'Cache-Control': directive,
    'CDN-Cache-Control': directive,
    'Vercel-CDN-Cache-Control': directive,
    'Surrogate-Control': directive,
    Vary: 'Accept-Encoding, Accept-Language',
  };
}
