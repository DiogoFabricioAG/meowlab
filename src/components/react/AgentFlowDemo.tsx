import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Handle,
  Position,
  MarkerType,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------
interface ClientNodeData {
  title: string;
  badge: string;
  subtitle: string;
  isGovernment?: boolean;
  message: string;
  time: string;
  isTalking: boolean;
  isNewMessage: boolean;
}

interface AgentTheme {
  primary: string;
  dark: string;
  light: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  hoverBorder: string;
  ring: string;
  bubbleBg: string;
  bubbleBorder: string;
}

const AGENT_THEMES: Record<string, AgentTheme> = {
  facturas: {
    primary: '#2B5C7F', // Azul
    dark: '#1E435E',
    light: '#F3F7FA',
    border: '#D6E2EC',
    badgeBg: '#E6EFF5',
    badgeText: '#204561',
    hoverBorder: '#9BBFD7',
    ring: 'rgba(43, 92, 127, 0.22)',
    bubbleBg: '#F3F7FA',
    bubbleBorder: '#D6E2EC',
  },
  licitaciones: {
    primary: '#1E5E4E', // Verde
    dark: '#144237',
    light: '#F3F8F5',
    border: '#D2E5DB',
    badgeBg: '#E2EFE7',
    badgeText: '#15473B',
    hoverBorder: '#95C7B2',
    ring: 'rgba(30, 94, 78, 0.22)',
    bubbleBg: '#F3F8F5',
    bubbleBorder: '#D2E5DB',
  },
  ventas: {
    primary: '#9B4A42', // Rojo
    dark: '#7A3730',
    light: '#FAF5F4',
    border: '#ECDDDA',
    badgeBg: '#F6E9E7',
    badgeText: '#78352F',
    hoverBorder: '#D8ABA4',
    ring: 'rgba(155, 74, 66, 0.22)',
    bubbleBg: '#FAF5F4',
    bubbleBorder: '#ECDDDA',
  },
};

interface AgentNodeData {
  agentId: 'ventas' | 'facturas' | 'licitaciones';
  theme: AgentTheme;
  name: string;
  tag: string;
  image: string;
  message: string;
  isActive: boolean;
  isTalking: boolean;
  isNewMessage: boolean;
}

interface OwnerNodeData {
  title: string;
  badge: string;
  subtitle: string;
  message: string;
  time: string;
  isTalking: boolean;
  isNewMessage: boolean;
}

interface FlowStep {
  from: string;
  to: string;
  sourceHandle: string;
  targetHandle: string;
  edgeLabel: string;
  fromLabel: string;
  toLabel: string;
  message: string;
}

interface ScenarioConfig {
  id: string;
  title: string;
  tag: string;
  subtitle: string;
  activeAgents: string[];
  actor: {
    title: string;
    badge: string;
    subtitle: string;
    isGovernment?: boolean;
  };
  steps: FlowStep[];
}

// ---------------------------------------------------------
// Custom React Flow Nodes (Authentic Chat Bubbles - NO empty inputs)
// ---------------------------------------------------------

