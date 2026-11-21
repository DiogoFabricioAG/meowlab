import { describe, expect, it } from 'vitest';
import { heroChat, teamChat, tourChats, type Chat, type Step } from '../../src/components/landing/chats';
import { ACTORS } from '../../src/scripts/chat';

const CATS = ['invoice', 'sales', 'stock', 'reorder', 'collections', 'support', 'tender'] as const;

function allSteps(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.branches) {
      for (const branch of step.branches) {
        out.push(...allSteps(branch));
      }
    }
  }
  return out;
}

const allChats: [string, Chat][] = [
  ['heroChat', heroChat],
  ['teamChat', teamChat],
  ...Object.entries(tourChats),
];

describe('chats.ts', () => {
  it('cada gato tiene al menos una conversación en tourChats', () => {
    const keys = Object.keys(tourChats);
    for (const cat of CATS) {
      const matches = keys.filter((k) => k.startsWith(`${cat}-`));
      expect(matches.length, `falta conversación para ${cat}`).toBeGreaterThan(0);
    }
  });

  it('todos los handoff usan actores existentes en ACTORS', () => {
    for (const [chatId, chat] of allChats) {
      for (const step of allSteps(chat.steps)) {
        if (!step.handoff) continue;
        const [from, to] = step.handoff;
        expect(ACTORS[from], `${chatId}: actor origen inválido "${from}"`).toBeDefined();
        expect(ACTORS[to], `${chatId}: actor destino inválido "${to}"`).toBeDefined();
      }
    }
  });

  it('los tap y branches apuntan a botones que existen', () => {
    function validateSequence(chatId: string, steps: Step[]) {
      let lastButtons: string[] | null = null;
      for (const step of steps) {
        if (step.tap !== undefined) {
          expect(lastButtons, `${chatId}: tap=${step.tap} sin botones previos`).not.toBeNull();
          expect(step.tap, `${chatId}: tap fuera de rango`).toBeGreaterThanOrEqual(0);
          expect(step.tap, `${chatId}: tap fuera de rango`).toBeLessThan(lastButtons!.length);
        }
        if (step.in !== undefined) {
          lastButtons = step.buttons ?? null;
          if (step.branches) {
            expect(step.buttons, `${chatId}: branches sin buttons`).toBeDefined();
            expect(step.branches.length).toBeLessThanOrEqual(step.buttons!.length);
            for (const branch of step.branches) {
              validateSequence(chatId, branch);
            }
          }
        }
      }
    }

    for (const [chatId, chat] of allChats) {
      validateSequence(chatId, chat.steps);
    }
  });
});
