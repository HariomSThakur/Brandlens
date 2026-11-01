from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "BrandLens-Codex-48-Round-3-Submission.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#13293D")
TEAL = colors.HexColor("#087F80")
TEAL_PALE = colors.HexColor("#E8F5F3")
BLUE_PALE = colors.HexColor("#EEF3F8")
GOLD = colors.HexColor("#C38C26")
MUTED = colors.HexColor("#526476")
LINE = colors.HexColor("#D9E2E8")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverEyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=13, textColor=TEAL, spaceAfter=7, tracking=1.4))
styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=34, leading=37, textColor=INK, alignment=TA_LEFT, spaceAfter=4))
styles.add(ParagraphStyle(name="CoverSub", parent=styles["Normal"], fontName="Helvetica", fontSize=14, leading=19, textColor=MUTED, spaceAfter=15))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=INK, spaceBefore=2, spaceAfter=10, keepWithNext=True))
styles.add(ParagraphStyle(name="Subsection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=14.5, textColor=TEAL, spaceBefore=6, spaceAfter=4, keepWithNext=True))
styles.add(ParagraphStyle(name="BodyX", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13, textColor=INK, spaceAfter=6))
styles.add(ParagraphStyle(name="SmallX", parent=styles["BodyText"], fontName="Helvetica", fontSize=8, leading=10.5, textColor=MUTED, spaceAfter=3))
styles.add(ParagraphStyle(name="CardTitle", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK, spaceAfter=3))
styles.add(ParagraphStyle(name="CardBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.7, leading=12, textColor=INK, spaceAfter=2))
styles.add(ParagraphStyle(name="Kicker", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=TEAL, spaceAfter=2))
styles.add(ParagraphStyle(name="BulletX", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.8, leading=12, textColor=INK, leftIndent=12, firstLineIndent=-8, bulletIndent=0, spaceAfter=3))
styles.add(ParagraphStyle(name="TableHeadX", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=WHITE))
styles.add(ParagraphStyle(name="TableCellX", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.8, leading=10, textColor=INK))
styles.add(ParagraphStyle(name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=12.5, textColor=INK, spaceAfter=0))


def P(text, style="BodyX"):
    return Paragraph(text, styles[style])


def bullets(lines):
    return [Paragraph("- " + line, styles["BulletX"]) for line in lines]


def card(kicker, title, body, bg=TEAL_PALE):
    cell = [P(kicker.upper(), "Kicker"), P(title, "CardTitle"), P(body, "CardBody")]
    table = Table([[cell]], colWidths=[174*mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), bg), ("BOX", (0,0), (-1,-1), 0.6, LINE),
        ("LEFTPADDING", (0,0), (-1,-1), 10), ("RIGHTPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING", (0,0), (-1,-1), 8), ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    return table


def link(label, href):
    return f'<link href="{href}" color="{TEAL.hexval()}"><u>{label}</u></link>'


def page_decoration(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(18*mm, height-15*mm, width-18*mm, height-15*mm)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(TEAL)
    canvas.drawString(18*mm, height-11.5*mm, "BRANDLENS  /  CODEX 48")
    canvas.setStrokeColor(LINE)
    canvas.line(18*mm, 14*mm, width-18*mm, 14*mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18*mm, 9*mm, "Round 3 project report  |  Hariom Thakur")
    canvas.drawRightString(width-18*mm, 9*mm, f"{doc.page}")
    canvas.restoreState()


story = []

# Page 1 - project and user workflow
story += [Spacer(1, 7*mm), P("CODEX 48  /  ROUND 3 FINAL SUBMISSION", "CoverEyebrow"), P("BrandLens", "CoverTitle"), P("Evidence-led review and approval for marketing content", "CoverSub")]
meta = Table([
    [P("PARTICIPANT", "Kicker"), P("TEAM", "Kicker"), P("ROLE", "Kicker")],
    [P("Hariom Thakur", "CardTitle"), P("Solo team", "CardTitle"), P("Product, full-stack development, testing and documentation", "CardBody")],
], colWidths=[47*mm, 34*mm, 93*mm])
meta.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), BLUE_PALE), ("BOX", (0,0), (-1,-1), 0.6, LINE),
    ("INNERGRID", (0,0), (-1,-1), 0.4, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8),
    ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7),
]))
story += [meta, Spacer(1, 5*mm)]
story.append(card("Project links", "Open the product and code", f"Demo: {link('brandlens-round2.onrender.com', 'https://brandlens-round2.onrender.com')}<br/>Repository: {link('github.com/HariomSThakur/Brandlens', 'https://github.com/HariomSThakur/Brandlens')}", BLUE_PALE))
story += [Spacer(1, 5*mm), P("The problem", "Section"), P("Marketing teams reuse product facts, research results and approved claims across many drafts. Reviewers often have to search source documents manually to check exact wording, numbers and dates. Unsupported or outdated claims can slip through, and decisions become difficult to trace.")]
story += [P("The solution", "Subsection"), P("BrandLens gives small marketing and communications teams one evidence-linked workflow. A creator writes or imports a draft; deterministic checks compare it with approved sources, claims and writing rules; finding cards show the relevant text and evidence; a person resolves the findings and records approval. The app never publishes content automatically.")]
story.append(card("Core journey", "Draft to accountable decision", "1. Write or import a text/Markdown draft.  2. Run deterministic checks and inspect evidence-linked findings.  3. Accept a verified edit or make a manual change.  4. Re-run review.  5. A Reviewer or Admin records a decision against the current draft and evidence versions.", TEAL_PALE))
story += [Spacer(1, 4*mm), P("The bundled Luma Botanics workspace is fictional. It demonstrates the numeric-conflict example: a claim that a result happened in 3 days is checked against a 28-day consumer test that measured hydration, not pigmentation.", "SmallX"), PageBreak()]

