"""Source-backed requirements, document drafts and exports for a selected tender."""
import hashlib
import io
import json
import os
import re
import zipfile
from decimal import Decimal, InvalidOperation

import httpx
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .workspace import WebOpportunity, account, get_db, router
from .workspace_bases import require_bases
from .preparation import PreparationJob, job_id, memory_for
from .security import read_secret


def stable_id(*parts):
    return hashlib.sha256('|'.join(str(p) for p in parts).encode()).hexdigest()


def number_to_spanish_words(num):
    units = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"]
    teens = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"]
    tens = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"]
    hundreds = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"]

    if num == 0:
        return "CERO"
    if num == 100:
        return "CIEN"

    def convert_hundreds(n):
        if n == 0:
            return ""
        if n == 100:
            return "CIEN"
        h = n // 100
        rem = n % 100
        h_str = hundreds[h]
        if rem == 0:
            return h_str
        if rem < 10:
            t_str = units[rem]
        elif rem < 20:
            t_str = teens[rem - 10]
        elif rem == 20:
            t_str = "VEINTE"
        elif rem < 30:
            t_str = "VEINTI" + units[rem - 20]
        else:
            t_str = tens[rem // 10]
            if rem % 10 != 0:
                t_str += " Y " + units[rem % 10]
        return (h_str + " " + t_str).strip()

    if num < 1000:
        return convert_hundreds(num)
    if num < 1000000:
        thousands = num // 1000
        rem = num % 1000
        th_str = "MIL" if thousands == 1 else convert_hundreds(thousands) + " MIL"
        if rem == 0:
            return th_str
        return (th_str + " " + convert_hundreds(rem)).strip()
    millions = num // 1000000
    rem = num % 1000000
    m_str = "UN MILLÓN" if millions == 1 else convert_hundreds(millions) + " MILLONES"
    if rem == 0:
        return m_str
    if rem < 1000:
        return (m_str + " " + convert_hundreds(rem)).strip()
    thousands = rem // 1000
    sub_rem = rem % 1000
    th_str = "MIL" if thousands == 1 else convert_hundreds(thousands) + " MIL"
    if sub_rem == 0:
        return (m_str + " " + th_str).strip()
    return (m_str + " " + th_str + " " + convert_hundreds(sub_rem)).strip()


def amount_to_spanish_words(amount, currency="PEN"):
    try:
        val = float(amount)
    except (ValueError, TypeError):
        return "[MONTO EN LETRAS]"
    if val <= 0:
        return "[MONTO EN LETRAS]"
    int_val = int(val)
    dec_val = int(round((val - int_val) * 100))
    dec_str = f"{dec_val:02d}"
    words = number_to_spanish_words(int_val)
    cur_name = "DÓLARES AMERICANOS" if currency == "USD" else "SOLES"
    return f"{words} Y {dec_str}/100 {cur_name}"


def _clean_sentence(sentence):
    text = str(sentence or "").strip()
    if not text:
        return ""
    return text[0].upper() + text[1:]


def check_reason(stage, text=""):
    lower = f"{stage} {text}".lower()
    if "entrega / pago" in lower or "guía de remisión" in lower or "factura" in lower:
        return (
            "No se envía al postular, sino al entregar los bienes tras ganar la buena pro. "
            "Sin Guía de Remisión, copia de la Orden de Compra y Factura la entidad no da conformidad ni procesa el pago."
        )
    if "calificación" in lower or "experiencia" in lower:
        return (
            "Acredita la capacidad técnica o experiencia previa de tu empresa; "
            "el comité lo revisa para confirmar que puedes ejecutar el contrato."
        )
    if "contrato" in lower or "perfeccionamiento" in lower:
        return (
            "Se presenta únicamente si ganas la buena pro para formalizar la Orden de Compra o el contrato."
        )
    if "admisibilidad" in lower or "oferta" in lower or "cotización" in lower:
        return (
            "Obligatorio al postular para que tu oferta sea admitida y evaluada. "
            "Si falta algún dato o no respeta el formato requerido (moneda en Soles y totalidad de ítems), la propuesta queda descalificada."
        )
    return (
        "Exigencia directa de las bases del procedimiento; incluirlo correctamente evita observaciones o el rechazo de tu postulación."
    )


def document_reason(stage):
    lower = str(stage or "").lower()
    if "organización" in lower or "índice" in lower:
        return (
            "Ordena y folia toda tu propuesta (desde el folio 001) para que la entidad verifique "
            "de un vistazo que tu expediente de postulación está completo."
        )
    if "económica" in lower or "cotización" in lower:
        return (
            "Es la pieza central de tu oferta: fija el precio unitario, IGV y monto total en Soles. "
            "Si falta o tiene errores de cálculo, la propuesta queda descalificada."
        )
    if "técnico" in lower or "especificaciones" in lower:
        return (
            "Compromete formalmente a tu empresa a cumplir al 100% las especificaciones técnicas y "
            "calidad exigidas en las bases."
        )
    if "ejecución" in lower or "plazo" in lower or "garantía" in lower:
        return (
            "Garantiza que cumplirás el plazo de entrega y la garantía comercial exigida tras emitirse "
            "la Orden de Compra, evitando observaciones o penalidades."
        )
    return (
        "Requisito obligatorio de admisibilidad según las bases y la normativa de contratación pública. "
        "Sin esta declaración jurada la entidad no puede admitir tu oferta."
    )


def parse_check_structure(text):
    clean = str(text or "").strip()
    if not clean:
        return "", "Requisito obligatorio", [], None

    lower = clean.lower()
    title = ""
    stage = "Requisito obligatorio"
    details = []
    table_format = None

    if "guía de remisión" in lower or ("entrega" in lower and "factura" in lower):
        title = "Documentos de Entrega y Pago (Guía de Remisión, Orden de Compra y Factura)"
    elif "formulario de cotización" in lower and ("sección 3" in lower or "seccion 3" in lower):
        title = "Sección 3: Formulario de Cotización y Oferta Económica"
    else:
        m = re.match(r'^(La Sección \d+[^:;.]*|(?:ANEXO|Anexo)\s*N°?\s*\d+[^:;.]*|Formulario de [^:;.]*|Guía de [^:;.]*|Declaración Jurada [^:;.]*|Carta de [^:;.]*)', clean, re.I)
        if m:
            title = m.group(1).strip()
        else:
            first_part = re.split(r'[:;.]', clean)[0].strip()
            if len(first_part) > 78:
                trimmed = re.sub(r'\s+\S*$', '', first_part[:78]).strip()
                title = (trimmed or first_part[:78]) + "…"
            else:
                title = first_part if len(first_part) > 5 else clean

    if "entrega" in lower or "pago" in lower or "guía de remisión" in lower or "factura" in lower:
        stage = "Documento de Entrega / Pago"
    elif "calificación" in lower or "experiencia" in lower:
        stage = "Requisito de Calificación"
    elif "admisibilidad" in lower or "oferta" in lower or "cotización" in lower or "propuesta" in lower or "anexo" in lower:
        stage = "Obligatorio — Oferta / Admisibilidad"
    elif "contrato" in lower or "perfeccionamiento" in lower or "garantía de fiel" in lower:
        stage = "Perfeccionamiento de Contrato"

    if "tabla" in lower or "formulario de cotización" in lower or "cotizar la totalidad" in lower or "lista de bienes" in lower or "precios en soles" in lower:
        table_format = "Tabla requerida: Ítem, Descripción del bien, Unidad, Cantidad, Precio Unitario y Precio Total en Soles"
    elif "declaración jurada" in lower and ("datos" in lower or "anexo" in lower):
        table_format = "Formato oficial de Declaración Jurada con firma y datos del representante legal"

    sentences = [s.strip() for s in re.split(r'[;.\n]', clean) if len(s.strip()) > 8]
    for s in sentences:
        s_lower = s.lower()
        if "no de formatos reproducibles identificados" in s_lower:
            continue
        formatted = _clean_sentence(s)
        if formatted.lower() != title.lower() and formatted not in details:
            details.append(formatted)

    return title, stage, details, table_format


def generate_proposal_dossier(key, alert, requirements, user_quotes, business_mem):
    buyer = str(alert.get('buyer', 'Entidad Convocante')).strip()
    code = str(alert.get('code', 'Proceso de Selección')).strip()
    description = str(alert.get('description', 'Contratación pública')).strip()

    desktop = business_mem.get('desktopProfile', {}) if isinstance(business_mem, dict) else {}
    company_name = desktop.get('business_name') or (business_mem.get('description', '').split('\n')[0].strip() if isinstance(business_mem, dict) else '') or 'Ferretería El Maestro'
    company_ruc = desktop.get('ruc') or (business_mem.get('ruc') if isinstance(business_mem, dict) else '') or '[R.U.C. del postor]'
    legal_rep = desktop.get('representative') or (business_mem.get('representative') if isinstance(business_mem, dict) else '') or '[Representante Legal]'
    rep_dni = desktop.get('dni') or (business_mem.get('dni') if isinstance(business_mem, dict) else '') or '[DNI del representante]'
    legal_address = (business_mem.get('coverage') if isinstance(business_mem, dict) else '') or desktop.get('regions') or 'Lima, Perú'

    quote_map = {}
    if isinstance(user_quotes, list):
        for q in user_quotes:
            if isinstance(q, dict):
                rid = q.get('requirementId')
                if rid: quote_map[rid] = q
                desc = q.get('description', '').strip().lower()
                if desc: quote_map[desc] = q

    items_lines = []
    subtotal = Decimal('0')
    has_prices = False

    if requirements:
        for i, r in enumerate(requirements):
            name = r.get('name', '')
            qty_str = str(r.get('quantity') or '1')
            unit_str = r.get('unit') or 'Unidad'
            q_info = quote_map.get(r.get('id')) or quote_map.get(name.strip().lower())

            p_unit_str = "[Indicar P. Unit.]"
            p_total_str = "[Indicar Total]"
            if q_info and q_info.get('price'):
                try:
                    price_dec = Decimal(str(q_info['price']))
                    qty_dec = Decimal(qty_str)
                    item_total = price_dec * qty_dec
                    subtotal += item_total
                    has_prices = True
                    p_unit_str = f"S/ {price_dec:.2f}"
                    p_total_str = f"S/ {item_total:.2f}"
                except Exception:
                    pass

            items_lines.append(f"{i+1:<4} | {name[:45]:<45} | {unit_str[:8]:<8} | {qty_str:<8} | {p_unit_str:<16} | {p_total_str}")
    else:
        items_lines.append(f"1    | {description[:45]:<45} | Unidad   | 1        | [Indicar P. Unit.] | [Indicar Total]")

    table_text = "\n".join(items_lines)
    igv = (subtotal * Decimal('0.18')).quantize(Decimal('0.01'))
    total_val = subtotal + igv
    total_words = amount_to_spanish_words(total_val) if has_prices else "[MONTO TOTAL DE LA PROPUESTA EN LETRAS]"
    subtotal_str = f"S/ {subtotal:.2f}" if has_prices else "[Calcular según cotización]"
    igv_str = f"S/ {igv:.2f}" if has_prices else "[18% IGV]"
    total_str = f"S/ {total_val:.2f}" if has_prices else "[Monto total en Soles]"

    cotizacion_body = f"""SECCIÓN 3 / OFERTA ECONÓMICA
FORMULARIO DE COTIZACIÓN Y PROPUESTA ECONÓMICA

Señores:
COMITÉ DE SELECCIÓN / ÓRGANO ENCARGADO DE LAS CONTRATACIONES
{buyer}
Presente.-

Referencia: {code}
Objeto: {description}

De nuestra consideración:
El que suscribe, en calidad de postor / representante legal de {company_name}, con R.U.C. N° {company_ruc}, tiene el agrado de presentar la propuesta económica para la contratación de la referencia:

========================================================================================================================
ÍTEM | DESCRIPCIÓN DEL BIEN O SERVICIO               | UNIDAD   | CANTIDAD | P. UNITARIO (S/) | TOTAL (S/)
========================================================================================================================
{table_text}
========================================================================================================================
SUBTOTAL:                                                                                 {subtotal_str}
IGV (18%):                                                                                {igv_str}
MONTO TOTAL DE LA OFERTA:                                                                 {total_str}
========================================================================================================================
SON: {total_words}

CONDICIONES COMERCIALES Y DE SERVICIO:
1. Moneda de la oferta: Expresada en Soles (PEN), a todo costo, incluyendo tributos de ley (IGV), transporte, seguros, embalaje y demás costos directos e indirectos.
2. Validez de la oferta: Treinta (30) días calendario contados a partir de la fecha de presentación.
3. Plazo de entrega ofertado: Conforme a lo requerido en las Bases Administrativas y Especificaciones Técnicas, computado desde el día siguiente de notificada la Orden de Compra/Servicio.
4. Lugar de entrega: Almacén central de {buyer}, con transporte, flete y descarga a cargo del proveedor.
5. Cotizamos la totalidad de los bienes requeridos conforme a las instrucciones del procedimiento.

Lima, Perú

________________________________________________
{company_name}
Representante Legal: {legal_rep}
DNI N° {rep_dni} | R.U.C. N° {company_ruc}
(Firma y Sello del Representante Legal)"""

    anexo1_body = f"""ANEXO N° 1
DECLARACIÓN JURADA DE DATOS DEL POSTOR

Señores:
COMITÉ DE SELECCIÓN / ÓRGANO ENCARGADO DE LAS CONTRATACIONES
{buyer}
Presente.-

Referencia: {code}
Objeto: {description}

El que suscribe, representante legal de {company_name}, identificado con R.U.C. N° {company_ruc}, DECLARO BAJO JURAMENTO lo siguiente:

1. DATOS GENERALES DEL POSTOR:
- Razón Social / Denominación: {company_name}
- R.U.C. N°: {company_ruc}
- Domicilio Legal: {legal_address}
- Teléfono / Celular de Contacto: [Indicar teléfono oficial]
- Correo Electrónico Oficial para Notificaciones: [Indicar correo electrónico oficial]

2. DATOS DEL REPRESENTANTE LEGAL:
- Nombres y Apellidos: {legal_rep}
- Documento Nacional de Identidad (DNI): {rep_dni}
- Cargo: Representante Legal

3. CONDICIÓN EMPRESARIAL Y RNP:
- Condición de Micro o Pequeña Empresa (MYPE): ( X ) SÍ   (  ) NO
- Registro Nacional de Proveedores (RNP): HABILITADO y VIGENTE en el Capítulo de Bienes / Servicios ante el OSCE / OECE.

Autorizo expresamente a la Entidad convocante para efectuar todas las notificaciones relativas al presente procedimiento al correo electrónico consignado precedentemente.

Lima, Perú

________________________________________________
{company_name}
Representante Legal: {legal_rep}
DNI N° {rep_dni} | R.U.C. N° {company_ruc}
(Firma y Sello del Representante Legal)"""

    req_bullets = "\n".join(f"- Ítem {i+1}: {r.get('name', '')} (Cantidad: {r.get('quantity') or 'Según bases'} {r.get('unit') or 'Unidad'}) — Cumple al 100% las especificaciones técnicas." for i, r in enumerate(requirements)) if requirements else f"- {description} — Cumple al 100% las especificaciones de las bases."
    anexo2_body = f"""ANEXO N° 2
DECLARACIÓN JURADA DE CUMPLIMIENTO DE ESPECIFICACIONES TÉCNICAS Y TÉRMINOS DE REFERENCIA

Señores:
COMITÉ DE SELECCIÓN / ÓRGANO ENCARGADO DE LAS CONTRATACIONES
{buyer}
Presente.-

Referencia: {code}
Objeto: {description}

De nuestra consideración:
El que suscribe, representante legal de {company_name}, con DNI N° {rep_dni}, DECLARO BAJO JURAMENTO que:

1. Mi representada ha examinado exhaustivamente las Bases Administrativas y Especificaciones Técnicas del procedimiento de la referencia, y las acepta íntegramente en todos sus extremos.

2. Los bienes y/o servicios ofertados cumplen cabal y estrictamente con la totalidad de características técnicas, normas de calidad, tolerancias, certificaciones y requisitos exigidos por la Entidad:

{req_bullets}

3. Garantizamos la plena idoneidad, originalidad y calidad de los bienes suministrados, asumiendo la reposición o subsanación inmediata de cualquier defecto o disconformidad en el marco de la garantía comercial ofrecida.

Lima, Perú

________________________________________________
{company_name}
Representante Legal: {legal_rep}
DNI N° {rep_dni} | R.U.C. N° {company_ruc}
(Firma y Sello del Representante Legal)"""

    anexo4_body = f"""ANEXO N° 4
DECLARACIÓN JURADA DE AUSENCIA DE IMPEDIMENTOS PARA POSTULAR Y CONTRATAR CON EL ESTADO

Señores:
COMITÉ DE SELECCIÓN / ÓRGANO ENCARGADO DE LAS CONTRATACIONES
{buyer}
Presente.-

Referencia: {code}
Objeto: {description}

El que suscribe, representante legal de {company_name}, identificado con DNI N° {rep_dni}, en el marco del Principio de Presunción de Veracidad, DECLARO BAJO JURAMENTO que:

1. Ni el suscrito, ni la empresa a la que represento, ni sus directores, administradores, socios o accionistas, se encuentran incursos en causal de impedimento alguna para postular ni para contratar con el Estado, conforme a lo establecido en el Artículo 33 de la Ley de Contrataciones del Estado (Ley N° 32069 / Ley N° 30225).

2. Mi representada no cuenta con sanción administrativa vigente de inhabilitación o suspensión temporal impuesta por el Tribunal de Contrataciones del Estado (TCE) ni por el Registro Nacional de Proveedores (RNP).

3. Declaramos conducirnos bajo principios de integridad, probidad y transparencia, no habiendo celebrado acuerdos ilícitos, colusorios ni participado en actos de corrupción o soborno en ninguna fase de la contratación.

4. Toda la documentación e información consignada en nuestra propuesta es veraz y legítima, sometiéndonos a las responsabilidades de ley en caso de comprobarse fraude o falsedad.

Lima, Perú

________________________________________________
{company_name}
Representante Legal: {legal_rep}
DNI N° {rep_dni} | R.U.C. N° {company_ruc}
(Firma y Sello del Representante Legal)"""

    anexo3_body = f"""ANEXO N° 3
DECLARACIÓN JURADA DE PLAZO DE ENTREGA Y GARANTÍA COMERCIAL

Señores:
COMITÉ DE SELECCIÓN / ÓRGANO ENCARGADO DE LAS CONTRATACIONES
{buyer}
Presente.-

Referencia: {code}
Objeto: {description}

El que suscribe, representante legal de {company_name}, con DNI N° {rep_dni}, DECLARO BAJO JURAMENTO que:

1. Mi representada se compromete formalmente a efectuar la entrega total y oportuna de los bienes materia de la presente contratación en el plazo estipulado en las Bases Administrativas y Especificaciones Técnicas.

2. Dicho plazo se computará a partir del día siguiente de notificada la correspondiente Orden de Compra/Servicio o suscrito el contrato.

3. La entrega se ejecutará en los almacenes e instalaciones indicadas por {buyer}, corriendo por cuenta de mi representada los costos de transporte, embalaje, seguros, fletes, estiba y desestiba.

4. Garantizamos la vigencia de una garantía comercial no menor a doce (12) meses contados a partir de la recepción y conformidad oficial de los bienes.

Lima, Perú

________________________________________________
{company_name}
Representante Legal: {legal_rep}
DNI N° {rep_dni} | R.U.C. N° {company_ruc}
(Firma y Sello del Representante Legal)"""

    return [
        {
            'id': 'anexo6_cotizacion',
            'title': '01. Formulario de Cotización y Oferta Económica',
            'body': cotizacion_body,
            'stage': 'Oferta Económica',
            'reason': 'Es el documento principal de tu oferta: fija el precio unitario, IGV y monto total en Soles por la totalidad de los ítems. Si falta o tiene errores aritméticos, tu propuesta queda descalificada.',
            'partial': False,
            'evidence': []
        },
        {
            'id': 'anexo1_datos',
            'title': '02. Declaración Jurada de Datos del Postor (Anexo N° 1)',
            'body': anexo1_body,
            'stage': 'Admisibilidad de la Oferta',
            'reason': 'Acredita formalmente tu razón social, RUC, domicilio legal, representante y correo electrónico oficial para notificaciones. Sin este anexo la entidad no puede admitir tu postulación.',
            'partial': False,
            'evidence': []
        },
        {
            'id': 'anexo2_especificaciones',
            'title': '03. Cumplimiento de Especificaciones Técnicas (Anexo N° 2)',
            'body': anexo2_body,
            'stage': 'Requisito Técnico Mínimo',
            'reason': 'Compromete legalmente a tu empresa a entregar exactamente los bienes, normas de calidad y tolerancias técnicas exigidas en las bases. Es requisito obligatorio de admisibilidad técnica.',
            'partial': False,
            'evidence': []
        },
        {
            'id': 'anexo4_impedimentos',
            'title': '04. Declaración de Ausencia de Impedimentos (Anexo N° 4)',
            'body': anexo4_body,
            'stage': 'Admisibilidad de la Oferta',
            'reason': 'Declara bajo juramento que ni tu empresa ni su representante legal están inhabilitados o impedidos por la Ley de Contrataciones para contratar con el Estado.',
            'partial': False,
            'evidence': []
        },
        {
            'id': 'anexo3_plazo',
            'title': '05. Declaración de Plazo de Entrega y Garantía (Anexo N° 3)',
            'body': anexo3_body,
            'stage': 'Condiciones de Ejecución',
            'reason': 'Garantiza que cumplirás el plazo de entrega y la garantía comercial exigidos tras emitirse la Orden de Compra, evitando observaciones o penalidades.',
            'partial': False,
            'evidence': []
        }
    ]



def quantity_value(text):
    # Ambiguous thousands/decimal punctuation is left for the user to confirm.
    raw = str(text or '').strip()
    if re.fullmatch(r'\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?',raw):
        raw=re.sub(r'[ \u00a0]','',raw)
    elif re.fullmatch(r'\d{1,3}(?:,\d{3})+\.\d{1,2}',raw):
        raw=raw.replace(',','')
    elif re.fullmatch(r'\d{1,3}(?:\.\d{3})+,\d{1,2}',raw):
        raw=raw.replace('.','').replace(',','.')
    if not re.fullmatch(r'\d+(?:[.,]\d{1,2})?', raw):
        return None
    try:
        number = Decimal(raw.replace(',', '.'))
        return str(number) if 0 < number <= 1_000_000_000 else None
    except InvalidOperation:
        return None


def current_workspace(db, owner, key):
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == owner, WebOpportunity.key == key))
    if not item:
        raise HTTPException(404, 'Esta licitación no está disponible en tu cuenta.')
    require_bases(db, owner, key)
    identifier, _ = job_id(item, memory_for(db, owner))
    job = db.get(PreparationJob, identifier)
    sections = job.sections if job else {}
    sources = {s['id']: s for s in sections.get('sources', {}).get('documents', [])}
    requirements, forms, checks = [], [], []
    for finding in sections.get('products', {}).get('findings', []):
        evidence = finding.get('evidence') or []
        if not evidence:
            continue
        data = finding.get('item') or {}
        name = data.get('name') or finding['text']
        amount = quantity_value(data.get('quantityText'))
        unit = data.get('unit') or None
        req_id = stable_id(key, name, '|'.join(e.get('sourceId','')+e.get('locator','') for e in evidence))
        requirements.append({'id': req_id, 'name': name, 'description': finding['text'],
                             'kind': data.get('kind', 'other'), 'quantity': amount, 'unit': unit,
                             'evidence': evidence, 'partial': sections.get('products', {}).get('status') != 'ready'})
    for finding in sections.get('documents', {}).get('findings', []):
        evidence = finding.get('evidence') or []
        if not evidence:
            continue
        check_id = stable_id(key, finding['text'], str(evidence))
        c_title, c_stage, c_details, c_table_format = parse_check_structure(finding['text'])
        checks.append({
            'id': check_id,
            'text': finding['text'],
            'title': c_title,
            'stage': c_stage,
            'details': c_details,
            'tableFormat': c_table_format,
            'reason': check_reason(c_stage, finding['text']),
            'evidence': evidence
        })
        form = finding.get('format') or {}
        source = sources.get(form.get('sourceId'))
        if not source:
            continue
        locators = [c['locator'] for c in source.get('chunks', [])]
        start, end = form.get('startLocator'), form.get('endLocator')
        if start not in locators or end not in locators or locators.index(end) < locators.index(start):
            continue
        content = '\n\n'.join(c['text'] for c in source['chunks'][locators.index(start):locators.index(end)+1])
        if len(content) > 100000:
            continue
        form_id = stable_id(key, source['id'], start, end, form['title'])
        if any(f['id'] == form_id for f in forms):
            continue
        stage = form.get('stage', 'Por confirmar')
        forms.append({'id': form_id, 'title': form['title'], 'body': content, 'stage': stage,
                      'reason': document_reason(stage),
                      'sourceTitle': source.get('title'), 'sourceId': source['id'], 'locator': start + ' — ' + end,
                      'sourceUrl': f'/api/workspace/opportunities/{key}/bases/{source["id"]}',
                      'partial': source.get('status') != 'complete' or sections.get('documents', {}).get('status') != 'ready',
                      'evidence': evidence})

    alert = item.candidate.get('alert', {})

    # Generate full proposal dossier when no specific formats were extracted from the chunks
    if len(forms) == 0:
        proposal_docs = generate_proposal_dossier(key, alert, requirements, item.work.get('quotes', []), memory_for(db, owner))
        for draft in proposal_docs:
            draft['partial'] = True
            draft['reason'] = 'Modelo orientativo. Confirma en las bases si corresponde presentarlo y qué formato exige la entidad.'
            draft['body'] = 'MODELO PARA REVISIÓN · Verifica el formato y su aplicación en las bases oficiales.\n\n' + draft['body']
        forms.extend(proposal_docs)

    index = 'CARÁTULA E ÍNDICE DE FOLIACIÓN DEL EXPEDIENTE DE POSTULACIÓN\n\n'
    index += f'PROCESO: {alert.get("code", "Convocatoria")}\n'
    index += f'ENTIDAD: {alert.get("buyer", "Entidad convocante")}\n'
    index += f'OBJETO: {alert.get("description", "")}\n\n'
    index += 'ÍNDICE GENERAL DE DOCUMENTOS PRESENTADOS:\n'
    index += '--------------------------------------------------------------------------------------------------------\n'
    index += 'FOLIO   | DOCUMENTO OFICIAL / CONTENIDO\n'
    index += '--------------------------------------------------------------------------------------------------------\n'
    index += '001     | 00. Carátula e Índice de Foliación del Expediente\n'
    folio = 2
    for f in forms:
        f_title = f['title']
        span = 2 if 'Cotización' in f_title or 'Oferta' in f_title else 1
        folio_str = f"{folio:03d}-{folio+span-1:03d}" if span > 1 else f"{folio:03d}"
        index += f"{folio_str:<7} | {f_title}\n"
        folio += span
    index += '--------------------------------------------------------------------------------------------------------\n\n'
    index += 'MOTIVO DE PRESENTACIÓN DE CADA DOCUMENTO EN TU EXPEDIENTE:\n'
    index += '- 00. Carátula e Índice: Ordena y folia toda tu propuesta para que la entidad verifique que no falta ningún anexo.\n'
    for f in forms:
        f_reason = f.get('reason') or document_reason(f.get('stage'))
        index += f"- {f['title']}: {f_reason}\n"
    index += '\nBorrador para revisión y presentación oficial en SEACE / Mesa de Partes.\n'
    index += 'Revisa el formato original y completa los datos antes de firmar.'

    forms.insert(0, {
        'id': 'index',
        'title': '00. Índice del expediente',
        'body': index,
        'partial': not bool(forms),
        'stage': 'Organización del expediente',
        'reason': document_reason('Organización del expediente'),
        'evidence': []
    })
    if item.work.get('document'):
        forms.append({'id': 'legacy', 'title': 'Borrador anterior', 'body': item.work['document'], 'partial': True, 'stage': 'Trabajo guardado', 'evidence': []})
    return item, {'generation': identifier, 'status': job.status if job else 'not_started',
                  'requirements': requirements, 'checks': checks, 'documents': forms,
                  'missing': sections.get('documents', {}).get('missing', []),
                  'sourceCount': len(sources)}


