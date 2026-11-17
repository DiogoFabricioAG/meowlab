/*
  Plays a conversation (src/components/landing/chats.ts) in a Phone.astro. One player per phone;
  run() cancels whatever the phone was playing. With reduced motion the messages appear at once,
  and the buttons that wait for the visitor still work.
*/
import type { Actor, Chat, Step } from '../components/landing/chats';

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const format = (s: string) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

const TICKS = '<svg class="ml-ticks" viewBox="0 0 18 11" aria-hidden="true"><path d="M1 6l3 3 6-7M7.5 8.5 8.6 9.6l6.4-7.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface PlayerOptions {
  onHandoff?: (h: NonNullable<Step['handoff']>) => void;
  onEnd?: () => void;
}

export class Player {
  private run_ = 0;
  private wall: HTMLElement;
  private typed: HTMLElement;
  private send: HTMLElement;
  private minute = 0;
  private clock = '';

  constructor(private phone: HTMLElement, private opts: PlayerOptions = {}) {
    this.wall = phone.querySelector('[data-wall]')!;
    this.typed = phone.querySelector('[data-typed]')!;
    this.send = phone.querySelector('[data-send]')!;
  }

  /** Sets the chat's header (the tour changes from the owner's chat to a customer's). */
  header(chat: Chat) {
    this.phone.querySelector('[data-name]')!.textContent = chat.name;
    this.phone.querySelector('[data-sub]')!.textContent = chat.sub;
    const av = this.phone.querySelector('[data-avatar]')!;
    av.innerHTML = chat.avatar === 'mark'
      ? '<img src="/assets/landing/meowlab-mark.png" alt="" width="36" height="36" />'
      : `<span>${esc(chat.avatar)}</span>`;
  }

  stop() { this.run_++; this.composer(''); }

  async run(chat: Chat) {
    const id = ++this.run_;
    this.wall.querySelectorAll(':scope > :not(.ml-day)').forEach((n) => n.remove());
    this.composer('');
    this.clock = chat.time;
    this.minute = 0;
    const done = await this.steps(chat.steps, id);
    if (done && id === this.run_) this.opts.onEnd?.();
  }

  private alive(id: number) { return id === this.run_; }

  private sleep(ms: number, id: number) {
    return new Promise<boolean>((r) => setTimeout(() => r(this.alive(id)), reduce() ? 0 : ms));
  }

  private time() {
    const [h, m] = this.clock.split(':').map(Number);
    const t = h * 60 + m + this.minute;
    return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }

  private add(node: HTMLElement) {
    this.wall.append(node);
    this.wall.scrollTo({ top: this.wall.scrollHeight, behavior: reduce() ? 'auto' : 'smooth' });
  }

  private composer(text: string) {
    const on = text !== '';
    this.typed.textContent = on ? text : 'Mensaje';
    this.typed.classList.toggle('is-typing', on);
    this.send.classList.toggle('is-send', on);
  }

  private bubble(from: 'in' | 'out', step: Pick<Step, 'in' | 'out' | 'doc' | 'photo'>) {
    const row = document.createElement('div');
    row.className = `ml-row ml-row--${from}`;
    const text = (from === 'in' ? step.in : step.out) ?? '';
    const doc = step.doc
      ? `<span class="ml-doc"><span class="ml-doc__icon">PDF</span><span class="ml-doc__name"><b>${esc(step.doc[0])}</b><small>${esc(step.doc[1])}</small></span></span>`
      : '';
    if (step.photo) {
      // a picture the person sends: a supplier's invoice or a Yape capture, drawn in HTML
      const [first, ...rest] = step.photo.lines;
      const shot = step.photo.kind === 'yape';
      const pic = shot
        ? `<img class="ml-photo-img" src="/assets/landing/yape-captura.webp" alt="${esc(step.photo.lines.join(' '))}" width="420" height="746" />`
        : `<span class="ml-photo ml-photo--${step.photo.kind}" role="img" aria-label="${esc(step.photo.lines.join(', '))}"><b>${esc(first)}</b>${rest.map((l) => `<span>${esc(l)}</span>`).join('')}</span>`;
      row.innerHTML = `<div class="ml-bub ml-bub--pic${shot ? ' ml-bub--shot' : ''}">${pic}<span class="ml-meta">${this.time()}${from === 'out' ? TICKS : ''}</span></div>`;
      this.add(row);
      return row;
    }
    row.innerHTML = `<div class="ml-bub">${doc}<span class="ml-bub__text">${format(text)}</span><span class="ml-meta">${this.time()}${from === 'out' ? TICKS : ''}</span></div>`;
    this.add(row);
    return row;
  }

