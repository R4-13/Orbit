> **HISTORISCH – ersetzt durch [`ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md`](ORBIT_UI_UX_DEVELOPMENT_SPECIFICATION_v2.md) (05.10.2026).**
> Diese Fassung gilt nicht mehr als UI/UX-Implementierungsdefinition. Aktive Verweise zeigen auf v2; der Umsetzungsstand steht in
> [`ORBIT_UI_UX_V2_IMPLEMENTATION_PLAN.md`](ORBIT_UI_UX_V2_IMPLEMENTATION_PLAN.md).

# ORION UI/UX DEVELOPMENT SPECIFICATION
## High-Fidelity Application Shell, Dashboard, Theming and Sonde Copilot Specification for Claude Code

**Version:** 1.0  
**Date:** 2026-09-27  
**Status:** Authoritative UI/UX Implementation Specification subordinate to `ORBIT_MASTER_SPECIFICATION_v3.md`  
**Reference Image:** `ORION_UI_REFERENCE_DASHBOARD.png`  
**Project Codename:** ORBIT  
**Current Product Working Name:** ORION  
**Copilot Working Title:** Sonde  

---

# 0. Authority and relationship to the Master Specification

This document defines the required **visual implementation, application shell, navigation, dashboard composition, Sonde presentation and tenant branding/theming behavior** for the ORION web application.

It is **not** a replacement for `ORBIT_MASTER_SPECIFICATION_v3.md`.

The authority order is:

1. `ORBIT_MASTER_SPECIFICATION_v3.md` — product, architecture, security, domain behavior, workflow, permissions and functional scope.
2. This document — visual implementation, layout, component behavior and branding/theming.
3. The reference mockup — visual target for composition and appearance.

If this document conflicts with the Master Specification on business behavior, security, permissions, workflows, integrations or supported functional areas, the **Master Specification wins**.

If the reference image contains demo labels, sample rows or concepts that are not part of the Master Specification, they are **visual placeholders only** and must not create new product modules.

Examples:
- Do not create an HR module.
- Do not create a Legal module.
- Do not create new navigation items because a demo row happens to mention HR or a contract.
- Replace such sample content with Finance, Sales, Approval, Task, Case or Activity examples.

The implementation objective is:

> Reproduce the visual structure, hierarchy, density and modern SaaS appearance of the reference mockup while keeping all company branding tenant-configurable and preserving the functional boundaries of the Master Specification.

---

# 1. Product UI principles

The ORION application must feel:

- modern,
- calm,
- premium,
- enterprise-ready,
- easy to understand,
- visually consistent,
- fast,
- responsive,
- configurable for different customer brands,
- suitable for users who are not technical specialists.

The application should visually communicate:

> ORION is the operating layer for administrative work.  
> Sonde is the conversational control surface.  
> Existing systems remain systems of record.

The UI must not look like:
- a developer console,
- a generic chatbot wrapper,
- an ERP from the 2000s,
- a collection of disconnected AI demos,
- a highly technical agent-management console for normal users.

---

# 2. Mandatory functional navigation

The primary navigation must contain exactly these business/application areas:

```text
Home
Inbox
Finance
Sales
Approvals
Tasks
Cases
Activity
Integrations
Administration
```

Do not add additional top-level functional modules without a later approved specification.

Sonde is **not** a navigation item.  
Sonde is globally available as a right-side copilot panel.

Normal utility controls may exist in the application header, including:
- global search,
- notifications,
- date/range selector,
- user profile,
- tenant/company identity,
- Sonde open/close state.

---

# 3. Application shell

## 3.1 Desktop shell

The desktop application shall use a three-region layout:

```text
┌──────────────────┬───────────────────────────────────────┬──────────────────────┐
│                  │                                       │                      │
│ Left Navigation  │ Main Application Content              │ Sonde Copilot Panel  │
│                  │                                       │                      │
│ fixed / collaps. │ responsive                            │ collapsible           │
│                  │                                       │                      │
└──────────────────┴───────────────────────────────────────┴──────────────────────┘
```

Target visual proportions based on the reference mockup:

- left navigation: approximately 190–220 px,
- Sonde panel: approximately 360–440 px,
- main content: consumes all remaining width,
- page outer padding: approximately 24–32 px,
- card gaps: approximately 12–16 px,
- major section gaps: approximately 16–24 px.

The reference image is a 16:9 desktop composition.  
The implementation must scale cleanly at common enterprise desktop widths.

