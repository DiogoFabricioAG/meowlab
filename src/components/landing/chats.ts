/*
  The conversations the home page plays in its WhatsApp phones. Each one says only what the cat
  does today (ADR-0011 to ADR-0017): nothing from a later phase.

  A step waits `d` milliseconds after the previous one, then:
  - out: a message the person sends (typed letter by letter in the composer first);
  - in: a message from MeowLab (a short "escribiendo…" goes before it), with an optional PDF (doc)
    and reply buttons;
  - wait: the buttons wait for the visitor's tap; branches[i] runs after button i;
  - tap: the buttons are tapped by themselves (button i);
  - handoff: what happens inside, shown beside the phone in the "Los gatos trabajan juntos" section.
*/

export type Actor = 'invoice' | 'tender' | 'sales' | 'stock' | 'reorder' | 'collections' | 'support' | 'owner';

export interface Step {
  d?: number;
  out?: string;
  in?: string;
  doc?: [string, string];
  buttons?: string[];
  wait?: boolean;
  branches?: Step[][];
  tap?: number;
  handoff?: [Actor, Actor, string, string?];
}

export interface Chat {
  name: string;
  sub: string;
  avatar: 'mark' | string;
  time: string;
  steps: Step[];
}

const owner = { name: 'MeowLab', sub: 'en línea', avatar: 'mark' as const };
const shop = { name: 'Moda Killa', sub: 'Cuenta de empresa', avatar: 'MK' };

const emitted: Step[] = [
  { d: 500, in: 'Factura F001-248 emitida y aceptada por SUNAT ✅', doc: ['F001-248.pdf', '1 página · PDF · 52 kB'] },
];

/* The hero: the visitor taps «Emitir» or «Corregir» and the chat follows. */
export const heroChat: Chat = {
  ...owner,
  time: '18:41',
  steps: [
    { d: 600, out: 'Emite una factura a Distribuidora Rímac: 12 cajas de papel bond A4 a S/ 100 cada una, más IGV' },
    {
      d: 400,
      in: 'Factura lista para *Distribuidora Rímac*\n12 cajas de papel bond A4\nSubtotal S/ 1,200.00 · IGV S/ 216.00\n*Total S/ 1,416.00*\n\n¿La emito?',
      buttons: ['Emitir', 'Corregir'],
      wait: true,
      branches: [
        emitted,
        [
          { d: 400, in: '¿Qué quieres cambiar?', buttons: ['Cantidad', 'Precio', 'Cliente'], wait: true, branches: [
            [{ d: 300, in: 'Dime la nueva cantidad.' }, { d: 700, out: 'Son 15 cajas' }],
            [{ d: 300, in: 'Dime el nuevo precio por caja.' }, { d: 700, out: 'S/ 118 la caja, con IGV' }],
            [{ d: 300, in: '¿A qué cliente se la emito?' }, { d: 700, out: 'A Librería San Marcos' }],
          ] },
          { d: 400, in: 'Listo, actualicé el borrador. ¿La emito?', buttons: ['Emitir'], wait: true, branches: [emitted] },
        ],
      ],
    },
  ],
};

