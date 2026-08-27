# 🐱 MeowLab — Agencia de Agentes de IA en WhatsApp para Empresas

![MeowLab Banner](public/meow-logo.svg)

> **El Laboratorio de Fuerza Laboral de Inteligencia Artificial para WhatsApp.**  
> Automatización de facturación electrónica (BillCat), calificación de prospectos/SDR (HunterCat), cobranzas automáticas (PawsCollect) y agentes dedicados conectados de forma privada a bases de datos y ERPs (PostgreSQL, SAP, Salesforce).

---

## 🎨 Paleta de Color & Identidad (Regla 60 - 30 - 10)

- **60% Dominante:** `#0a0929` (Obsidian Navy Midnight) & superficies `#12103f`.
- **30% Estructura y Contraste:** `#ffffff` (Blanco Puro) / `#f8fafc` & slate `#94a3b8`.
- **10% Acento Vibrante:** `#c1ff72` (Electric Neon Cat Lime / Whiskers Glow) para botones de acción, estados de conexión 24/7 y badges.
- **Tipografías:**
  - **Títulos y Cabeceras:** `Blinker` (pesos 300, 400, 600, 700, 800, 900)
  - **Cuerpo y Lectura:** `Actor` (Regular)

---

## 🚀 Modelos de Agentes

### 1. Agentes Dedicados (Enterprise On-Prem / Cloud Privado)
- Conexión directa y privada a tus bases de datos internas (PostgreSQL, MySQL, SQL Server) y ERPs (SAP, Odoo, Oracle).
- Entorno aislado en tu propia VPC con cifrado de nivel bancario.
- Flujos de negocio a la medida y auditoría completa.

### 2. Agentes de Servicio (Micro-SaaS On-Demand en WhatsApp)
- **⚡ BillCat (Facturador Electrónica):** Múltiples empresas le envían audios o fotos y emite facturas oficiales con PDF y XML ante entidades tributarias en menos de 2 segundos.
- **🎯 HunterCat (SDR Leads):** Calificación BANT automática y agendamiento en Google Calendar / Outlook.
- **💳 PawsCollect (Cobranzas):** Recordatorios amables y links de pago directos (Stripe, Yape, Plin, MercadoPago).
- **🐾 WhiskerCare (Soporte 24/7):** Resolución de preguntas frecuentes y derivación inteligente.
- **📅 BookCat (Citas y Reservas):** Gestión de disponibilidad y confirmaciones automáticas.

---

## 🛠️ Stack Tecnológico

- **Framework:** [Astro 5](https://astro.build/) con **View Transitions API** (`ClientRouter`) para navegación fluida de SPA.
- **Estilos:** Tailwind CSS con tokens y tipografías personalizadas (`Blinker` + `Actor`).
- **Simulador Interactivo:** Widget de WhatsApp multimodelo con transcripción y generación de facturas simuladas.
- **Efectos de Audio:** Sintetizador felino Web Audio API (*Modo Ronroneo 🐱*).
- **Despliegue:** 100% estático / Docker / VPS con Nginx o Caddy.

---

## 💻 Desarrollo Local

```bash
# Instalar dependencias con pnpm
pnpm install

# Iniciar servidor de desarrollo
pnpm dev

# Compilar para producción
pnpm build

# Previsualizar compilación local
pnpm preview
```

---

## 🌐 Guía de Despliegue en VPS para Codex / CI-CD

Para desplegar este proyecto en tu VPS con Nginx / Docker:

### Opción A: Despliegue con Nginx (Archivos Estáticos en `dist/`)
```bash
# 1. Clonar el repositorio
git clone https://github.com/DiogoFabricioAG/meowlab.git /var/www/meowlab
cd /var/www/meowlab

# 2. Instalar y compilar
pnpm install
pnpm build

# 3. Configurar Nginx para servir /var/www/meowlab/dist
sudo ln -sf /var/www/meowlab/dist /var/www/html/meowlab
sudo systemctl reload nginx
```

### Opción B: Despliegue con Docker & Node / Caddy
```bash
# Compilar imagen y levantar
docker build -t meowlab .
docker run -d -p 80:80 --name meowlab-site meowlab
```

---

## 🔑 Nota para Codex: Conexión SSH y VPS
- Las llaves SSH para el despliegue automático hacia tu VPS están localizadas en `D:\ssh-keys\` o en `C:\Users\Diogo\.ssh\`.
- Al sincronizar con GitHub, el repositorio público es: `https://github.com/DiogoFabricioAG/meowlab.git`.

---

© 2026 **MeowLab**. Todos los derechos reservados.