Recommended desktop breakpoint targets:

```text
1440 px
1600 px
1920 px
```

The application must remain usable at 1280 px.

---

# 4. Left navigation

## 4.1 Visual structure

The left navigation should visually match the reference:

- deep/dark branded surface,
- company logo at the top,
- vertical navigation list,
- selected item displayed as a rounded highlighted row,
- product identity at the bottom,
- subtle decorative background treatment allowed,
- icons aligned consistently,
- text labels always visible in default desktop mode.

## 4.2 Navigation order

Use this exact order:

```text
Home
Inbox
Finance
Sales
Approvals
Tasks
Cases
Activity
Integrations
Administration
```

## 4.3 Navigation behavior

Each item:
- has an icon,
- has a text label,
- has hover state,
- has active state,
- has keyboard focus state,
- respects permissions.

If a user lacks permission for an area:
- either hide the item, or
- render it disabled if product policy requires discoverability.

The choice must follow existing authorization behavior.  
Never use navigation visibility as the only permission control.

## 4.4 Collapsed sidebar

Optional desktop collapsed mode:

- width approximately 64–76 px,
- icons remain visible,
- company logo may become icon-only,
- labels shown via tooltip,
- active state remains obvious.

Do not make collapsed mode the default unless screen width requires it.

---

# 5. Tenant/company branding and CI theming

Branding must be dynamically configurable and must not require application code changes.

## 5.1 Branding objectives

A tenant administrator or platform administrator must be able to configure:

- company logo,
- optional compact logo / mark,
- company display name,
- primary CI color,
- secondary CI color,
- accent color,
- optional navigation background color,
- optional light/dark logo variant.

The product layout, information architecture and component semantics must remain unchanged when the CI changes.

## 5.2 Required brand configuration model

Implement a theme configuration conceptually equivalent to:

```typescript
interface TenantBranding {
  tenantId: string;

  companyDisplayName?: string;

  logoUrl?: string;
  logoMarkUrl?: string;
  logoDarkUrl?: string;
  logoLightUrl?: string;

  primaryColor: string;
  primaryForeground: string;

  secondaryColor: string;
  secondaryForeground: string;

  accentColor: string;
  accentForeground: string;

  navigationBackground?: string;
  navigationForeground?: string;

  borderRadiusPreset?: 'compact' | 'standard' | 'soft';

  updatedAt: string;
}
```

Exact persistence may follow the existing architecture, but branding must remain tenant-scoped.

## 5.3 Logo requirements

The company logo in the upper-left must:

- be replaceable without a deployment,
- support SVG, PNG and WebP,
- maintain aspect ratio,
- never stretch,
- fit within a defined logo container,
- work with long and compact logos,
- provide fallback text/company name if unavailable,
- provide accessible alt text.

Recommended desktop logo container:

```text
max width: 150–170 px
max height: 40–48 px
```

A compact logo/mark should be supported for collapsed navigation.

## 5.4 CI color requirements

Do not hard-code brand colors directly in page components.

Use semantic tokens / CSS custom properties.

Required token concept:

```css
:root {
  --brand-primary: ...;
  --brand-primary-foreground: ...;

  --brand-secondary: ...;
  --brand-secondary-foreground: ...;

  --brand-accent: ...;
  --brand-accent-foreground: ...;

  --nav-background: ...;
  --nav-foreground: ...;
  --nav-active-background: ...;
  --nav-active-foreground: ...;

  --surface-page: ...;
  --surface-card: ...;
  --surface-muted: ...;

  --text-primary: ...;
  --text-secondary: ...;
  --text-muted: ...;

  --border-default: ...;

  --status-success: ...;
  --status-warning: ...;
  --status-error: ...;
  --status-info: ...;
}
```

Brand colors and semantic status colors are different concepts.

A tenant's primary corporate color must **not** automatically replace:
- success green,
- warning amber,
- error red,
- critical risk red,
- neutral gray.

These status colors must remain semantically clear and accessible.

## 5.5 Theme derivation

If only a primary and secondary CI color are provided, derive safe UI variants for:

- hover,
- active,
- subtle background,
- borders,
- focus ring,
- badges.

Derived colors must meet accessibility targets.

Do not generate arbitrary color variants independently in every component.

Use one central theme service.

## 5.6 Default ORION theme

If no tenant theme exists, use the visual baseline of the reference image:

- deep navy navigation,
- blue primary interaction color,
- teal/cyan secondary accents,
- near-white page background,
- white cards,
- dark navy text,
- soft cool-gray borders.

These are defaults only.

---

# 6. Branding administration

Create a branding section under:

```text
Administration
→ Branding / Appearance
```

This does not create a new top-level module.

The administration view should allow:

```text
Company Display Name
Primary Logo
Compact Logo / Mark
Primary Color
Secondary Color
Accent Color
Navigation Background
Preview
Save
Reset to Default
```

## 6.1 Live preview

Provide a small live preview that demonstrates:

- sidebar,
- active navigation item,
- primary button,
- secondary button,
- badge,
- card header,
- Sonde accent.

## 6.2 Validation

Validate:
- image type,
- image size,
- SVG safety/sanitization,
- valid color syntax,
- sufficient contrast.

If contrast is insufficient:
- show warning,
- derive a safer foreground automatically where possible,
- do not allow unreadable combinations for essential controls.

---

# 7. Main header

The main page header should follow the reference composition.

## 7.1 Left header content

On Home:

```text
Willkommen zurück
Guten Morgen, {firstName}
Hier ist der aktuelle Stand Ihrer Geschäftsprozesse mit ORION.
```

Time-sensitive greeting may be computed.

The product name must come from product configuration, not be hard-coded permanently.

## 7.2 Global search

A centered or right-aligned search field may display:

```text
Suche in ORION...
```

Search must only expose data the current user is authorized to access.

If global search is not yet implemented:
- keep the visual component behind a feature flag,
- do not ship a fake interactive search.

## 7.3 Header utilities

Right side may contain:
- date/range selector,
- notifications,
- user avatar,
- user name,
- tenant/company name,
- profile menu.

---

# 8. Home dashboard — exact composition

The default Home desktop layout should visually follow this order:

```text
1. Greeting / header
2. KPI row
3. Unified Inbox card
4. Finance Overview + Sales Overview
5. Approvals + Activity
```

The Sonde panel remains visible to the right when open.

---

# 9. KPI row

Display five primary KPI cards:

```text
Processed Items
Automated
Needs Approval
Failed
Estimated Time Saved
```

German UI default:

```text
Verarbeitete Posten
Automatisiert
Benötigt Genehmigung
Fehlgeschlagen
Geschätzte Zeitersparnis
```

Each KPI card should contain:

- icon,
- label,
- primary value,
- optional percentage or ratio,
- optional trend indicator,
- period label such as "Heute".

The cards must use real API data.

Do not display fabricated trends in production.

Recommended visual behavior:
- white surface,
- rounded corners,
- subtle border/shadow,
- icon in tinted circular or rounded container,
- metric emphasized,
- trend subordinate.

---

# 10. Unified Inbox card

The Unified Inbox is a full-width card immediately below the KPI row.

Required columns/fields:

```text
source
sender
subject
classification
case
workflow status
assigned agent
human action required
timestamp
```

German labels may be:

```text
Quelle
Absender
Betreff
Klassifikation
Fall
Workflow-Status
Zugewiesener Agent
Menschl. Aktion
Zeitpunkt
```

Use:
- source icons,
- compact badges,
- status pills,
- row hover,
- ellipsis actions,
- deep link to case/object.

Default card header:

```text
Unified Inbox
{N} ungelesen
Alle anzeigen →
```

Demo/sample rows must be limited to supported areas:
- Finance,
- Sales,
- Approval,
- Task,
- Case.

Do not add HR or Legal modules based on the reference image.

---

# 11. Finance Overview card

Display a Finance summary card in the lower-left/middle area.

Recommended top metrics:

```text
Rechnungen
Buchungsvorschläge
Dubletten
Bankänderungs-Warnungen
```

Secondary visual zones may include:

```text
Genehmigungsstatus
Workflow-Timeline
Transferstatus
```

The purpose is to summarize:
- invoice activity,
- automation,
- exceptions,
- approvals,
- transfer to the system of record.

The card must not imply that ORION is the accounting system of record.

## 11.1 Finance status visualization

A donut or comparable compact chart may show:
- automated,
- waiting for approval,
- rejected,
- failed.

A workflow timeline may show:
- intake,
- classification,
- booking proposal,
- approval,
- transfer.

All labels must map to real workflow state.

---

# 12. Sales Overview card

Display a Sales summary card beside Finance.