@router.get('/opportunities/{key}/case-work')
def get_case_work(key: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    return current_workspace(db, owner, key)[1]


class EditDocumentAiRequest(BaseModel):
    documentId: str
    documentTitle: str
    currentContent: str
    instruction: str


@router.post('/opportunities/{key}/edit-document-ai')
def edit_document_with_ai(key: str, payload: EditDocumentAiRequest, owner: str = Depends(account), db: Session = Depends(get_db)):
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == owner, WebOpportunity.key == key))
    if not item:
        raise HTTPException(404, 'Esta licitación no está disponible en tu cuenta.')
    instruction = (payload.instruction or '').strip()
    if not instruction:
        raise HTTPException(400, 'Debes ingresar una instrucción para editar el documento.')
    current_content = payload.currentContent or ''
    if not current_content.strip():
        raise HTTPException(400, 'El documento está vacío.')

    api_key = read_secret("RADAR_OPENAI_API_KEY") or read_secret("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(503, 'El servicio de IA editorial no está configurado en el servidor.')

    business_mem = memory_for(db, owner)
    business_context = json.dumps(business_mem, ensure_ascii=False) if business_mem else "Sin datos adicionales"

    system_prompt = (
        "Eres un editor legal experto en preparación de expedientes de contratación pública en Perú (SEACE / Ley de Contrataciones).\n"
        "Tu tarea es actualizar el contenido del documento oficial de postulación según la instrucción del postor.\n"
        "REGLAS CRÍTICAS:\n"
        "1. Conserva la estructura formal completa: títulos, encabezados, numeración, tablas, cláusulas y bloque de firma.\n"
        "2. Aplica fielmente los cambios solicitados (completar datos como RUC, nombres, ajustar precios, cantidades, plazos, condiciones o tablas).\n"
        "3. Si la instrucción pide completar datos con los del negocio, usa los datos proporcionados en el contexto del negocio.\n"
        "4. Si se actualizan cifras en tablas, mantén las columnas alineadas y recalcula subtotales, IGV y total en números y letras si corresponde.\n"
        "5. Devuelve ÚNICAMENTE el texto completo actualizado del documento. No incluyas explicaciones, saludos, notas ni bloques de código markdown (sin ```)."
    )

    user_prompt = (
        f"DOCUMENTO: {payload.documentTitle}\n"
        f"DATOS DEL NEGOCIO:\n{business_context}\n\n"
        f"INSTRUCCIÓN DE EDICIÓN:\n{instruction}\n\n"
        f"CONTENIDO ACTUAL DEL DOCUMENTO:\n{current_content}"
    )

    model = os.getenv("RADAR_OPENAI_MODEL", "gpt-6-luna")
    try:
        with httpx.Client(timeout=60, follow_redirects=False) as client:
            resp = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 4000
                }
            )
            resp.raise_for_status()
            data = resp.json()
            new_content = data["choices"][0]["message"]["content"].strip()
            if new_content.startswith("```") and new_content.endswith("```"):
                lines = new_content.split("\n")
                new_content = "\n".join(lines[1:-1]).strip()
            return {"status": "ok", "content": new_content}
    except Exception as e:
        raise HTTPException(502, f"No se pudo completar la edición con IA: {str(e)[:150]}")