# Page 2 - three improvements
story += [Spacer(1, 4*mm), P("Round 3 improvements delivered", "Section"), P("The build extends the Round 2 workflow with evidence lifecycle management, policy feedback and safer revision suggestions.")]
story.append(card("Improvement 1", "Evidence-backed claim ledger and conflict detection", "Each claim stores an owner, exact supporting excerpt, source ID and version, extracted key values with units, approved alternative wording, and a review date. Draft review flags numeric conflicts. Source changes, claim edits and expiry can queue dependent claims and previous approvals for a fresh human review. Approvals retain the claim and source versions they used; earlier records are preserved.", TEAL_PALE))
story += [Spacer(1, 3*mm)]
story.append(card("Improvement 2", "Guideline-health insights that close the loop", "BrandLens groups repeated dismissals, accepted edits and escalations, and surfaces incompatible threshold guidance or a restricted term used by an approved claim. The page shows examples behind each signal. An Admin can record a decision to clarify a rule, add an exception or retire it, with a rationale. Follow-up dismissal rates appear when later outcomes exist. Policy is never edited automatically.", BLUE_PALE))
story += [Spacer(1, 3*mm)]
story.append(card("Improvement 3", "Verified minimal-diff rewrites", "Suggestions use explicit terminology replacements from approved guidance or alternative wording already stored in the claim ledger. Optional AI tone suggestions are advisory. BrandLens protects links, names and numbers, checks claim values against the exact evidence excerpt, then re-runs deterministic checks. Each edit can be accepted or rejected separately; word-level differences and revision history are retained.", TEAL_PALE))
story += [Spacer(1, 4*mm), P("Completed product features", "Subsection")]
story += bullets([
    "Draft editor and plain text / Markdown import, with a 30,000-character limit.",
    "Findings for unsupported or expired claims, numeric conflicts, restricted terminology, all-caps text, repeated exclamation marks and long sentences.",
    "Source version history, evidence-backed claim ledger, re-review queue, guideline-health page and owner-decision tracking.",
    "Human approval records, local JSON backup, Light / Black / Dark blue themes, and Supabase Admin / Reviewer / Creator access code.",
])
story.append(PageBreak())

