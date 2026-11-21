import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player, handoffCard } from '../../src/scripts/chat';
import type { Chat } from '../../src/components/landing/chats';

function createPhoneDom(): HTMLElement {
  const phone = document.createElement('div');
  phone.innerHTML = `
    <span data-name></span>
    <span data-sub></span>
    <span data-avatar></span>
    <div data-wall><div class="ml-day">Hoy</div></div>
    <span data-typed>Mensaje</span>
    <span data-send></span>
  `;
  const wall = phone.querySelector('[data-wall]')!;
  wall.scrollTo = vi.fn();
  return phone;
}

describe('Player (src/scripts/chat.ts)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }) as unknown as MediaQueryList);
  });

  it('escapa HTML peligroso en mensajes, documentos, encabezado y tarjetas', async () => {
    const phone = createPhoneDom();
    const player = new Player(phone);

    const xssChat: Chat = {
      name: '<img src=x onerror=alert(1)>',
      sub: 'sub',
      avatar: '<script>1</script>',
      time: '10:00',
      steps: [
        { in: '<script>alert("xss")</script> & "comillas"', doc: ['<b>a.pdf</b>', '<img onerror=1>'] },
        { out: '<svg onload=alert(1)>' },
      ],
    };

    player.header(xssChat);
    await player.run(xssChat);

    expect(phone.querySelectorAll('script')).toHaveLength(0);
    expect(phone.querySelectorAll('img')).toHaveLength(0);
    expect(phone.querySelectorAll('svg:not(.ml-ticks)')).toHaveLength(0);

    const texts = [...phone.querySelectorAll('.ml-bub__text')].map((el) => el.innerHTML);
    expect(texts[0]).toBe('&lt;script&gt;alert("xss")&lt;/script&gt; &amp; "comillas"');
    expect(phone.querySelector('.ml-bub__text')?.textContent).toBe('<script>alert("xss")</script> & "comillas"');
    expect(texts[1]).toBe('&lt;svg onload=alert(1)&gt;');

    const card = handoffCard(['sales', 'stock', '<img src=x>', '<script>bad</script>']);
    expect(card.querySelectorAll('script')).toHaveLength(0);
    expect(card.querySelector('b')?.textContent).toBe('<img src=x>');
  });

  it('formatea *negrita* en una sola línea sin cruzar saltos de línea', async () => {
    const phone = createPhoneDom();
    const player = new Player(phone);

    await player.run({
      name: 'MeowLab',
      sub: 'en línea',
      avatar: 'mark',
      time: '12:00',
      steps: [
        { in: 'Total *S/ 1,416.00* para *Moda Killa*\n*sin\ncerrar*' },
      ],
    });

    const html = phone.querySelector('.ml-bub__text')!.innerHTML;
    expect(html).toContain('<b>S/ 1,416.00</b>');
    expect(html).toContain('<b>Moda Killa</b>');
    expect(html).toContain('*sin\ncerrar*');
  });

  it('ejecuta onEnd al terminar una conversación y no al detenerla antes', async () => {
    const phone = createPhoneDom();
    const onEnd = vi.fn();
    const player = new Player(phone, { onEnd });

    await player.run({
      name: 'MeowLab',
      sub: 'en línea',
      avatar: 'mark',
      time: '09:00',
      steps: [
        { out: 'Hola' },
        { in: '¡Hola! ¿En qué te ayudo?' },
      ],
    });

    expect(onEnd).toHaveBeenCalledTimes(1);

    const onEndStopped = vi.fn();
    const player2 = new Player(phone, { onEnd: onEndStopped });
    const pending = player2.run({
      name: 'MeowLab',
      sub: 'en línea',
      avatar: 'mark',
      time: '09:00',
      steps: [{ in: 'Hola' }],
    });
    player2.stop();
    await pending;

    expect(onEndStopped).not.toHaveBeenCalled();
  });
});
