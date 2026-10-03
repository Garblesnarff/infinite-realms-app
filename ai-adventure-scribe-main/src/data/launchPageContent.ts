/**
 * Launch Page Content - Centralized Content Source
 *
 * PURPOSE: Single source of truth for all launch page copy and configuration
 * This ensures consistent messaging and makes updates easy across all components
 */

import { ACCOUNT_UPGRADE_PRICE } from '@/hooks/use-account-billing';

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  image?: string;
  links?: {
    github?: string;
    linkedin?: string;
    twitter?: string;
  };
}

export interface RoadmapPhase {
  phase: string;
  title: string;
  description: string;
  timeline: string;
  features: string[];
  status: 'current' | 'upcoming' | 'completed';
}

export interface PlannedFeature {
  title: string;
  description: string;
  status: 'live' | 'in_development' | 'planned' | 'beta' | 'coming_soon';
  icon: string;
}

export interface PricingPlan {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  highlighted?: boolean;
}

export interface EarlyAccessPerk {
  title: string;
  description: string;
  icon: string;
}

export interface FAQItem {
  question: string;
  answer: string;
  link?: { href: string; label: string };
}

export const launchPageContent = {
  // Hero Section
  hero: {
    badge: 'Closed Beta: Coming Soon – Be Among the First',
    headline: 'No DM? No Schedule? Your Living D&D World Awaits',
    subtitle:
      'Play solo or async with an AI Dungeon Master that remembers every choice, evolves NPCs, and crafts cinematic stories tailored to you.',
    description:
      'Tired of campaigns fizzling out? Infinite Realms creates persistent worlds where your actions ripple forever—no prep, no waiting, just epic adventures on your time.',
    primaryCTA: 'Claim Your Beta Spot – Be First',
    secondaryCTA: 'Dive into the Vision',
  },

  // Vision Section
  vision: {
    headline: 'A Persistent World That Remembers You – And Evolves With Every Choice',
    content: `Frustrated by campaigns that die from scheduling hell or forgetful AIs? Infinite Realms is your always-on Dungeon Master: persistent NPCs with memories, cinematic narratives that adapt to your style, and emotional depth that makes every session feel alive.

We're building more than just a tool. We're creating a new way to experience tabletop RPGs—a cinematic adventure that adapts to your playstyle, remembers your story, and pushes the boundaries of what's possible in interactive storytelling.

This isn't about replacing human Dungeon Masters. It's about giving every adventurer the chance to experience the magic of a truly responsive, intelligent storytelling partner that never gets tired, never forgets, and always has another twist ready.`,
    quote:
      'Build your legend in a world that waits for you – with characters who remember, react, and grow, turning solo play into an epic saga.',
  },

  // Features Section
  features: {
    headline: "What We're Building",
    subtitle: 'What is live today, and what is still on the way',
    features: [
      {
        title: 'Stories That Remember You',
        description:
          "Every choice creates ripples that last forever. Save a village and they'll erect statues in your honor. Betray an ally and face the consequences sessions later.",
        status: 'live' as const,
        icon: 'Brain',
      },
      {
        title: 'Living Fantasy Worlds',
        description:
          'Generate AI character portraits and campaign cover art, so your adventures come alive with cinematic visuals.',
        status: 'live' as const,
        icon: 'Image',
      },
      {
        title: 'NPCs With Real Memory',
        description:
          'Build relationships that evolve like real friendships. NPCs remember your heroic sacrifices, your betrayals, and your moments of kindness - creating emotional depth that surprises you.',
        status: 'live' as const,
        icon: 'Users',
      },
      {
        title: 'Seamless D&D Rules',
        description:
          'Focus on the story and roleplay while the game engine handles dice, spell slots, and combat. A built-in combat tracker follows initiative and hit points turn by turn.',
        status: 'live' as const,
        icon: 'BookOpen',
      },
      {
        title: 'Immersive Voice Acting',
        description:
          'Hear your adventures read aloud. Every plan includes standard narration voices; Legend adds premium ElevenLabs voices for NPCs and the narrator.',
        status: 'live' as const,
        icon: 'Mic',
      },
      {
        title: 'Your Campaign as a Book',
        description:
          'Transform your entire adventure into a beautiful storybook. Share your legend with friends, complete with artwork, maps, and narrative summaries of your greatest moments.',
        status: 'coming_soon' as const,
        icon: 'Download',
      },
    ] as PlannedFeature[],
  },

  // Pricing Section
  // Limits mirror AIUsageService.DEFAULT_QUOTAS (server-bun/src/services/ai-usage-service.ts):
  // free.daily { llm, image, voice }, pro.daily { llm, image, voice }. Update both together.
  pricing: {
    headline: 'Play free. Upgrade when you want more.',
    subtitle: 'No credit card to start. Cancel Legend any time.',
    plans: [
      {
        name: 'Free',
        price: '$0',
        cadence: 'forever',
        description: 'Everything you need to start your first campaign.',
        features: [
          'Up to 15 DM messages a day',
          '1 AI image a day',
          'Standard narration voices',
          'Persistent NPC and story memory',
          'D&D 5E rules and combat tracker',
        ],
      },
      {
        name: 'Legend',
        price: ACCOUNT_UPGRADE_PRICE.label,
        cadence: '',
        description: 'More turns, more art, and premium voices for regular players.',
        features: [
          'Up to 40 DM messages a day',
          'Up to 2 AI images a day',
          'Premium ElevenLabs narration — 2,000 characters a day',
          'Everything in Free',
          'Cancel any time',
        ],
        highlighted: true,
      },
    ] as PricingPlan[],
    note: 'Daily limits reset at 00:00 UTC.',
  },

  // How It Works Section
  howItWorks: {
    headline: 'Your Journey to Epic Adventures',
    subtitle: 'Three simple steps to join the beta',
    steps: [
      {
        step: '1',
        title: 'Join the Waitlist',
        description:
          "Sign up with your email to get on our exclusive beta access list. We'll notify you as soon as spots open up.",
      },
      {
        step: '2',
        title: 'Get Early Access',
        description:
          "Once approved, you'll receive an invitation to create your account and start building your campaign world.",
      },
      {
        step: '3',
        title: 'Shape the Future',
        description:
          'Playtest new features, provide feedback, and help us build the ultimate AI Dungeon Master together.',
      },
    ],
  },

  // Team Section
  team: {
    headline: 'Forged by Adventurers, for Adventurers',
    subtitle: 'Meet the team building the future of tabletop RPGs',
    members: [
      {
        name: 'Rob McBroom',
        role: 'Founder & Lead Developer',
        bio: 'A lifelong D&D enthusiast and full-stack developer with a passion for creating immersive gaming experiences. Spent countless nights both playing and running campaigns, always dreaming of the perfect digital DM.',
        links: {
          github: 'https://github.com/Garblesnarff',
          linkedin: 'https://linkedin.com/in/robmcbroom',
        },
      },
    ] as TeamMember[],
  },

  // Launch Roadmap
  roadmap: {
    headline: 'The Road to Launch',
    subtitle: 'Our journey from beta to full release',
    phases: [
      {
        phase: 'Phase 1',
        title: 'Closed Beta',
        description:
          'Working with a select group of beta testers to refine core features and gather feedback on the AI Dungeon Master experience.',
        timeline: 'Phase 1',
        status: 'current' as const,
        features: [
          'Core AI storytelling engine',
          'Basic character and campaign creation',
          'Text-based adventure sessions',
          'Community feedback integration',
        ],
      },
      {
        phase: 'Phase 2',
        title: 'Open Beta',
        description:
          'Expanding access to all waitlist members with enhanced features and improved stability based on closed beta feedback.',
        timeline: 'Phase 2',
        status: 'upcoming' as const,
        features: [
          'Visual character and scene generation',
          'Voice narration system',
          'Advanced NPC memory and relationships',
          'Campaign export functionality',
        ],
      },
      {
        phase: 'Phase 3',
        title: 'Public Launch',
        description:
          'Full release with all features, mobile apps, and ecosystem integrations for the complete AI Dungeon Master experience.',
        timeline: 'Phase 3',
        status: 'upcoming' as const,
        features: [
          'Mobile and tablet applications',
          'Third-party integrations (Roll20, Discord)',
          'Advanced customization options',
          'Community marketplace',
        ],
      },
    ] as RoadmapPhase[],
  },

  // Early Access Offer
  earlyAccess: {
    headline: 'Be a Founding Adventurer – Shape the Living World',
    subtitle: 'Get exclusive perks for helping build the AI DM that ends scheduling hell.',
    description: 'Play now, then join the waitlist to hear about new features first.',
    perks: [
      {
        title: 'Personalized NPC in Launch',
        description:
          'Tie to rebuilt campaigns - get a custom NPC that remembers your beta adventures',
        icon: 'Crown',
      },
      {
        title: 'Early Voice Pack Access',
        description: 'Via ElevenLabs integration - be first to experience cinematic narration',
        icon: 'Star',
      },
      {
        title: 'Early Feature Access',
        description: "Get access to new features before they're released to the general public",
        icon: 'Zap',
      },
      {
        title: 'Direct Influence',
        description:
          'Your feedback goes directly to the development team and helps shape the product',
        icon: 'MessageCircle',
      },
    ] as EarlyAccessPerk[],
    disclaimer: 'Beta focuses on core persistence – bugs mean you influence fixes directly.',
    cta: 'Play free',
  },

  // FAQ Section
  faq: {
    headline: 'Frequently Asked Questions',
    subtitle: 'Everything you need to know about our beta launch',
    items: [
      {
        question: 'How does it solve scheduling issues?',
        answer:
          'Play solo or async – your world persists, so pick up anytime without coordinating groups.',
      },
      {
        question: 'Will NPCs really remember?',
        answer:
          "Yes, unlike other AIs. Example: Steal from a merchant? He'll spread rumors, affecting future encounters.",
      },
      {
        question: 'Do I need D&D experience?',
        answer:
          'No. AI handles rules; you focus on choices. Great for lapsed players craving immersion without prep.',
      },
      {
        question: "What's the beta like?",
        answer: 'Core persistent storytelling. Test and shape features like emotional NPCs.',
      },
      {
        question: 'What are the system requirements?',
        answer:
          'The AI Dungeon Master runs in your web browser and works best with modern browsers like Chrome, Firefox, or Safari. A stable internet connection is required for AI processing.',
      },
      {
        question: 'Is my data private and secure?',
        answer:
          'We take privacy seriously. What we collect, how we use it and who we share it with is set out in our',
        link: { href: '/privacy', label: 'Privacy Policy' },
      },
      {
        question: "What if I don't like it?",
        answer: 'You can start free and cancel Legend at any time. Refunds are covered in our',
        link: { href: '/terms', label: 'Terms of Service' },
      },
    ] as FAQItem[],
  },

  // Final CTA
  finalCTA: {
    headline: 'Your Adventure Awaits',
    subtitle: "Don't Miss Out",
    description:
      'Pick an adventure and start playing free in minutes, or join the waitlist for news and updates.',
    cta: 'Play free',
  },

  // Footer
  footer: {
    description:
      'Building Infinite Realms - where every choice shapes destiny and legends are forged in the fires of imagination.',
    links: {
      privacy: '/privacy',
      terms: '/terms',
      contact: '/contact',
    },
    legal: {
      ipDisclaimer:
        'Infinite Realms is not affiliated with Wizards of the Coast. D&D content uses SRD/OGL licensed material where applicable.',
      company: 'Infinite Realms',
    },
  },
};

export default launchPageContent;