Recommended top metrics:

```text
Kontakte
Unternehmen
Leads
Follow-ups
```

Compact table/list may show:

```text
Kontakt
Unternehmen
Lead
Nächste Aktion
Meeting
CRM Sync
```

Optional lead status badges:

```text
Neu
Warm
Hot
```

Only use such labels if they exist in the implemented domain logic or demo fixtures.

The Sales card should visually communicate:
- inbound interest,
- CRM context,
- next action,
- follow-up,
- meeting,
- CRM synchronization.

---

# 13. Approvals dashboard card

Show a dashboard preview of Approval Center items.

Required fields:

```text
requested action
business object
reason
risk
confidence
policy result
status
```

Recommended German labels:

```text
Angeforderte Aktion
Geschäftsobjekt
Grund
Risiko
Konfidenz
Policy-Ergebnis
Status
```

Risk and status should use semantic status colors, not tenant CI colors.

The dashboard card may expose compact action menus, but irreversible actions must still follow the Master Specification's permission/policy/approval rules.

---

# 14. Activity card

Show a compact chronological activity timeline.

Examples of valid events:

```text
Invoice classified
Approval requested
Approval granted
Lead created
CRM updated
Meeting created
Workflow resumed
Finance transfer completed
Email sent
```

Each item may show:
- status dot/icon,
- short business-readable event title,
- concise detail,
- timestamp.

Do not expose hidden chain-of-thought or raw internal agent reasoning.

---

# 15. Sonde right-side copilot panel

Sonde must visually follow the reference image and the Master Specification.

## 15.1 Panel placement

Desktop:
- fixed or sticky right-side panel,
- integrated into the application shell,
- collapsible,
- normal width approximately 400–440 px,
- expanded state may use up to approximately 40% width,
- collapsed state may reduce to an icon/rail.

Sonde must feel like part of ORION, not an external chatbot.

## 15.2 Panel header

Display:

```text
Sonde
Online / status
expand
close/collapse
```

Use the tenant theme primarily for interaction accents while preserving Sonde identity.

## 15.3 Sonde modes

Expose the five modes defined in the Master Specification:

```text
Ask
Prepare
Act
Delegate
Navigate
```

Use compact tabs/chips in the top area of the panel.

The active mode must be visually distinct.

## 15.4 Conversation area

Conversation contains:
- user messages,
- Sonde messages,
- concise operational summaries,
- entity references,
- workflow status,
- suggested actions.

Avoid overly chat-like decorative bubbles if they reduce information density.

## 15.5 Suggested action cards

Use structured action cards, not text-only prompts.

Examples:

```text
Meeting erstellen
Lead besprechen und nächste Schritte abstimmen
```

```text
3 Rechnungen prüfen
Gesamtbetrag ...
```

```text
Bankänderung überprüfen
Abweichung erkannt
```

Action cards may have:
- icon,
- title,
- description,
- status,
- chevron,
- confirm/edit actions where needed.

All execution still passes:

```text
RBAC
→ Policy Engine
→ Approval Engine if required
→ Workflow / Tool Gateway
```

## 15.6 Sonde input

Bottom composer should include:
- text input,
- send button,
- optional attachment/context affordance if supported later,
- suggested prompt chips.

Example suggestions:

```text
Fasse heute zusammen
Zeige offene Freigaben
```

Suggested prompts must be permission-aware.

---

# 16. Individual module pages

The visual language established by the Home dashboard must be reused across all module pages.

## 16.1 Inbox

Use:
- page title,
- summary/filter row,
- full table/list,
- filters from Master Specification,
- detail drawer or detail navigation.

## 16.2 Finance

Finance landing page:
- summary metrics,
- invoice list,
- needs-attention filter,
- status filters.

Invoice detail must support the Master Specification fields:
- document viewer,
- supplier,
- invoice number,
- date,
- line items,
- amount,
- VAT,
- IBAN,
- payment terms,
- duplicate result,
- bank-change warning,
- booking proposal,
- confidence,
- approval status,
- workflow timeline,
- finance transfer status,
- audit trail.

## 16.3 Sales

Sales landing page:
- lead/opportunity list,
- contact/company context,
- next actions,
- follow-ups,
- meetings,
- CRM sync.

Detail view must support:
- contact,
- company,
- source,
- summary,
- intent,
- opportunity,
- next action,
- suggested follow-up,
- tasks,
- meetings,
- CRM sync,
- communication history,
- workflow status.