def document_bytes(title, body, source=''):
    from docx import Document
    from docx.shared import Cm, Pt
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin = section.bottom_margin = Cm(2)
    section.left_margin = section.right_margin = Cm(2.2)
    style = doc.styles['Normal']
    style.font.name, style.font.size = 'Arial', Pt(11)
    style.paragraph_format.space_after = Pt(7)
    style.paragraph_format.line_spacing = 1.15
    doc.styles['Title'].font.name = 'Arial'
    doc.styles['Title'].font.size = Pt(15)
    section.header.paragraphs[0].text = 'BORRADOR PARA REVISIÓN'
    doc.add_heading(title, 0)
    paragraphs = body.split('\n')
    if paragraphs and paragraphs[0].strip() == title.strip(): paragraphs = paragraphs[1:]
    for paragraph in paragraphs:
        doc.add_paragraph(paragraph)
    if source.strip():
        doc.add_paragraph('Fuente de trabajo: ' + source, style='Caption')
    section.footer.paragraphs[0].text = 'Revisa el formato original, completa los datos y firma sólo después de verificar su contenido.'
    buffer = io.BytesIO(); doc.save(buffer)
    return buffer.getvalue()


def exported_forms(item, view):
    edits = item.work.get('documentEdits') or {}
    for form in view['documents']:
        body = edits.get(form['id'], form['body'])
        yield form, document_bytes(form['title'], body, (form.get('sourceTitle','') or '') + ' ' + form.get('locator',''))


@router.get('/opportunities/{key}/documents.zip')
def download_package(key: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    item, view = current_workspace(db, owner, key)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
        for i, (form, content) in enumerate(exported_forms(item, view)):
            filename = re.sub(r'[^\w .-]', '', form['title'])[:100] or 'documento'
            package.writestr(f'{i:02d}-BORRADOR-{filename}.docx', content)
    return Response(output.getvalue(), media_type='application/zip', headers={'Content-Disposition': 'attachment; filename="borradores-radar.zip"'})


@router.get('/opportunities/{key}/documents/{document_id}.docx')
def download_document(key: str, document_id: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    item, view = current_workspace(db, owner, key)
    for form, content in exported_forms(item, view):
        if form['id'] == document_id:
            return Response(content, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            headers={'Content-Disposition': 'attachment; filename="BORRADOR-radar.docx"'})
    raise HTTPException(404, 'Ese borrador no está disponible con las bases actuales.')
