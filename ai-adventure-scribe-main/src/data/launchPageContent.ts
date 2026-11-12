/**
 * Launch Page Content - Centralized Content Source
 *
 * PURPOSE: Single source of truth for all launch page copy and configuration
 * This ensures consistent messaging and makes updates easy across all components
 */

import { ACCOUNT_UPGRADE_PRICE } from '@/hooks/use-account-billing';

export interface PlannedFeature {
  title: string;
  description: string;
  status: 'live' | 'in_development' | 'planned' | 'beta';
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
  // Features Section
  features: {
    headline: 'What works today',
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
        description:
          'Legend adds custom hero creation, lets you keep a hero across adventures, higher limits, and premium voices.',
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

  // Help Shape Offer
  helpShape: {
    headline: 'Help shape Infinite Realms',
    subtitle:
      'Infinite Realms is in open beta. Play it, tell us what to fix, and hear about new features first.',
    description: 'Play now. Join the email list if you want news.',
    perks: [
      {
        title: 'Tell us what to fix',
        description:
          'Send feedback with Contact Us or Discord. The person who builds the game reads it.',
        icon: 'Crown',
      },
      {
        title: 'Hear it first',
        description: 'Join the email list. We write when a new feature ships.',
        icon: 'Star',
      },
      {
        title: 'The real game, today',
        description:
          'The Free plan has the same story memory, 5E rules and combat tracker as Legend. Legend adds custom hero creation, lets you keep a hero across adventures, higher limits, and premium voices.',
        icon: 'Zap',
      },
    ] as EarlyAccessPerk[],
    disclaimer: 'This is a beta. Some things will break or change. Tell us, and we fix them.',
    cta: 'Play free',
  },

  // FAQ Section
  faq: {
    headline: 'Frequently Asked Questions',
    subtitle: 'Short answers about playing Infinite Realms',
    items: [
      {
        question: 'How does it solve scheduling issues?',
        answer:
          'Play solo or async – your world persists, so pick up anytime without coordinating groups.',
      },
      {
        question: 'Will NPCs really remember?',
        answer:
          'Yes. The game saves what happened and what each NPC knows. Example: steal from a merchant, and he may spread rumors that change later scenes.',
      },
      {
        question: 'Do I need D&D experience?',
        answer:
          'No. The game engine handles dice and rules. You choose what your character does. It suits lapsed players who want a story without prep.',
      },
      {
        question: 'Is it finished?',
        answer:
          'No. Infinite Realms is in open beta. You can play full campaigns today. Story memory, voice narration, AI art and the combat tracker all work. Some things still break or change. Tell us when you find one.',
      },
      {
        question: 'How much does it cost?',
        answer: `You can play free. The Free plan has daily limits on messages and images. Legend costs ${ACCOUNT_UPGRADE_PRICE.label} and raises those limits. See the pricing section.`,
      },
      {
        question: 'Do I need an account?',
        answer: 'You can browse adventures without one. To play, you sign in with a free account.',
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

  // Footer
  footer: {
    description:
      'Building Infinite Realms - where every choice shapes destiny and legends are forged in the fires of imagination.',
    links: {
      privacy: '/privacy',
      terms: '/terms',
    },
    legal: {
      ipDisclaimer:
        'Infinite Realms is not affiliated with Wizards of the Coast. D&D content uses SRD/OGL licensed material where applicable.',
      company: 'Infinite Realms',
    },
  },
};

export default launchPageContent;