  private typing() {
    const row = document.createElement('div');
    row.className = 'ml-row ml-row--in';
    row.innerHTML = '<div class="ml-bub ml-bub--typing" aria-label="escribiendo"><i></i><i></i><i></i></div>';
    this.add(row);
    return row;
  }

  private async typeOut(text: string, id: number) {
    if (reduce()) return true;
    const chars = [...text];
    const every = Math.max(18, Math.min(45, 1100 / chars.length));
    for (let i = 1; i <= chars.length; i++) {
      this.composer(chars.slice(0, i).join(''));
      if (!(await this.sleep(every, id))) return false;
    }
    return this.sleep(250, id);
  }

  private buttons(labels: string[], clickable: boolean) {
    const box = document.createElement('div');
    box.className = 'ml-btns';
    labels.forEach((label) => {
      const b = document.createElement(clickable ? 'button' : 'span');
      b.className = 'ml-btn';
      b.textContent = label;
      if (clickable) (b as HTMLButtonElement).type = 'button';
      box.append(b);
    });
    this.add(box);
    return box;
  }

  private async steps(steps: Step[], id: number): Promise<boolean> {
    let last: HTMLElement | null = null;
    for (const step of steps) {
      if (!(await this.sleep(step.d ?? 0, id))) return false;
      if (step.handoff) { this.opts.onHandoff?.(step.handoff); continue; }
      if (step.out !== undefined) {
        if (!step.photo && !(await this.typeOut(step.out, id))) return false;
        this.composer('');
        this.bubble('out', step);
        this.minute += 1;
        continue;
      }
      if (step.tap !== undefined && last) {
        const btn = last.children[step.tap] as HTMLElement;
        btn.classList.add('is-tapped');
        if (!(await this.sleep(350, id))) return false;
        last.classList.add('is-used');
        this.bubble('out', { out: btn.textContent ?? '' });
        continue;
      }
      if (step.in !== undefined) {
        const dots = this.typing();
        const ok = await this.sleep(step.doc ? 1100 : 750, id);
        dots.remove();
        if (!ok) return false;
        this.bubble('in', step);
        last = step.buttons ? this.buttons(step.buttons, !!step.wait) : null;
        if (step.wait && last) {
          const box = last;
          const choice = await new Promise<number>((resolve) => {
            box.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => resolve(i), { once: true }));
            box.querySelector('button')?.classList.add('is-hint');
          });
          if (!this.alive(id)) return false;
          const btn = box.children[choice] as HTMLElement;
          btn.classList.add('is-tapped');
          box.classList.add('is-used');
          box.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
          this.bubble('out', { out: btn.textContent ?? '' });
          this.minute += 1;
          const next = step.branches?.[choice];
          if (next && !(await this.steps(next, id))) return false;
        }
      }
    }
    return true;
  }
}

/* The cats and the owner, as the handoff cards draw them. */
export const ACTORS: Record<Actor, { name: string; logo?: string }> = {
  invoice: { name: 'Invoice Cat', logo: 'invoice-cat' },
  tender: { name: 'Tender Cat', logo: 'tender-cat' },
  sales: { name: 'Sales Cat', logo: 'sales-cat' },
  stock: { name: 'Stock Cat', logo: 'stock-cat' },
  reorder: { name: 'Reorder Cat', logo: 'reorder-cat' },
  collections: { name: 'Collections Cat', logo: 'collections-cat' },
  support: { name: 'Support Cat', logo: 'support-cat' },
  owner: { name: 'Tú' },
};

export function handoffCard([from, to, text, ans]: NonNullable<Step['handoff']>) {
  const face = (a: Actor) => ACTORS[a].logo
    ? `<img src="/assets/agents/${ACTORS[a].logo}.webp" alt="" width="40" height="40" />`
    : '<span class="ml-you">Tú</span>';
  const li = document.createElement('li');
  li.className = 'ml-hand';
  li.innerHTML = `<span class="ml-hand__faces">${face(from)}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${face(to)}</span>`
    + `<span class="ml-hand__text"><small>${esc(ACTORS[from].name)} → ${esc(ACTORS[to].name)}</small><b>${esc(text)}</b>${ans ? `<span>${esc(ans)}</span>` : ''}</span>`;
  return li;
}