function ClientNodeComponent({ data }: { data: ClientNodeData }) {
  return (
    <div
      style={{ width: 250 }}
      className={`bg-white rounded-2xl p-3.5 shadow-sm border-2 transition-all duration-300 relative select-none ${
        data.isTalking
          ? 'border-[#25D366] ring-4 ring-[#25D366]/20 shadow-md scale-[1.02]'
          : 'border-slate-200 hover:border-emerald-300'
      }`}
    >
      {/* Invisible Handles so no dots or ports stick out - offset outward so arrowheads are never covered */}
      <Handle
        type="source"
        position={Position.Right}
        id="client-out"
        className="opacity-0 !w-1 !h-1 !border-none pointer-events-none"
        style={{ right: '-16px', top: '38%' }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="client-in"
        className="opacity-0 !w-1 !h-1 !border-none pointer-events-none"
        style={{ right: '-16px', top: '62%' }}
      />
      {/* Vertical Handles for Mobile */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="client-bottom-out"
        className="opacity-0 !w-1 !h-1 !border-none pointer-events-none"
        style={{ bottom: '-12px', left: '50%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="client-left-in"
        className="opacity-0 !w-1 !h-1 !border-none pointer-events-none"
        style={{ left: '-16px', top: '50%' }}
      />

      {/* Header with Avatar & Info */}
      <div className="flex items-center gap-3">
        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 relative ${
            data.isGovernment
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
          }`}
        >
          {data.isGovernment ? (
            /* Official Building Icon */
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4" />
            </svg>
          ) : (
            /* User with WhatsApp Verified Badge */
            <>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#25D366] text-white flex items-center justify-center text-[9px] font-bold border-2 border-white shadow-2xs">
                ✓
              </span>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
            {data.badge}
          </span>
          <h4 className="text-sm font-bold text-slate-900 truncate mt-0.5">{data.title}</h4>
          <span className="text-xs text-slate-500 truncate block mt-0.5">
            {data.isTalking ? (
              <span className="text-[#0C493C] font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                Interviniendo...
              </span>
            ) : (
              data.subtitle
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentNodeComponent({ data }: { data: AgentNodeData }) {
  const theme = data.theme || AGENT_THEMES[data.agentId] || AGENT_THEMES.ventas;

  return (
    <div
      style={{
        width: 250,
        borderColor: data.isTalking ? theme.primary : '#E2E8F0',
        boxShadow: data.isTalking
          ? `0 0 0 4px ${theme.ring}, 0 10px 15px -3px rgba(0,0,0,0.08)`
          : undefined,
      }}
      className={`rounded-2xl p-3 bg-white border-2 transition-all duration-300 relative select-none ${
        data.isTalking ? 'scale-[1.03] shadow-md' : 'shadow-xs'
      }`}
    >
      {/* Invisible Handles positioned cleanly outside the card boundary to the left and right */}
      <Handle type="target" position={Position.Left} id="agent-left-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ left: '-18px', top: '38%' }} />
      <Handle type="source" position={Position.Left} id="agent-left-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ left: '-18px', top: '62%' }} />
      <Handle type="source" position={Position.Right} id="agent-right-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ right: '-12px', top: '38%' }} />
      <Handle type="target" position={Position.Right} id="agent-right-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ right: '-12px', top: '62%' }} />
      <Handle type="target" position={Position.Top} id="agent-top-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ top: '-8px' }} />
      <Handle type="source" position={Position.Bottom} id="agent-bottom-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ bottom: '-8px' }} />
      <Handle type="source" position={Position.Top} id="agent-top-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ top: '-8px', left: '65%' }} />
      <Handle type="target" position={Position.Bottom} id="agent-bottom-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ bottom: '-8px', left: '35%' }} />

      {/* Compact mascot and agent info with unique colors */}
      <div className="flex items-center gap-3">
        <div
          style={{ backgroundColor: theme.light, borderColor: theme.border }}
          className="w-11 h-11 rounded-xl border flex items-center justify-center p-1 flex-shrink-0 overflow-hidden shadow-2xs"
        >
          <img src={data.image} alt={data.name} className="w-full h-full object-contain mix-blend-multiply" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center justify-between gap-1">
            <span
              style={{ color: theme.primary }}
              className="text-[11px] font-mono font-bold uppercase tracking-wider"
            >
              {data.tag}
            </span>
            <span
              style={{ backgroundColor: data.isActive ? theme.primary : '#CBD5E1' }}
              className="w-2 h-2 rounded-full flex-shrink-0"
            />
          </div>
          <h4 className="text-sm font-bold text-slate-900 truncate mt-0.5">{data.name}</h4>
          <span className="text-xs text-slate-500 font-medium truncate block mt-0.5">
            {data.isTalking ? (
              <span style={{ color: theme.primary }} className="font-semibold flex items-center gap-1">
                <span
                  style={{ backgroundColor: theme.primary }}
                  className="w-1.5 h-1.5 rounded-full"
                />
                Procesando...
              </span>
            ) : data.isActive ? (
              'En línea · Activo'
            ) : (
              'En espera'
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function OwnerNodeComponent({ data }: { data: OwnerNodeData }) {
  return (
    <div
      style={{ width: 250 }}
      className={`bg-white rounded-2xl p-3.5 shadow-sm border-2 transition-all duration-300 relative select-none ${
        data.isTalking
          ? 'border-[#0C493C] ring-4 ring-[#0C493C]/20 shadow-md scale-[1.02]'
          : 'border-slate-200 hover:border-emerald-300'
      }`}
    >
      {/* Invisible Handles so no dots or ports stick out */}
      <Handle type="target" position={Position.Left} id="owner-left-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ left: '-18px', top: '38%' }} />
      <Handle type="source" position={Position.Left} id="owner-left-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ left: '-18px', top: '62%' }} />
      {/* Vertical Handles for Mobile */}
      <Handle type="target" position={Position.Top} id="owner-top-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ top: '-10px', left: '50%' }} />
      <Handle type="source" position={Position.Top} id="owner-top-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ top: '-10px', left: '70%' }} />
      <Handle type="source" position={Position.Right} id="owner-right-out" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ right: '-16px', top: '50%' }} />
      <Handle type="target" position={Position.Right} id="owner-right-in" className="opacity-0 !w-1 !h-1 !border-none pointer-events-none" style={{ right: '-16px', top: '50%' }} />

      {/* Header with Enterprise Icon */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#0C493C] text-white flex items-center justify-center flex-shrink-0 relative shadow-xs">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#25D366] border-2 border-white shadow-2xs" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
            {data.badge}
          </span>
          <h4 className="text-sm font-bold text-slate-900 truncate mt-0.5">{data.title}</h4>
          <span className="text-xs text-slate-500 truncate block mt-0.5">
            {data.isTalking ? (
              <span className="text-[#0C493C] font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                Actualización en caja
              </span>
            ) : (
              data.subtitle
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Scenarios Configuration (Auto-looping live collaboration)
// ---------------------------------------------------------
const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'invoice',
    title: 'De venta a factura',
    tag: 'Ventas y SUNAT',
    subtitle: 'Ventas coordina y Facturas emite ante SUNAT',
    activeAgents: ['ventas', 'facturas'],
    actor: {
      title: 'Cliente final',
      badge: 'WHATSAPP · CLIENTE',
      subtitle: 'Comprador verificado',
      isGovernment: false,
    },
    steps: [
      {
        from: 'client',
        to: 'ventas',
        sourceHandle: 'client-out',
        targetHandle: 'agent-left-in',
        edgeLabel: '1. Confirmación de compra',
        fromLabel: 'Cliente final',
        toLabel: 'Ventas',
        message: 'Listo, confirmo la compra por WhatsApp por S/ 8,450.',
      },
      {
        from: 'ventas',
        to: 'facturas',
        sourceHandle: 'agent-bottom-out',
        targetHandle: 'agent-top-in',
        edgeLabel: '2. Coordinación directa entre agentes',
        fromLabel: 'Ventas',
        toLabel: 'Facturas',
        message: 'Venta confirmada por S/ 8,450. Te paso los datos para emitir.',
      },
      {
        from: 'facturas',
        to: 'client',
        sourceHandle: 'agent-left-out',
        targetHandle: 'client-in',
        edgeLabel: '3. Envío de PDF y XML oficial',
        fromLabel: 'Facturas',
        toLabel: 'Cliente final',
        message: '¡Listo! Tu factura electrónica PDF + XML ya fue generada ante SUNAT.',
      },
      {
        from: 'facturas',
        to: 'owner',
        sourceHandle: 'agent-right-out',
        targetHandle: 'owner-left-in',
        edgeLabel: '4. Sincronización en caja',
        fromLabel: 'Facturas',
        toLabel: 'Tu empresa',
        message: 'Comprobante F001-0428 emitido y sincronizado en tu caja.',
      },
    ],
  },
  {
    id: 'lead',
    title: 'Nuevo lead',
    tag: 'Captación comercial',
    subtitle: 'Ventas responde catálogo y avisa a gerencia',
    activeAgents: ['ventas'],
    actor: {
      title: 'Cliente final',
      badge: 'WHATSAPP · PROSPECTO',
      subtitle: 'Nuevo contacto comercial',
      isGovernment: false,
    },
    steps: [
      {
        from: 'client',
        to: 'ventas',
        sourceHandle: 'client-out',
        targetHandle: 'agent-left-in',
        edgeLabel: '1. Consulta de catálogo',
        fromLabel: 'Cliente final',
        toLabel: 'Ventas',
        message: 'Hola, ¿me cuentas qué servicios tienen y precios?',
      },
      {
        from: 'ventas',
        to: 'client',
        sourceHandle: 'agent-left-out',
        targetHandle: 'client-in',
        edgeLabel: '2. Envío de opciones y cotización',
        fromLabel: 'Ventas',
        toLabel: 'Cliente final',
        message: '¡Hola! Te comparto nuestro catálogo y opciones disponibles.',
      },
      {
        from: 'ventas',
        to: 'owner',
        sourceHandle: 'agent-right-out',
        targetHandle: 'owner-left-in',
        edgeLabel: '3. Alerta de cliente calificado',
        fromLabel: 'Ventas',
        toLabel: 'Tu empresa',
        message: 'Nuevo cliente interesado en una cotización formal.',
      },
      {
        from: 'owner',
        to: 'ventas',
        sourceHandle: 'owner-left-out',
        targetHandle: 'agent-right-in',
        edgeLabel: '4. Aprobación y seguimiento',
        fromLabel: 'Tu empresa',
        toLabel: 'Ventas',
        message: 'Perfecto, envíale la propuesta y haz seguimiento.',
      },
    ],
  },
  {
    id: 'invoiceSolo',
    title: 'Emitir factura',
    tag: 'SUNAT directa',
    subtitle: 'Cliente envía datos y recibe PDF y XML',
    activeAgents: ['facturas'],
    actor: {
      title: 'Cliente final',
      badge: 'WHATSAPP · CLIENTE',
      subtitle: 'Datos de facturación',
      isGovernment: false,
    },
    steps: [
      {
        from: 'client',
        to: 'facturas',
        sourceHandle: 'client-out',
        targetHandle: 'agent-left-in',
        edgeLabel: '1. Datos de RUC por mensaje',
        fromLabel: 'Cliente final',
        toLabel: 'Facturas',
        message: 'Te envío los datos para mi factura: RUC 20601234567.',
      },
      {
        from: 'facturas',
        to: 'client',
        sourceHandle: 'agent-left-out',
        targetHandle: 'client-in',
        edgeLabel: '2. Emisión legal en SUNAT',
        fromLabel: 'Facturas',
        toLabel: 'Cliente final',
        message: 'Recibí los datos. Tu comprobante F001-0428 fue validado en SUNAT.',
      },
      {
        from: 'facturas',
        to: 'owner',
        sourceHandle: 'agent-right-out',
        targetHandle: 'owner-left-in',
        edgeLabel: '3. Registro en contabilidad',
        fromLabel: 'Facturas',
        toLabel: 'Tu empresa',
        message: 'Comprobante emitido con éxito y registrado en tu reporte.',
      },
    ],
  },
  {
    id: 'opportunity',
    title: 'Oportunidad pública',
    tag: 'SEACE / Gob.pe',
    subtitle: 'Licitaciones alerta de compras del Estado',
    activeAgents: ['licitaciones'],
    actor: {
      title: 'SEACE / Gob.pe',
      badge: 'COMPRAS DEL ESTADO',
      subtitle: 'Portal de Contrataciones Públicas',
      isGovernment: true,
    },
    steps: [
      {
        from: 'client',
        to: 'licitaciones',
        sourceHandle: 'client-out',
        targetHandle: 'agent-left-in',
        edgeLabel: '1. Detección de convocatoria',
        fromLabel: 'SEACE / Gob.pe',
        toLabel: 'Licitaciones',
        message: 'Nueva convocatoria de obra pública en Cusco por S/ 1,240,500.',
      },
      {
        from: 'licitaciones',
        to: 'owner',
        sourceHandle: 'agent-right-out',
        targetHandle: 'owner-left-in',
        edgeLabel: '2. Filtro según RNP de tu empresa',
        fromLabel: 'Licitaciones',
        toLabel: 'Tu empresa',
        message: 'Encontré una oportunidad que coincide 100% con tu RNP y rubro.',
      },
      {
        from: 'owner',
        to: 'licitaciones',
        sourceHandle: 'owner-left-out',
        targetHandle: 'agent-right-in',
        edgeLabel: '3. Descarga de bases en PDF',
        fromLabel: 'Tu empresa',
        toLabel: 'Licitaciones',
        message: 'Descarga las bases en PDF y agenda el plazo de postulación.',
      },
    ],
  },
];

// ---------------------------------------------------------
// Metadata for each Agent
// ---------------------------------------------------------
const AGENT_METADATA: Record<string, { name: string; tag: string; image: string; defaultMsg: string }> = {
  ventas: {
    name: 'Agente de Ventas',
    tag: 'COMERCIAL 24/7',
    image: '/assets/gato-ventas-light.svg',
    defaultMsg: 'Coordinando pedido con cliente...',
  },
  facturas: {
    name: 'Agente de Facturas',
    tag: 'SUNAT ELECTRÓNICA',
    image: '/assets/gato-facturas-light.svg',
    defaultMsg: 'Listo para emitir comprobantes SUNAT...',
  },
  licitaciones: {
    name: 'Agente de Licitaciones',
    tag: 'SEACE / GOB.PE',
    image: '/assets/gato-licitaciones-light.svg',
    defaultMsg: 'Monitoreando compras públicas...',
  },
};

// Generates exclusively the nodes participating in the active scenario
function getNodesForScenario(scenario: ScenarioConfig, isMobile: boolean = false): Node[] {
  const agentCount = scenario.activeAgents.length;

  if (isMobile) {
    // Vertical Layout for Mobile:
    // Centered at x: 25, width: 250px
    const clientY = 46;
    const agentYPositions = agentCount === 1 ? [185] : [176, 298];
    const ownerY = agentCount === 1 ? 316 : 420;

    const agentNodes: Node[] = scenario.activeAgents.map((agentId, index) => {
      const meta = AGENT_METADATA[agentId] || {
        name: `Agente ${agentId}`,
        tag: 'ASISTENTE',
        image: '/assets/gato-ventas-light.svg',
        defaultMsg: 'Listo en línea',
      };
      const theme = AGENT_THEMES[agentId] || AGENT_THEMES.ventas;
      return {
        id: agentId,
        type: 'agentNode',
        position: { x: 25, y: agentYPositions[index] ?? 176 },
        initialWidth: 250,
        initialHeight: 74,
        style: { width: 250 },
        data: {
          agentId: agentId as 'ventas' | 'facturas' | 'licitaciones',
          theme,
          name: meta.name,
          tag: meta.tag,
          image: meta.image,
          message: meta.defaultMsg,
          isActive: true,
          isTalking: false,
          isNewMessage: false,
        },
      };
    });

    const clientNode: Node = {
      id: 'client',
      type: 'clientNode',
      position: { x: 25, y: clientY },
      initialWidth: 250,
      initialHeight: 82,
      style: { width: 250 },
      data: {
        title: scenario.actor.title,
        badge: scenario.actor.badge,
        subtitle: scenario.actor.subtitle,
        isGovernment: scenario.actor.isGovernment,
        message: scenario.steps[0]?.message || '',
        time: '10:42 a. m.',
        isTalking: true,
        isNewMessage: true,
      },
    };

    const ownerNode: Node = {
      id: 'owner',
      type: 'ownerNode',
      position: { x: 25, y: ownerY },
      initialWidth: 250,
      initialHeight: 82,
      style: { width: 250 },
      data: {
        title: 'Tu empresa',
        badge: 'GERENCIA & CAJA',
        subtitle: 'Tu WhatsApp · Supervisión',
        message: 'Conectado · Supervisando en tiempo real',
        time: '10:42 a. m.',
        isTalking: false,
        isNewMessage: false,
      },
    };

    return [clientNode, ...agentNodes, ownerNode];
  }

  // Horizontal Layout for Desktop
  let agentYPositions: number[] = [];
  if (agentCount === 1) {
    agentYPositions = [150];
  } else if (agentCount === 2) {
    agentYPositions = [75, 225];
  } else {
    agentYPositions = [25, 145, 265];
  }

  const agentNodes: Node[] = scenario.activeAgents.map((agentId, index) => {
    const meta = AGENT_METADATA[agentId] || {
      name: `Agente ${agentId}`,
      tag: 'ASISTENTE',
      image: '/assets/gato-ventas-light.svg',
      defaultMsg: 'Listo en línea',
    };
    const theme = AGENT_THEMES[agentId] || AGENT_THEMES.ventas;
    return {
      id: agentId,
      type: 'agentNode',
      position: { x: 355, y: agentYPositions[index] ?? 150 },
      initialWidth: 250,
      initialHeight: 74,
      style: { width: 250 },
      data: {
        agentId: agentId as 'ventas' | 'facturas' | 'licitaciones',
        theme,
        name: meta.name,
        tag: meta.tag,
        image: meta.image,
        message: meta.defaultMsg,
        isActive: true,
        isTalking: false,
        isNewMessage: false,
      },
    };
  });

  const clientNode: Node = {
    id: 'client',
    type: 'clientNode',
    position: { x: 35, y: 150 },
    initialWidth: 250,
    initialHeight: 82,
    style: { width: 250 },
    data: {
      title: scenario.actor.title,
      badge: scenario.actor.badge,
      subtitle: scenario.actor.subtitle,
      isGovernment: scenario.actor.isGovernment,
      message: scenario.steps[0]?.message || '',
      time: '10:42 a. m.',
      isTalking: true,
      isNewMessage: true,
    },
  };

  const ownerNode: Node = {
    id: 'owner',
    type: 'ownerNode',
    position: { x: 685, y: 150 },
    initialWidth: 250,
    initialHeight: 82,
    style: { width: 250 },
    data: {
      title: 'Tu empresa',
      badge: 'GERENCIA & CAJA',
      subtitle: 'Tu WhatsApp · Supervisión',
      message: 'Conectado · Supervisando en tiempo real',
      time: '10:42 a. m.',
      isTalking: false,
      isNewMessage: false,
    },
  };

  return [clientNode, ...agentNodes, ownerNode];
}

function getInitialEdges(isMobile: boolean = false): Edge[] {
  return [
    {
      id: 'step-edge-0',
      source: 'client',
      target: 'ventas',
      sourceHandle: isMobile ? 'client-bottom-out' : 'client-out',
      targetHandle: isMobile ? 'agent-top-in' : 'agent-left-in',
      type: 'default',
      animated: true,
      style: { stroke: '#9B4A42', strokeWidth: 2.6 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#9B4A42' },
    },
  ];
}

const INITIAL_NODES: Node[] = getNodesForScenario(SCENARIOS[0], false);
const INITIAL_EDGES: Edge[] = getInitialEdges(false);

function getLabelColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('venta')) return AGENT_THEMES.ventas.primary; // #9B4A42
  if (l.includes('factura')) return AGENT_THEMES.facturas.primary; // #2B5C7F
  if (l.includes('licita')) return AGENT_THEMES.licitaciones.primary; // #1E5E4E
  if (l.includes('empresa') || l.includes('gerencia')) return '#0C493C';
  return '#334155';
}

function getStepAgentTheme(step: FlowStep): AgentTheme {
  const involved = AGENT_THEMES[step.to] ? step.to : (AGENT_THEMES[step.from] ? step.from : null);
  return involved ? AGENT_THEMES[involved] : AGENT_THEMES.ventas;
}

function getStepHandles(step: FlowStep, isMobile: boolean): { sourceHandle: string; targetHandle: string } {
  if (!isMobile) {
    return { sourceHandle: step.sourceHandle, targetHandle: step.targetHandle };
  }
  // Mobile vertical routing
  if (step.from === 'client' && step.to !== 'client') {
    return { sourceHandle: 'client-bottom-out', targetHandle: 'agent-top-in' };
  }
  if (step.from !== 'client' && step.to === 'client') {
    return { sourceHandle: 'agent-left-out', targetHandle: 'client-left-in' };
  }
  if (step.from !== 'owner' && step.to === 'owner') {
    return { sourceHandle: 'agent-bottom-out', targetHandle: 'owner-top-in' };
  }
  if (step.from === 'owner' && step.to !== 'owner') {
    return { sourceHandle: 'owner-right-out', targetHandle: 'agent-right-in' };
  }
  // Agent to Agent (e.g. ventas -> facturas)
  return { sourceHandle: 'agent-bottom-out', targetHandle: 'agent-top-in' };
}

// ---------------------------------------------------------
// Main AgentFlowDemo Component (Live Auto-Cycling)
// ---------------------------------------------------------
export default function AgentFlowDemo() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('invoice');
  const [runToken, setRunToken] = useState<number>(0);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [timelineChips, setTimelineChips] = useState<Array<{ fromLabel: string; toLabel: string; message: string }>>([
    {
      fromLabel: 'Cliente final',
      toLabel: 'Ventas',
      message: 'Listo, confirmo la compra por WhatsApp por S/ 8,450.',
    },
  ]);
  const [statusText, setStatusText] = useState<string>('Simulación en vivo activa');

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

  const activeScenario = useMemo(
    () => SCENARIOS.find((s) => s.id === selectedScenarioId) || SCENARIOS[0],
    [selectedScenarioId]
  );

  const nodeTypes = useMemo(
    () => ({
      clientNode: ClientNodeComponent,
      agentNode: AgentNodeComponent,
      ownerNode: OwnerNodeComponent,
    }),
    []
  );

  const sequenceRunId = useRef<number>(0);

  // Switch scenario manually
  const handleSelectScenario = useCallback((id: string) => {
    setSelectedScenarioId(id);
    setRunToken((prev) => prev + 1);
  }, []);

  // Replay current scenario
  const handleReplay = useCallback(() => {
    setRunToken((prev) => prev + 1);
  }, []);

  // Main execution loop: plays the steps and automatically loops continuously
  useEffect(() => {
    sequenceRunId.current += 1;
    const currentRun = sequenceRunId.current;
    let isCancelled = false;

    // Reset initial state for scenario
    setEdges([]);
    setTimelineChips([]);
    setActiveStepIndex(0);
    setStatusText(`Simulando: ${activeScenario.title}`);

    // Generate only participating nodes for this scenario
    const initialScenarioNodes = getNodesForScenario(activeScenario, isMobile);
    setNodes(initialScenarioNodes);

    async function runContinuousFlow() {
      // Loop through all steps in the active scenario
      for (let i = 0; i < activeScenario.steps.length; i++) {
        if (isCancelled || currentRun !== sequenceRunId.current) return;
        const step = activeScenario.steps[i];
        setActiveStepIndex(i);
        setStatusText(`Paso ${i + 1} de ${activeScenario.steps.length}: ${step.fromLabel} → ${step.toLabel}`);

        // Determine edge color based on the involved agent's theme
        const involvedAgent = AGENT_THEMES[step.to] ? step.to : (AGENT_THEMES[step.from] ? step.from : null);
        const stepTheme = involvedAgent ? AGENT_THEMES[involvedAgent] : AGENT_THEMES.ventas;
        const edgeColor = stepTheme.primary;
        const handles = getStepHandles(step, isMobile);

        // Build active animated edge
        const activeEdge: Edge = {
          id: `step-edge-${i}-${currentRun}`,
          source: step.from,
          target: step.to,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          type: 'default',
          animated: true,
          style: {
            stroke: edgeColor,
            strokeWidth: 2.6,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: edgeColor,
          },
        };

        // Add active edge and dim previous ones
        setEdges((prev) => [
          ...prev.map((e) => ({
            ...e,
            animated: false,
            style: { stroke: '#CBD5E1', strokeWidth: 1.5, opacity: 0.4 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#CBD5E1' },
          })),
          activeEdge,
        ]);

        // Highlight sender and receiver with real messages
        setNodes((prevNodes) =>
          prevNodes.map((n) => {
            const isSender = n.id === step.from;
            const isReceiver = n.id === step.to;

            if (isReceiver) {
              return {
                ...n,
                data: {
                  ...n.data,
                  isTalking: true,
                  isNewMessage: true,
                  message: step.message,
                  time: 'Ahora',
                },
              };
            }
            if (isSender) {
              return {
                ...n,
                data: {
                  ...n.data,
                  isTalking: true,
                  isNewMessage: false,
                },
              };
            }
            return {
              ...n,
              data: {
                ...n.data,
                isTalking: false,
                isNewMessage: false,
              },
            };
          })
        );

        // Add to timeline
        setTimelineChips((prev) => [
          ...prev,
          {
            fromLabel: step.fromLabel,
            toLabel: step.toLabel,
            message: step.message,
          },
        ]);

        // Stay on step for 1800ms to allow reading
        await new Promise((r) => setTimeout(r, 1800));
        if (isCancelled || currentRun !== sequenceRunId.current) return;
      }

      // Finish current scenario
      setStatusText('Recorrido completado · Repitiendo en 3s...');
      setNodes((prevNodes) =>
        prevNodes.map((n) => ({
          ...n,
          data: {
            ...n.data,
            isTalking: false,
            isNewMessage: false,
          },
        }))
      );

      // Wait 3.5 seconds before auto-cycling to next scenario
      await new Promise((r) => setTimeout(r, 3500));
      if (isCancelled || currentRun !== sequenceRunId.current) return;

      const currentIdx = SCENARIOS.findIndex((s) => s.id === selectedScenarioId);
      const nextIdx = (currentIdx + 1) % SCENARIOS.length;
      setSelectedScenarioId(SCENARIOS[nextIdx].id);
      setRunToken((prev) => prev + 1);
    }

    runContinuousFlow();

    return () => {
      isCancelled = true;
    };
  }, [selectedScenarioId, runToken, activeScenario, isMobile, setNodes, setEdges]);

  const boardHeight = isMobile ? (activeScenario.activeAgents.length > 1 ? 550 : 440) : 420;

  return (
    <div className="w-full space-y-6">
      {/* Scenario Buttons Toolbar - All buttons are free to click anytime */}
      <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Elegir caso de colaboración">
        {SCENARIOS.map((scenario) => {
          const isSelected = scenario.id === selectedScenarioId;
          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => handleSelectScenario(scenario.id)}
              className={`px-4 py-2.5 rounded-xl border transition-all duration-200 text-left cursor-pointer flex-1 sm:flex-none min-w-[150px] ${
                isSelected
                  ? 'bg-[#0C493C] text-white border-[#0C493C] shadow-sm'
                  : 'bg-white text-slate-800 border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs sm:text-sm font-bold block">{scenario.title}</span>
              </div>
              <small
                className={`block text-xs mt-0.5 truncate ${
                  isSelected ? 'text-emerald-100' : 'text-slate-400'
                }`}
              >
                {scenario.subtitle}
              </small>
            </button>
          );
        })}

        {/* Replay Button */}
        <button
          type="button"
          onClick={handleReplay}
          className="ml-auto px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-emerald-300 text-xs sm:text-sm font-semibold text-slate-700 transition-all cursor-pointer flex items-center gap-1.5"
        >
          <span>Repetir</span>
          <span aria-hidden="true">↺</span>
        </button>
      </div>

      {/* React Flow Board Container with guaranteed explicit height & styling */}
      <div
        style={{ width: '100%', height: boardHeight }}
        className="relative rounded-2xl border border-slate-200 bg-[#FAFBF9] overflow-hidden shadow-xs transition-[height] duration-300"
      >
        <ReactFlow
          key={`${selectedScenarioId}-${isMobile ? 'mobile' : 'desktop'}`}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: isMobile ? 0.08 : 0.14 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#CCD6D0" />
        </ReactFlow>

        {/* Floating live status badge in top corner */}
        <div className="absolute top-2.5 right-2.5 sm:top-3.5 sm:right-4 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-full bg-white/95 backdrop-blur-xs border border-emerald-200 text-xs font-semibold text-[#0C493C] shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-[#25D366] shrink-0" />
            <span className="text-[11px] sm:text-xs font-mono uppercase max-w-[200px] sm:max-w-none truncate">{statusText}</span>
          </span>
        </div>
      </div>

      {/* Real-time Message Timeline Stream - Progressive Arrival Pipeline */}
      <div className="pt-4 border-t border-slate-200 space-y-3">
        <style>{`
          @keyframes mlMessageArrival {
            0% {
              opacity: 0;
              transform: translateY(14px) scale(0.96);
            }
            60% {
              opacity: 1;
              transform: translateY(-2px) scale(1.01);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          .animate-message-arrival {
            animation: mlMessageArrival 0.38s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
        `}</style>

        {/* Timeline Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#25D366]" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0C493C]">
              MENSAJES TRANSFERIDOS EN LA SIMULACIÓN:
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
              {Math.min(timelineChips.length, activeScenario.steps.length)} de {activeScenario.steps.length} en vivo
            </span>
          </div>
        </div>

        {/* Grid of Step Message Cards */}
        <div
          className={`grid gap-3 ${
            activeScenario.steps.length === 3
              ? 'grid-cols-1 sm:grid-cols-3'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
          }`}
        >
          {activeScenario.steps.map((step, idx) => {
            const isArrived = idx < timelineChips.length;
            const isLatest = idx === timelineChips.length - 1;

            if (!isArrived) {
              // Awaiting step placeholder
              return (
                <div
                  key={`pending-${idx}`}
                  className="rounded-xl p-3.5 border-2 border-dashed border-slate-200/90 bg-slate-50/50 flex flex-col justify-between min-h-[118px] opacity-40 select-none transition-opacity duration-300"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-mono font-bold text-slate-400 uppercase">
                      Paso {idx + 1}
                    </span>
                    <span className="text-xs text-slate-400 font-medium truncate">
                      {step.fromLabel} → {step.toLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 italic my-auto">Esperando transferencia...</p>
                  <div className="flex items-center justify-between text-xs text-slate-400 font-mono pt-1.5 border-t border-dashed border-slate-200">
                    <span className="truncate">{step.edgeLabel.replace(/^\d+\.\s*/, '')}</span>
                    <span>Pendiente</span>
                  </div>
                </div>
              );
            }

            // Arrived Message Card with arrival animation and unique agent colors
            const stepTheme = getStepAgentTheme(step);

            return (
              <div
                key={`arrived-${idx}-${selectedScenarioId}`}
                className={`animate-message-arrival rounded-xl p-3.5 border transition-all duration-300 flex flex-col justify-between min-h-[118px] bg-white ${
                  isLatest ? 'scale-[1.01]' : 'border-slate-200/90 shadow-2xs hover:border-slate-300'
                }`}
                style={{
                  borderColor: isLatest ? stepTheme.primary : undefined,
                  boxShadow: isLatest ? `0 0 0 3px ${stepTheme.ring}, 0 4px 6px -1px rgba(0,0,0,0.05)` : undefined,
                }}
              >
                {/* Header: Step & Route */}
                <div className="flex items-center justify-between gap-1.5 mb-2 pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-mono font-bold shrink-0 text-white"
                      style={{
                        backgroundColor: isLatest ? stepTheme.primary : '#94A3B8',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className="text-xs font-bold truncate"
                      style={{ color: getLabelColor(step.fromLabel) }}
                    >
                      {step.fromLabel}
                    </span>
                    <span className="text-slate-400 text-xs shrink-0">→</span>
                    <span
                      className="text-xs font-bold truncate"
                      style={{ color: getLabelColor(step.toLabel) }}
                    >
                      {step.toLabel}
                    </span>
                  </div>

                  {isLatest ? (
                    <span
                      className="px-1.5 py-0.5 rounded text-[11px] font-bold text-white flex items-center gap-1 shrink-0"
                      style={{ backgroundColor: stepTheme.primary }}
                    >
                      EN VIVO
                    </span>
                  ) : (
                    <span
                      className="text-xs font-bold shrink-0"
                      style={{ color: stepTheme.primary }}
                    >
                      ✓✓
                    </span>
                  )}
                </div>

                {/* Message Speech Bubble */}
                <div
                  className="p-2.5 rounded-xl text-xs leading-relaxed transition-all duration-300"
                  style={{
                    backgroundColor: isLatest ? stepTheme.light : '#F8FAFC',
                    borderColor: isLatest ? stepTheme.border : '#E2E8F0',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    color: '#0F172A',
                  }}
                >
                  <p className="line-clamp-3">«{step.message}»</p>
                </div>

                {/* Footer: Action Label & Delivery Time */}
                <div className="mt-2.5 pt-1.5 flex items-center justify-between text-xs text-slate-400 font-mono border-t border-slate-100/80">
                  <span
                    className="truncate font-medium"
                    style={{ color: stepTheme.primary }}
                  >
                    {step.edgeLabel.replace(/^\d+\.\s*/, '')}
                  </span>
                  <span>{isLatest ? 'Ahora' : 'Entregado'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