## 16.4 Approvals

Approval Center:
- queue/list,
- filter by status/risk/type,
- contextual detail,
- action area.

Required actions:
- Approve,
- Reject,
- Edit & Approve.

## 16.5 Tasks

Task page:
- open tasks,
- assigned user/agent,
- due state,
- related case/workflow,
- status.

Do not invent new task-domain semantics beyond implemented backend capabilities.

## 16.6 Cases

Case page:
- business context,
- source,
- linked communication,
- documents,
- tasks,
- approvals,
- workflow status,
- linked business entities,
- activity/audit.

## 16.7 Activity

Activity page:
- human-readable audit/activity stream,
- filters,
- business object links,
- timestamps,
- source.

## 16.8 Integrations

Integration page:
- connector cards,
- provider/system name,
- status,
- last successful sync/event where available,
- configure/test connection actions subject to permission.

Do not claim live readiness when only mocks exist.

## 16.9 Administration

Administration may contain sub-sections for:
- users/roles where already supported,
- policies/autonomy,
- AI & Models,
- branding/appearance,
- tenant settings,
- advanced administration where allowed.

Agent Studio remains an advanced capability and must not dominate normal-user navigation.

---

# 17. Card system

All major dashboard blocks use a consistent card primitive.

Recommended card tokens:

```text
background: white / surface-card
border: 1 px subtle cool gray
radius: 12–16 px
shadow: very subtle
header padding: 16–20 px
body padding: 16–20 px
```

Cards should avoid excessive elevation.

Hierarchy should come from:
- typography,
- spacing,
- grouping,
- restrained color accents.

---

# 18. Typography

Use a modern system or product sans-serif stack compatible with the existing frontend.

Preferred approach:
- Inter or equivalent if already available,
- otherwise system sans-serif.

Suggested hierarchy:

```text
Page greeting / H1: 28–32 px, semibold/bold
Section title: 16–20 px, semibold
Card title: 14–16 px, semibold
KPI number: 24–32 px, bold/semibold
Body: 13–15 px
Table: 12–14 px
Metadata: 11–13 px
```

Do not use decorative fonts.

---

# 19. Iconography

Use one consistent icon system.

Recommended:
- Lucide icons or the icon set already used by shadcn/ui.

Do not mix:
- outline icons,
- filled icons,
- emoji,
- unrelated vendor icon styles,

except real source/provider logos where useful.

Provider/source logos should be used only when legally and visually appropriate.

---

# 20. Tables and dense data

Tables should use:
- sticky header where useful,
- compact but readable row height,
- row hover,
- semantic badges,
- ellipsis for long text,
- accessible tooltip or detail view for truncated text,
- keyboard navigation where practical.

Avoid horizontal overflow at standard desktop widths.

For narrower screens:
- selectively hide low-priority columns,
- provide row detail expansion.

---

# 21. Status and badges

Create reusable status primitives.

Examples:

```text
Automatisiert
In Bearbeitung
Genehmigung
Klassifiziert
Fehlgeschlagen
Offen
Abgelehnt
Konform
Nicht konform
```

Map business status to semantic tokens centrally.

Do not encode status meaning through color alone.

Include:
- text,
- icon where valuable,
- accessible labels.

---

# 22. Responsive behavior

## 22.1 Desktop ≥ 1440

Preferred:
- full left navigation,
- main dashboard,
- Sonde open.

## 22.2 Medium desktop / laptop 1024–1439

Recommended:
- sidebar may collapse,
- Sonde may overlay or reduce width,
- dashboard cards may stack where necessary,
- two-column Finance/Sales layout can become one column.

## 22.3 Tablet

- navigation becomes drawer,
- Sonde becomes overlay/right sheet,
- KPI cards wrap,
- tables become responsive lists or horizontally scroll with careful prioritization.

## 22.4 Mobile

Follow Master Specification:
- Sonde floating button,
- bottom sheet,
- full-screen conversation when opened.

Mobile business module views must remain usable but native mobile app is not required.

---

# 23. Accessibility

Target WCAG 2.1 AA where practical.

At minimum:
- keyboard navigable,
- visible focus states,
- semantic headings,
- ARIA labels where needed,
- sufficient contrast,
- text alternatives for logos/icons,
- no status meaning by color only,
- touch targets approximately 44 px on mobile,
- screen-reader labels for icon-only actions.