/* The tour: one conversation per cat, played when its step reaches the middle of the screen. */
export const tourChats: Record<string, Chat> = {
  invoice: {
    ...owner, time: '10:12', steps: [
      { d: 300, out: 'Boleta a María Torres: 2 polos blancos M a S/ 25' },
      { d: 300, in: 'Boleta para *María Torres*\n2 polos blancos M\n*Total S/ 50.00*, con IGV\n\n¿La emito?', buttons: ['Emitir', 'Corregir'] },
      { d: 1200, tap: 0 },
      { d: 300, in: 'Boleta B001-1032 aceptada por SUNAT ✅', doc: ['B001-1032.pdf', '1 página · PDF · 48 kB'] },
    ],
  },
  tender: {
    ...owner, time: '07:30', steps: [
      { d: 300, in: '🏛️ *2 licitaciones nuevas* de tu rubro en el SEACE:\n\n• Papel bond A4 · entidad de Lima · cierra el viernes 20\n• Útiles de oficina · entidad de Lima · cierra el martes 24\n\nTe las dejé en tu panel.' },
      { d: 1200, out: '¿Cuándo cierra la de papel bond?' },
      { d: 300, in: 'El registro de participantes cierra el *viernes 20*. La marqué como interesante.' },
    ],
  },
  sales: {
    ...owner, time: '11:05', steps: [
      { d: 300, out: '/sales vendí 10 polos blancos M a Bodega Rosita, al crédito hasta el 15' },
      { d: 300, in: 'Venta N.° 128 registrada ✅\n10 polos blancos M · *S/ 250.00*\nAl crédito hasta el 15/12. Se la pasé a Collections Cat.' },
      { d: 1000, out: 'Cotiza 50 polos para el Colegio San Martín' },
      { d: 300, in: 'Cotización N.° 57 para *Colegio San Martín*: S/ 1,250.00 con IGV. Reenvíasela tal cual.', doc: ['Cotizacion-000057.pdf', '1 página · PDF · 46 kB'] },
    ],
  },
  stock: {
    ...owner, time: '09:40', steps: [
      { d: 300, out: '/stock llegaron 20 rollos de tela jersey' },
      { d: 300, in: 'Guardado. Ahora tienes *24 rollos* de tela jersey.' },
      { d: 1400, in: '⚠️ *Polos blancos M* bajaron a 6. Tu mínimo es 10.' },
    ],
  },
  reorder: {
    ...owner, time: '11:10', steps: [
      { d: 300, in: '🛒 La *tela jersey* bajó a 4 rollos (mínimo 10).\n¿Le pido 20 rollos a *Textiles Lima*?', buttons: ['Aprobar', 'Cambiar'] },
      { d: 1300, tap: 0 },
      { d: 300, in: 'Listo. Le escribí a Textiles Lima por WhatsApp a nombre de tu negocio.', doc: ['Orden-de-compra-000014.pdf', '1 página · PDF · 48 kB'] },
      { d: 1600, in: '✅ *Textiles Lima aceptó*: S/ 180.00 el rollo. Llega el jueves 20/11.' },
    ],
  },
  collections: {
    ...owner, time: '17:20', steps: [
      { d: 300, out: '/collections' },
      { d: 300, in: '*Te deben S/ 1,650.00*\nAl día: S/ 900.00 · Vencido: S/ 750.00\n\nBodega Rosita debe S/ 250.00 desde el 15/11. Te preparé el recordatorio.', buttons: ['Enviar recordatorio'] },
      { d: 1400, tap: 0 },
      { d: 300, in: 'Recordatorio enviado a Bodega Rosita ✅' },
    ],
  },
  support: {
    ...shop, time: '23:04', steps: [
      { d: 300, out: 'Hola, ¿hacen delivery a San Miguel?' },
      { d: 300, in: '¡Hola! Sí, en Lima Metropolitana por *S/ 10*. Llega en 24 a 48 horas.' },
      { d: 1000, out: '¿Y abren los domingos?' },
      { d: 300, in: 'Atendemos de lunes a sábado. Por aquí te respondo a cualquier hora 🙂\n\n¿Te ayudé?', buttons: ['Sí, gracias', 'No'] },
      { d: 1300, tap: 0 },
    ],
  },
};

/* The cats working together: a customer at night, and what happens inside. */
export const teamChat: Chat = {
  ...shop,
  time: '23:05',
  steps: [
    { d: 500, out: 'Quiero 5 cajas de papel bond A4' },
    { d: 200, handoff: ['support', 'sales', 'Cotiza 5 cajas de papel bond A4'] },
    { d: 900, handoff: ['sales', 'stock', '¿Quedan cajas de papel bond A4?', 'Sí, 40 cajas'] },
    { d: 900, handoff: ['sales', 'support', 'Cotización N.° 58', 'S/ 590.00 con IGV'] },
    { d: 300, in: 'Tu cotización N.° 58: *S/ 590.00* con IGV, válida hasta el 22/11.', doc: ['Cotizacion-000058.pdf', '1 página · PDF · 46 kB'] },
    { d: 1400, out: '¿Tienen papel A3?' },
    { d: 200, handoff: ['support', 'owner', '¿Tienen papel A3?', 'Te lo pregunta con un botón'] },
    { d: 300, in: 'Déjame consultarlo con el equipo; te respondo por aquí.' },
    { d: 1800, handoff: ['owner', 'support', 'Sí, de 75 g'] },
    { d: 300, in: 'De parte del equipo: sí, tenemos papel A3 de 75 g.' },
  ],
};
