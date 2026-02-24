/**
 * Ephemeral Fun TBWO Type Prompts
 *
 * Type-specific system prompts for the 6 ephemeral TBWO types.
 * Each prompt guides the builder to produce a focused, shareable HTML page.
 */

export const EPHEMERAL_TYPE_PROMPTS = {
  roast_page: {
    system: `You are building a comedic roast page. Be funny and SPECIFIC — no generic insults.
Use escalating comedy beats: start mild, build to outrageous, end with a heartfelt twist.
Include a rebuttal defense section where the "roastee" can respond.
The page should feel like a comedy special, not a mean note.
Use bold typography, dramatic reveals (scroll-triggered), and a share button.`,
    requiredSections: ['roast-header', 'roast-rounds', 'rebuttal-defense', 'share-footer'],
  },

  tribute_page: {
    system: `You are building an elegant tribute page celebrating a specific person.
Ask for the person's name, relationship, and 3-5 specific memories.
Use warm, elegant typography with a storytelling flow.
Each memory should be its own visual card with a subtle entrance animation.
Include a "From [author]" signature section at the bottom.
The overall feel should be heartfelt and personal — not generic or corporate.`,
    requiredSections: ['tribute-hero', 'person-intro', 'memory-cards', 'closing-message', 'signature'],
  },

  bet_tracker: {
    system: `You are building a bet tracker page between two parties.
Capture both parties' names, the bet terms, resolution criteria, and deadline.
Include a visual countdown timer (JS-powered) to the resolution date.
Add an evidence/proof section where outcomes can be documented.
The page should feel official and fun — like a legally binding (but not really) contract.
Include share buttons so both parties can send the link around.`,
    requiredSections: ['bet-header', 'parties', 'terms-contract', 'countdown', 'evidence-section', 'share-footer'],
  },

  debate_page: {
    system: `You are building a debate page presenting two sides of an argument.
Use a split-screen point/counterpoint layout that is fair to both sides.
Each side gets equal visual weight — no bias in design or copy.
Include a simple voting element (localStorage-based, no backend needed).
Show vote counts and percentages in real-time (client-side).
End with a "You Decide" section summarizing both positions.`,
    requiredSections: ['debate-header', 'side-a', 'side-b', 'point-counterpoint', 'voting-section', 'verdict-footer'],
  },

  time_capsule: {
    system: `You are building a digital time capsule page with sealed messages.
Messages are hidden behind a reveal-date countdown.
Use JavaScript date checking to auto-unlock content when the reveal date arrives.
Before the reveal date, show blurred/encrypted-looking placeholders.
After the reveal date, show the actual messages with a dramatic "unsealing" animation.
The overall feel should be nostalgic and meaningful — like opening a real time capsule.`,
    requiredSections: ['capsule-hero', 'countdown-display', 'sealed-messages', 'reveal-section', 'capsule-footer'],
  },

  scoreboard: {
    system: `You are building a leaderboard/scoreboard page.
Give 1st/2nd/3rd place podium treatment with distinct visual hierarchy.
Make scoring rules prominent and clear at the top.
Design mobile-first — this will be viewed on phones at events.
Use large, bold numbers and clear rank indicators.
Include a "Last Updated" timestamp and the competition name prominently.`,
    requiredSections: ['scoreboard-header', 'podium-top-3', 'full-rankings', 'scoring-rules', 'footer'],
  },
};

/** Get ephemeral type prompt, or null */
export function getEphemeralTypePrompt(type) {
  return EPHEMERAL_TYPE_PROMPTS[type] || null;
}