Tenant CI customization must not break accessibility.

---

# 24. Theming implementation requirements

## 24.1 No component-level brand hard-coding

Bad:

```tsx
<button className="bg-blue-600">
```

Preferred:

```tsx
<button className="bg-primary text-primary-foreground">
```

with central CSS variable mapping.

## 24.2 Tailwind/shadcn integration

Map tenant theme values onto semantic design tokens used by Tailwind/shadcn.

Example concept:

```css
[data-tenant-theme] {
  --primary: var(--tenant-primary);
  --primary-foreground: var(--tenant-primary-foreground);
  --secondary: var(--tenant-secondary);
  --secondary-foreground: var(--tenant-secondary-foreground);
  --accent: var(--tenant-accent);
}
```

Exact format may follow the existing codebase.

## 24.3 Server-side theme hydration

Avoid visible theme flash.

Tenant theme should be resolved:
- during authenticated app boot,
- preferably server-side or before first meaningful paint,
- then hydrated consistently on client.

## 24.4 Tenant isolation

Branding is tenant-specific data.

Never load or cache one tenant's theme into another tenant session.

Cache keys must include tenant identity.

---

# 25. Suggested frontend component structure

Claude Code should inspect the existing repository and reuse working components.

Conceptual component tree:

```text
AppShell
├── TenantSidebar
│   ├── TenantLogo
│   ├── PrimaryNavigation
│   └── ProductIdentity
├── MainWorkspace
│   ├── AppHeader
│   └── PageContent
└── SondePanel
    ├── SondeHeader
    ├── SondeModeSelector
    ├── ConversationThread
    ├── SondeActionCard
    ├── SuggestedPrompts
    └── SondeComposer
```

Home:

```text
HomePage
├── GreetingHeader
├── KpiGrid
│   └── KpiCard × 5
├── UnifiedInboxCard
├── DomainOverviewGrid
│   ├── FinanceOverviewCard
│   └── SalesOverviewCard
└── AttentionGrid
    ├── ApprovalsPreviewCard
    └── ActivityTimelineCard
```

The actual file layout must follow current repository conventions.

---

# 26. Suggested theme service architecture

Conceptual:

```text
Tenant Branding Record
        ↓
Branding Service / API
        ↓
Theme Resolver
        ↓
Validated Semantic Tokens
        ↓
AppShell / CSS Variables
        ↓
All components
```

Logo:

```text
Tenant Branding
        ↓
Asset reference / object storage
        ↓
TenantLogo component
```

Do not embed base64 company logos in application configuration if a proper asset store exists.

---

# 27. Branding API concept

Reuse existing APIs where possible.

If missing, a minimal conceptual API may include:

```text
GET  /api/v1/tenant/branding
PUT  /api/v1/tenant/branding
POST /api/v1/tenant/branding/logo
DELETE /api/v1/tenant/branding/logo
```

The exact API must follow current application conventions and security patterns.

Requirements:
- tenant-scoped,
- permission-controlled,
- input validated,
- audit material changes,
- file restrictions enforced.

Suggested permission:

```text
tenant.branding.configure
```

Do not invent an authorization bypass if this permission does not yet exist; add it consistently with the existing RBAC model.

---

# 28. Theme defaults and fallback behavior

Fallback order:

```text
Tenant theme
↓
Platform/customer default theme
↓
ORION default theme
```

If a logo fails:
- show company display name or ORION fallback,
- do not render broken image UI.

If invalid colors are persisted:
- reject at write time,
- also apply safe fallback at render time.

---

# 29. Loading, empty and error states

Every dashboard area needs:

```text
loading
loaded
empty
error
partial-data
```

Use skeletons for loading.

Examples:

Unified Inbox empty:
```text
Keine neuen Vorgänge.
```

Approvals empty:
```text
Keine offenen Freigaben.
```

Connector failure:
```text
CRM vorübergehend nicht verfügbar.
ORION versucht es automatisch erneut.
```

Do not expose stack traces or raw provider errors to normal users.

---

# 30. Performance expectations

The dashboard must feel immediate.

Guidance:
- render application shell quickly,
- avoid blocking the entire page on one slow integration,
- load dashboard sections independently where appropriate,
- cache safe summary data where consistent with business correctness,
- use optimistic UI only where safe,
- lazy-load heavy detail widgets.

Sonde streaming should not block the dashboard.

---

# 31. Security implications of UI implementation

