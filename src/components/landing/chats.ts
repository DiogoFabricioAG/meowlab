/*
  The conversations the home page plays in its WhatsApp phones. Each one shows what the cat does
  today (ADR-0011 to ADR-0017), end to end. The one exception is Sales Cat's tour chat: by the
  operator's decision (2026-11-16) it shows Sales Cat's phase 2 with the customer, and the page
  marks that step «Próximamente».

  A step waits `d` milliseconds after the previous one, then:
  - out: a message the person sends (typed letter by letter in the composer first);
  - in: a message from MeowLab (a short "escribiendo…" goes before it), with an optional PDF (doc)
    and reply buttons;
  - wait: the buttons wait for the visitor's tap; branches[i] runs after button i;
  - tap: the buttons are tapped by themselves (button i);
  - photo: a picture the person sends (a supplier's invoice or a Yape capture), drawn in HTML;
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
  photo?: { kind: 'invoice' | 'yape'; lines: string[] };
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
      { d: 300, out: 'Boleta al DNI 45781236: 3 polos blancos M a S/ 25' },
      { d: 300, in: 'Boleta para *María Torres* (DNI 45781236)\n3 polos blancos M\n*Total S/ 75.00*, con IGV\n\n¿La emito?', buttons: ['Emitir', 'Cambiar datos'] },
      { d: 1300, tap: 0 },
      { d: 300, in: 'Boleta B001-1032 aceptada por SUNAT ✅', doc: ['B001-1032.pdf', '1 página · PDF · 48 kB'] },
      { d: 900, in: '📦 Le pasé la salida a Stock Cat: los *polos blancos M* bajaron a 6 y tu mínimo es 10.', buttons: ['Pedir reposición'] },
    ],
  },
  sales: {
    ...shop, time: '16:20', steps: [
      { d: 300, out: 'Hola, ¿tienen polos blancos talla M?' },
      { d: 300, in: '¡Hola! Sí, tenemos polos blancos M a *S/ 25.00*. ¿Cuántos necesitas?' },
      { d: 900, out: '10, para el viernes' },
      { d: 300, in: 'Tu cotización N.° 57: 10 polos blancos M · *S/ 250.00* con IGV. ¿La confirmo?', doc: ['Cotizacion-000057.pdf', '1 página · PDF · 46 kB'], buttons: ['Confirmar', 'Cambiar'] },
      { d: 1200, tap: 0 },
      { d: 300, in: '¡Listo! ¿Cómo quieres pagar?', buttons: ['Yape', 'Link de pago', 'Al crédito'] },
      { d: 1200, tap: 0 },
      { d: 300, in: 'Yapea *S/ 250.00* al 987 654 321 (Moda Killa) y mándame la captura.' },
      { d: 1000, out: '', photo: { kind: 'yape', lines: ['¡Yapeaste!', 'S/ 250', 'Moda Killa', 'Op. 41756321'] } },
      { d: 300, in: 'Pago recibido ✅ Aquí tienes tu boleta. Tu pedido sale el viernes.', doc: ['B001-1033.pdf', '1 página · PDF · 48 kB'] },
    ],
  },
  stock: {
    ...owner, time: '09:40', steps: [
      { d: 300, out: '/stock', },
      { d: 600, out: '', photo: { kind: 'invoice', lines: ['TEXTILES LIMA S.A.C.', 'RUC 20512345678', 'Factura F002-881', '20 rollos tela jersey blanca', 'Total S/ 3,600.00'] } },
      { d: 300, in: 'Leí la factura de *Textiles Lima* (RUC 20512345678):\n20 rollos de tela jersey blanca a S/ 180.00\n\n¿La guardo como entrada?', buttons: ['Guardar', 'Cancelar'] },
      { d: 1300, tap: 0 },
      { d: 300, in: 'Guardado. Tienes *24 rollos* de tela jersey.\nLlegó completo el pedido OC-000014 ✅' },
      { d: 900, out: '¿Qué se acaba?' },
      { d: 300, in: 'Bajo tu mínimo:\n• Polos blancos M: 6 (mínimo 10)\n• Hilo blanco: 3 conos (mínimo 5)' },
    ],
  },
  reorder: {
    ...owner, time: '11:10', steps: [
      { d: 300, in: '🛒 La *tela jersey* bajó a 4 rollos (mínimo 10).\n¿Le pido 20 rollos a *Textiles Lima*?', buttons: ['Aprobar', 'Cambiar', 'Descartar'] },
      { d: 1300, tap: 0 },
      { d: 300, in: 'Listo. Le escribí a Textiles Lima por WhatsApp a nombre de tu negocio. Si no responde, le insisto mañana.', doc: ['Orden-de-compra-000014.pdf', '1 página · PDF · 48 kB'] },
      { d: 1600, in: '✅ *Textiles Lima aceptó*: S/ 180.00 el rollo. Llega el jueves 20/11.\nCuando llegue, la sumo a tu stock con su factura.' },
    ],
  },
  collections: {
    ...owner, time: '17:20', steps: [
      { d: 300, out: '', photo: { kind: 'yape', lines: ['¡Te yapearon!', 'S/ 250', 'Bodega Rosita', 'Op. 41756321'] } },
      { d: 300, in: 'Leí la captura: *S/ 250.00* por Yape de *Bodega Rosita* (op. 41756321).\nCoincide con su venta N.° 128 al crédito. ¿La valido?', buttons: ['Validar', 'Rechazar'] },
      { d: 1300, tap: 0 },
      { d: 300, in: 'Pago aplicado ✅ Bodega Rosita ya no te debe nada.\n\nTe deben *S/ 1,400.00*. *Juan Pérez* tiene S/ 300.00 vencidos hace 12 días: te preparé un recordatorio firme.', buttons: ['Enviar por WhatsApp'] },
      { d: 1300, tap: 0 },
    ],
  },
  support: {
    ...shop, time: '23:04', steps: [
      { d: 300, out: '¿Hacen delivery a San Miguel?' },
      { d: 300, in: '¡Hola! Sí, en Lima Metropolitana por *S/ 10*. Llega en 24 a 48 horas.' },
      { d: 900, out: 'Mi pedido de ayer llegó con una mancha 😕' },
      { d: 300, in: 'Lo siento mucho. Le pasé tu caso al equipo de Moda Killa como urgente; te respondemos por aquí.' },
      { d: 1600, in: 'De parte del equipo de Moda Killa: te cambiamos el polo mañana, sin costo.\n\n¿Te ayudé?', buttons: ['Sí, gracias', 'No'] },
      { d: 1200, tap: 0 },
    ],
  },
  tender: {
    ...owner, time: '07:30', steps: [
      { d: 300, in: '🏛️ *Licitación nueva de tu rubro* en el SEACE:\nPapel bond A4 y útiles de oficina · entidad de Lima\nRegistro de participantes hasta el *viernes 20*.', buttons: ['Me interesa', 'Evaluar si participo', 'Descartar'] },
      { d: 1300, tap: 1 },
      { d: 300, in: 'Encaja con lo que vendes y piden entregas en Lima. Antes del viernes 20 revisa tu RNP vigente.\nLa dejé en *Guardadas* para que veas las bases completas en la app.' },
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