# Page 3 - technical architecture and reliability
story += [Spacer(1, 4*mm), P("Technical implementation", "Section"), P("The browser keeps the dependable review path local and deterministic. Optional infrastructure adds shared accounts and advisory model review without making either a prerequisite for the core workflow.")]
arch = Table([
    [P("USER", "TableHeadX"), P("APP", "TableHeadX"), P("OPTIONAL SERVICES", "TableHeadX")],
    [P("Draft editor<br/>Evidence library<br/>Human decisions", "TableCellX"), P("HTML / CSS / vanilla JS<br/>Shared rule modules<br/>Finding and revision UI", "TableCellX"), P("Node.js 20 HTTP server<br/>Supabase Auth + Postgres<br/>Ollama / Qwen advisory path", "TableCellX")],
], colWidths=[53*mm, 62*mm, 59*mm])
arch.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), TEAL), ("BACKGROUND", (0,1), (-1,1), BLUE_PALE),
    ("BOX", (0,0), (-1,-1), 0.6, LINE), ("INNERGRID", (0,0), (-1,-1), 0.5, LINE),
    ("VALIGN", (0,0), (-1,-1), "TOP"), ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 8),
    ("BOTTOMPADDING", (0,0), (-1,-1), 8),
]))
story += [arch, Spacer(1, 4*mm), P("Stack and data flow", "Subsection")]
story += bullets([
    "HTML, CSS and browser JavaScript ES modules; a small Node.js 20 server uses built-in modules and has no runtime package dependencies.",
    "Deterministic rules run in the browser against the draft, approved claims, source excerpts and dates. The review continues if a model or network connection fails.",
    "Optional Ollama/Qwen output is advisory. Exact draft quotes are checked, claim replacements cannot be generated by the model, and no AI output approves or publishes.",
    "Supabase Auth and Postgres store a shared JSONB workspace. Row-level security and role-checked RPCs enforce Admin, Reviewer and Creator access. An expected revision rejects stale saves with a reload message.",
    "Shared audit events use a separate append-only table. The database assigns event actor and timestamp; snapshot saves preserve the database audit history instead of accepting client edits to it.",
    "Render serves the public Node.js app. Local mode uses browser storage; hosted Qwen is not configured in this build, so the hosted review mode is deterministic unless an Ollama endpoint and model are configured.",
])
story.append(card("Reliability boundaries", "A human remains responsible", "Deterministic checks identify known patterns; they do not prove truth or guarantee that every claim is found. The database protects shared role boundaries and prevents stale snapshot overwrites. The append-only table prevents later update/delete of stored events, but it is not a cryptographic signature system. Apply the latest supabase/schema.sql before relying on the new shared audit stream.", BLUE_PALE))
story.append(PageBreak())

# Page 4 - plan changes, tests, limitations and contribution
story += [Spacer(1, 4*mm), P("Plan changes and verification", "Section"), P("The Round 1 proposal was narrowed during implementation to prioritize the highest-risk, end-to-end workflow: evidence-linked claims, human review and traceable decisions.")]
story += [P("Changes from the original plan", "Subsection")]
story += bullets([
    "The project uses a small Node.js server and vanilla browser modules rather than a heavier frontend framework, keeping the core workflow deployable with few dependencies.",
    "The Round 3 build adds the promised claim lifecycle, guideline-health insights and verified minimal rewrites.",
    "Plain text and Markdown import are implemented. DOCX parsing, image and alt-text checks, automated invitation email, workspace switching and multilingual review are deferred.",
    "The shared workspace remains a JSONB snapshot for this MVP; append-only audit events are separated into their own table, and a revision check blocks stale snapshot saves.",
])
story += [P("Testing notes", "Subsection")]
story += bullets([
    "npm test: 10 focused tests pass for quantity extraction, source and claim version invalidation, expiry queues, guideline conflicts, follow-up rates, safe rewrites, protected values and word diffs.",
    "npm run eval: 40 frozen synthetic drafts, including 15 clean drafts, score 100.0% micro precision and recall with 0 false alarms on the clean set. The project author wrote the rules, fixtures and labels; this is a self-check, not independent validation.",
    "Syntax checks pass for the browser modules and Node server. This environment denied loopback socket access, so automated local HTTP/browser smoke testing could not be completed.",
    "Live shared-account and audit-RPC tests require the owner to apply the latest Supabase schema and verify separate Reviewer and Creator accounts. User interviews completed: n=0.",
])
story.append(card("Known scope limits", "What is not included", "The demo uses fictional brand data. The hosted app has no Qwen checkpoint configured unless the owner adds an Ollama model endpoint. DOCX / image checking and automated invite emails are not implemented. These limits are disclosed so judges can assess the working scope accurately.", BLUE_PALE))
story += [Spacer(1, 4*mm), P("Team member contribution and AI disclosure", "Subsection"), P("Hariom Thakur is the only team member. He defined the product direction and workflows, chose the core scope and role model, set up the Supabase / Render services, ran the project and validation scenarios, and prepared the submission. OpenAI Codex was used as a significant AI coding assistant for implementation, debugging and documentation. The participant should edit this contribution statement to match his own work and wording before filing the individual event form.")]
story += [Spacer(1, 2*mm), P(f"Official event page: {link('Codex 48 - We Code Coders', 'https://wecodecoders.in/events/codex-48')}", "SmallX")]

doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=21*mm, bottomMargin=19*mm, title="BrandLens - Codex 48 Round 3 Submission", author="Hariom Thakur", subject="Round 3 final project report")
doc.build(story, onFirstPage=page_decoration, onLaterPages=page_decoration)
print(OUTPUT)