All UI controls are convenience only.

Backend remains authoritative for:
- tenant isolation,
- permissions,
- policy,
- approval,
- workflow state,
- connector execution.

Never treat:
- hidden button,
- disabled button,
- hidden navigation item,

as a security boundary.

Branding file uploads must follow:
- MIME validation,
- size limits,
- SVG sanitization,
- object-storage security,
- tenant isolation.

---

# 32. Exact visual fidelity requirements

Claude Code should use the supplied reference image as the visual target.

The following visual characteristics are mandatory:

- dark left navigation,
- light main workspace,
- right Sonde panel,
- five KPI cards in one desktop row where width allows,
- Unified Inbox full-width below KPIs,
- Finance and Sales cards side-by-side,
- Approvals and Activity cards below,
- rounded white cards,
- restrained borders,
- soft shadows,
- compact enterprise data density,
- blue/teal default accent palette,
- clear status badges,
- strong numeric KPI hierarchy,
- integrated Sonde action cards,
- professional German-first interface text.

The implementation does not need pixel-identical values if existing design-system constraints require small adjustments, but the **overall composition, balance and hierarchy must clearly match the reference**.

---

# 33. Functional fidelity requirements

The UI must not simulate functionality that does not exist.

For every visible interactive element classify:

```text
LIVE
MOCK/DEMO
FEATURE_FLAGGED
NOT_IMPLEMENTED
```

Production-facing UI must not present `MOCK/DEMO` functionality as live.

If a card depends on data not yet exposed by the backend:
- add the correct backend endpoint/service,
- or feature-flag the card,
- do not fabricate production values.

---

# 34. Sample data rules

Demo fixtures may be used in local/demo mode.

Demo data should use only supported domains, for example:

Finance:
- Rechnung,
- Lieferant,
- Dublette,
- Bankänderung,
- Buchungsvorschlag,
- Freigabe.

Sales:
- Kunde,
- Kontakt,
- Lead,
- Opportunity,
- Follow-up,
- Meeting,
- CRM Sync.

Workflow:
- Case,
- Task,
- Approval,
- Activity.

Do not create unrelated domain modules only to reproduce sample text from the reference image.

---

# 35. CI configuration acceptance criteria

A build is not complete until all are true:

1. Tenant admin can change logo without code change.
2. Tenant admin can change primary CI color without code change.
3. Tenant admin can change secondary CI color without code change.
4. Theme is persisted tenant-scoped.
5. Theme survives logout/login.
6. Theme is applied on initial page render without obvious flash.
7. Theme changes apply consistently to navigation and interactive accents.
8. Status colors remain semantically consistent.
9. Invalid/low-contrast combinations are handled safely.
10. Tenant A branding can never appear for Tenant B.
11. Collapsed sidebar uses compact logo or safe fallback.
12. Logo failure has graceful fallback.

---

# 36. Home dashboard acceptance criteria

Desktop acceptance:

1. Left branded navigation is visible.
2. Navigation order exactly matches this specification.
3. Header/greeting exists.
4. Five KPI cards appear.
5. Unified Inbox is full-width below KPI cards.
6. Finance and Sales summaries appear side-by-side at supported widths.
7. Approvals and Activity appear below.
8. Sonde panel appears on the right and is collapsible.
9. Sonde mode selector includes Ask, Prepare, Act, Delegate, Navigate.
10. All cards use shared primitives.
11. No unsupported top-level business module is introduced.
12. All visible data respects tenant and RBAC rules.

---

# 37. Sonde UI acceptance criteria

1. Sonde is available globally.
2. It opens as a right-side panel on desktop.
3. It can be collapsed.
4. It displays conversation history.
5. It supports structured action cards.
6. It shows current mode.
7. It exposes only permitted capabilities.
8. Long-running delegated workflows visibly continue independently of the chat request.
9. Approval-required actions display appropriate approval state.
10. No hidden chain-of-thought is shown.
11. Current-page/business-object context can be represented.
12. Mobile presentation follows floating button → sheet/full-screen model.

---

# 38. Responsive acceptance criteria

Test at minimum:

```text
1920×1080
1600×900
1440×900
1280×800
1024×768
768×1024
390×844
```

At each size:
- no critical content overlaps,
- navigation remains usable,
- Sonde remains accessible,
- tables remain understandable,
- primary actions remain reachable,
- no horizontal page-level overflow unless explicitly required by a data grid.

---

# 39. Visual regression testing

Add visual regression coverage for at least:

```text
Home — default ORION theme
Home — custom tenant theme
Home — Sonde collapsed
Home — Sonde open
Finance detail
Sales detail
Approvals
Branding Administration
Mobile Sonde
```

Use the repository's existing E2E/visual tooling if present.

If none exists, introduce a lightweight approach compatible with the current test stack.

Do not add a large new testing framework without need.

---

# 40. Theme test matrix

Test at least:

```text
Default ORION navy/blue/teal
Corporate dark blue
Corporate green
Corporate red
Corporate orange
Very light primary color
Very dark primary color
Long landscape logo
Square logo
Transparent SVG logo
Missing logo
```

Verify accessibility and layout stability.

---

# 41. Claude Code implementation order

Claude Code must not blindly rebuild the frontend.

## Phase UI-0 — Audit

Inspect:
- existing app shell,
- existing routes,
- sidebar/navigation,
- dashboard,
- Sonde implementation,
- Tailwind config,
- shadcn/ui configuration,
- global CSS,
- theme tokens,
- tenant settings,
- asset storage,
- permissions,
- tests.

Create:

```text
/docs/ORION_UI_IMPLEMENTATION_PLAN.md
```

Classify each requirement:

```text
ALREADY_COMPLETE
PARTIAL
MISSING
BLOCKED
```

## Phase UI-1 — Design tokens and theme foundation

Implement or normalize:
- semantic tokens,
- tenant theme resolver,
- safe fallback theme,
- status tokens.

## Phase UI-2 — Tenant branding

Implement:
- logo configuration,
- color configuration,
- tenant-safe persistence,
- branding admin view,
- preview,
- validation.

## Phase UI-3 — Application shell

Implement/refine:
- left navigation,
- header,
- main workspace,
- Sonde region,
- responsive shell.

## Phase UI-4 — Home dashboard

Implement/refine in required order:
- greeting,
- KPI row,
- Unified Inbox,
- Finance summary,
- Sales summary,
- Approvals preview,
- Activity.

## Phase UI-5 — Sonde visual integration

Implement/refine:
- panel,
- mode selector,
- conversation,
- action cards,
- composer,
- collapse/expand,
- responsive behavior.

## Phase UI-6 — Module consistency

Bring:
- Inbox,
- Finance,
- Sales,
- Approvals,
- Tasks,
- Cases,
- Activity,
- Integrations,
- Administration

onto the same visual system.

## Phase UI-7 — Accessibility and responsive hardening

Complete:
- keyboard,
- focus,
- contrast,
- mobile/tablet,
- truncation,
- empty/error/loading states.

## Phase UI-8 — Regression and production build

Run the Master Specification quality gates and relevant frontend/E2E tests.

---

# 42. Required implementation documentation

Maintain:

```text
/docs/UI_ARCHITECTURE.md
/docs/THEMING_AND_BRANDING.md
/docs/ORION_UI_IMPLEMENTATION_PLAN.md
```

Update existing implementation status documentation with:
- what was changed,
- what is themeable,
- what remains feature-flagged,
- known visual limitations,
- unsupported backend data dependencies.

---

# 43. Definition of done

The UI/UX implementation is complete when:

- the application clearly resembles the supplied reference mockup,
- only Master-Specification functional areas are represented,
- logo and CI colors are configurable per tenant,
- changing a customer brand requires no code change,
- the default ORION design remains polished,
- the layout remains responsive,
- Sonde is integrated globally,
- all interactions honor existing permission/policy/workflow architecture,
- no unsupported business module was introduced,
- visual and functional tests pass,
- documentation matches actual behavior.

---

# 44. Final instruction to Claude Code

Use `ORBIT_MASTER_SPECIFICATION_v3.md` as the authoritative product and architecture definition and this document as the authoritative UI/UX implementation definition.

Use `ORION_UI_REFERENCE_DASHBOARD.png` as the high-fidelity visual reference.

Do not infer new business modules from the reference image.

Do not hard-code customer branding.

Do not duplicate working components.

Do not bypass existing:
- RBAC,
- tenant isolation,
- Policy Engine,
- Approval Engine,
- Workflow Engine,
- connector architecture.

The target is a **modern, configurable, enterprise-quality ORION application shell** that can visually adopt the corporate identity of each customer while preserving one coherent product and one shared codebase.
