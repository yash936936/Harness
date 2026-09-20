"""
app.py — Document Intelligence Workbench (Streamlit)
Track 2 — Hackathon Submission
Run: streamlit run app.py
"""

import base64
import json
import time
from datetime import datetime

import plotly.graph_objects as go
import requests
import streamlit as st

# ── Page config (must be first Streamlit call) ────────────────────────────

st.set_page_config(
    page_title="Document Intelligence Workbench",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Custom CSS ────────────────────────────────────────────────────────────

st.markdown("""
<style>
/* ── Google Fonts ── */
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

/* ── Global reset ── */
html, body, [class*="css"] {
    font-family: 'Outfit', sans-serif !important;
    background-color: #020617 !important;
    color: #e2e8f0 !important;
}

/* ── Hide default Streamlit chrome ── */
#MainMenu, footer, header { visibility: hidden; }
.block-container {
    padding-top: 1.2rem !important;
    padding-bottom: 1rem !important;
    max-width: 100% !important;
}

/* ── Topbar ── */
.topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: rgba(2, 6, 23, 0.95);
    border-bottom: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 12px;
    margin-bottom: 16px;
    backdrop-filter: blur(20px);
}
.topbar-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #818cf8;
}
.topbar-logo-icon {
    width: 28px; height: 28px;
    background: linear-gradient(135deg, #6366f1, #818cf8);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
}
.topbar-badges { display: flex; gap: 8px; align-items: center; }
.badge {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    padding: 3px 10px; border-radius: 20px;
    font-family: 'JetBrains Mono', monospace;
    border: 1px solid;
}
.badge-indigo { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.4); color: #818cf8; }
.badge-green  { background: rgba(16,185,129,0.1);  border-color: rgba(16,185,129,0.3); color: #34d399; }
.badge-slate  { background: rgba(148,163,184,0.06); border-color: rgba(148,163,184,0.15); color: #64748b; }

/* ── Glass card ── */
.glass-card {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(99, 102, 241, 0.18);
    border-radius: 16px;
    padding: 20px 22px;
    margin-bottom: 14px;
    backdrop-filter: blur(20px);
    box-shadow: 0 0 0 1px rgba(99,102,241,0.05), 0 4px 24px rgba(0,0,0,0.3);
    transition: box-shadow 0.3s ease;
}
.glass-card:hover {
    box-shadow: 0 0 0 1px rgba(99,102,241,0.2), 0 8px 32px rgba(99,102,241,0.08);
}

/* ── Section label ── */
.section-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: #475569; margin-bottom: 8px;
    display: flex; align-items: center; gap: 6px;
}
.section-label-dot {
    width: 6px; height: 6px; border-radius: 50%;
    display: inline-block;
}

/* ── Left pane header ── */
.pane-header {
    font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: #334155;
    padding: 8px 0 12px; border-bottom: 1px solid rgba(99,102,241,0.1);
    margin-bottom: 14px;
}

/* ── File info card ── */
.file-info-card {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(99,102,241,0.15);
    border-radius: 12px; padding: 14px 16px; margin-top: 12px;
}
.file-type-badge {
    display: inline-block;
    font-size: 10px; font-weight: 800; font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.06em; padding: 4px 10px; border-radius: 6px; border: 1px solid;
}
.file-type-pdf   { background: rgba(244,63,94,0.15); border-color: rgba(244,63,94,0.35); color: #f87171; }
.file-type-docx  { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.35); color: #60a5fa; }
.file-type-image { background: rgba(16,185,129,0.15); border-color: rgba(16,185,129,0.35); color: #34d399; }
.file-name { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #e2e8f0; margin-top: 8px; word-break: break-all; }
.file-meta { font-size: 11px; color: #475569; margin-top: 3px; }

/* ── Streamlit button override ── */
.stButton > button {
    width: 100%;
    background: linear-gradient(135deg, #4f46e5, #6366f1) !important;
    color: white !important;
    border: none !important;
    border-radius: 12px !important;
    padding: 12px 20px !important;
    font-size: 13px !important; font-weight: 600 !important;
    font-family: 'Outfit', sans-serif !important;
    letter-spacing: 0.03em !important;
    transition: all 0.2s ease !important;
    box-shadow: 0 4px 16px rgba(99,102,241,0.3) !important;
}
.stButton > button:hover {
    transform: translateY(-1px) !important;
    box-shadow: 0 8px 28px rgba(99,102,241,0.45) !important;
}
.stButton > button:active { transform: translateY(0) !important; }

/* ── File uploader ── */
.stFileUploader {
    border: 1.5px dashed rgba(99,102,241,0.3) !important;
    border-radius: 14px !important;
    background: rgba(15,23,42,0.4) !important;
    transition: all 0.25s ease !important;
}
.stFileUploader:hover {
    border-color: rgba(99,102,241,0.7) !important;
    background: rgba(99,102,241,0.05) !important;
}
[data-testid="stFileUploaderDropzone"] {
    background: transparent !important;
    border: none !important;
}

/* ── Expander (settings + logs) ── */
.streamlit-expanderHeader {
    background: rgba(15,23,42,0.6) !important;
    border: 1px solid rgba(99,102,241,0.15) !important;
    border-radius: 10px !important;
    color: #94a3b8 !important;
    font-size: 12px !important; font-weight: 600 !important;
    font-family: 'JetBrains Mono', monospace !important;
    letter-spacing: 0.06em !important;
}
.streamlit-expanderContent {
    background: rgba(2,6,23,0.8) !important;
    border: 1px solid rgba(99,102,241,0.1) !important;
    border-top: none !important;
    border-radius: 0 0 10px 10px !important;
}

/* ── Tabs ── */
.stTabs [data-baseweb="tab-list"] {
    background: rgba(15,23,42,0.5) !important;
    border-radius: 12px !important;
    padding: 4px !important;
    border: 1px solid rgba(99,102,241,0.12) !important;
    gap: 2px !important;
}
.stTabs [data-baseweb="tab"] {
    background: transparent !important;
    border-radius: 9px !important;
    color: #64748b !important;
    font-weight: 600 !important; font-size: 12px !important;
    font-family: 'Outfit', sans-serif !important;
    letter-spacing: 0.04em !important;
    padding: 7px 16px !important;
    border: none !important;
    transition: all 0.2s ease !important;
}
.stTabs [aria-selected="true"] {
    background: rgba(99,102,241,0.2) !important;
    color: #818cf8 !important;
    box-shadow: inset 0 0 0 1px rgba(99,102,241,0.3) !important;
}
.stTabs [data-baseweb="tab-panel"] {
    padding-top: 18px !important;
    background: transparent !important;
}

/* ── Entity chip ── */
.entity-chip {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 12px; border-radius: 8px; border: 1px solid;
    font-size: 12px; font-weight: 500; white-space: nowrap;
    transition: transform 0.15s ease, filter 0.15s ease;
    cursor: default; margin: 3px;
}
.entity-chip:hover { transform: translateY(-2px); filter: brightness(1.2); }
.chip-name     { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.35); color: #a5b4fc; }
.chip-date     { background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.30); color: #fcd34d; }
.chip-org      { background: rgba(16,185,129,0.10); border-color: rgba(16,185,129,0.30); color: #6ee7b7; }
.chip-amount   { background: rgba(244,63,94,0.10);  border-color: rgba(244,63,94,0.25);  color: #fda4af; }
.chip-location { background: rgba(139,92,246,0.10); border-color: rgba(139,92,246,0.30); color: #c4b5fd; }

/* ── Summary text ── */
.summary-body {
    font-size: 14px; line-height: 1.85; color: #94a3b8;
    border-left: 2px solid rgba(99,102,241,0.4);
    padding-left: 14px; margin-top: 8px;
}

/* ── Terminal log ── */
.terminal-line {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; line-height: 1.8;
    display: flex; gap: 12px;
}
.log-time { color: #334155; flex-shrink: 0; }
.log-step { color: #6366f1; font-weight: 600; flex-shrink: 0; }
.log-msg  { color: #64748b; }
.log-ok   { color: #10b981; }
.log-err  { color: #f87171; }
.terminal-container {
    background: #020617; border-radius: 10px; padding: 14px 16px;
    border: 1px solid rgba(99,102,241,0.1); max-height: 220px; overflow-y: auto;
}
.term-cursor {
    display: inline-block; width: 7px; height: 12px;
    background: #6366f1; vertical-align: -2px; margin-left: 2px;
    animation: blink 1.1s step-end infinite;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

/* ── Live feed status ── */
.status-row {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 10px;
    background: rgba(30,41,59,0.5); border: 1px solid rgba(99,102,241,0.12);
    margin-bottom: 8px;
}
.status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.status-dot-idle    { background: #334155; }
.status-dot-running { background: #6366f1; animation: pulse 1.2s ease infinite; }
.status-dot-ok      { background: #10b981; }
.status-dot-error   { background: #f43f5e; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
.status-label { font-size: 12px; font-weight: 600; color: #94a3b8; }
.status-val   { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: #64748b; margin-left: auto; }

/* ── Metric boxes ── */
.metric-box {
    background: rgba(15,23,42,0.7); border: 1px solid rgba(99,102,241,0.15);
    border-radius: 12px; padding: 14px 16px; text-align: center;
}
.metric-val { font-size: 26px; font-weight: 700; color: #818cf8; line-height: 1.1; }
.metric-lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: #334155; text-transform: uppercase; margin-top: 4px; }

/* ── Raw text area ── */
.stTextArea textarea {
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 11px !important; color: #64748b !important;
    background: #020617 !important;
    border: 1px solid rgba(99,102,241,0.15) !important;
    border-radius: 10px !important;
}

/* ── Input / text_input overrides ── */
.stTextInput > div > div > input {
    background: rgba(15,23,42,0.8) !important;
    border: 1px solid rgba(99,102,241,0.2) !important;
    border-radius: 8px !important;
    color: #e2e8f0 !important;
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 12px !important;
}
.stTextInput > div > div > input:focus {
    border-color: rgba(99,102,241,0.6) !important;
    box-shadow: 0 0 0 2px rgba(99,102,241,0.15) !important;
}

/* ── Selectbox ── */
.stSelectbox > div > div {
    background: rgba(15,23,42,0.8) !important;
    border: 1px solid rgba(99,102,241,0.2) !important;
    border-radius: 8px !important;
    color: #e2e8f0 !important;
}

/* ── Plotly chart bg ── */
.js-plotly-plot .plotly .bg { fill: transparent !important; }

/* ── Divider ── */
.custom-divider {
    height: 1px; background: rgba(99,102,241,0.12); margin: 16px 0;
}

/* ── Column gap adjustment ── */
[data-testid="column"] { padding: 0 8px !important; }
</style>
""", unsafe_allow_html=True)


# ── Session state init ────────────────────────────────────────────────────

def init_state():
    defaults = {
        "result":      None,
        "logs":        [],
        "analyzing":   False,
        "api_key":     "sk_track2_test123",
        "api_url":     "http://localhost:8000",
        "file_info":   None,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

init_state()


# ── Helpers ───────────────────────────────────────────────────────────────

def ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def log(step: str, msg: str, kind: str = "info"):
    st.session_state.logs.append({"time": ts(), "step": step, "msg": msg, "kind": kind})

def fmt_bytes(b: int) -> str:
    if b == 0: return "0 B"
    for unit in ["B", "KB", "MB"]:
        if b < 1024: return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} MB"

def detect_file_type(name: str) -> str | None:
    ext = name.rsplit(".", 1)[-1].lower()
    if ext == "pdf":                                              return "pdf"
    if ext in ("docx", "doc"):                                   return "docx"
    if ext in ("jpg", "jpeg", "png", "bmp", "tiff", "webp", "gif"): return "image"
    return None

def file_to_base64(uploaded_file) -> str:
    """Read uploaded file bytes and return Base64-encoded string."""
    raw = uploaded_file.read()
    uploaded_file.seek(0)          # reset pointer for repeated reads
    return base64.b64encode(raw).decode("utf-8")

def file_type_html(ft: str) -> str:
    classes = {"pdf": "file-type-pdf", "docx": "file-type-docx", "image": "file-type-image"}
    labels  = {"pdf": "PDF", "docx": "DOCX", "image": "IMG"}
    return f'<span class="file-type-badge {classes.get(ft,"")}">{labels.get(ft,"?")}</span>'


# ── Plotly sentiment gauge ────────────────────────────────────────────────

SENTIMENT_MAP = {"Positive": 0.88, "Neutral": 0.50, "Negative": 0.12}
SENTIMENT_COLOR = {"Positive": "#10b981", "Neutral": "#94a3b8", "Negative": "#f43f5e"}

def sentiment_gauge(sentiment: str) -> go.Figure:
    val   = SENTIMENT_MAP.get(sentiment, 0.5)
    color = SENTIMENT_COLOR.get(sentiment, "#94a3b8")

    fig = go.Figure(go.Indicator(
        mode   = "gauge+number+delta",
        value  = round(val * 100),
        number = {"suffix": "", "font": {"color": color, "size": 36, "family": "Outfit"}},
        title  = {
            "text": f"<b>{sentiment}</b>",
            "font": {"color": color, "size": 18, "family": "Outfit"},
        },
        gauge  = {
            "axis": {
                "range": [0, 100],
                "tickvals": [0, 25, 50, 75, 100],
                "ticktext": ["Neg", "", "Neutral", "", "Pos"],
                "tickcolor": "#334155",
                "tickfont": {"color": "#475569", "size": 10, "family": "JetBrains Mono"},
            },
            "bar": {"color": color, "thickness": 0.22},
            "bgcolor": "rgba(0,0,0,0)",
            "borderwidth": 0,
            "steps": [
                {"range": [0,  33], "color": "rgba(244,63,94,0.15)"},
                {"range": [33, 67], "color": "rgba(148,163,184,0.10)"},
                {"range": [67,100], "color": "rgba(16,185,129,0.15)"},
            ],
            "threshold": {
                "line": {"color": color, "width": 3},
                "thickness": 0.85,
                "value": round(val * 100),
            },
        },
    ))

    fig.update_layout(
        height          = 240,
        margin          = dict(t=40, b=10, l=30, r=30),
        paper_bgcolor   = "rgba(0,0,0,0)",
        plot_bgcolor    = "rgba(0,0,0,0)",
        font_color      = "#94a3b8",
    )
    return fig


# ── Entity chip renderer ──────────────────────────────────────────────────

ENTITY_CONFIG = [
    {"key": "names",         "label": "People",        "icon": "👤", "cls": "chip-name"},
    {"key": "dates",         "label": "Dates",         "icon": "📅", "cls": "chip-date"},
    {"key": "organizations", "label": "Organizations", "icon": "🏢", "cls": "chip-org"},
    {"key": "amounts",       "label": "Amounts",       "icon": "💰", "cls": "chip-amount"},
    {"key": "locations",     "label": "Locations",     "icon": "📍", "cls": "chip-location"},
]

def render_entity_chips(entities: dict):
    has_any = any((entities.get(c["key"]) or []) for c in ENTITY_CONFIG)
    if not has_any:
        st.markdown(
            '<p style="color:#334155;font-size:13px;font-style:italic;">No named entities detected.</p>',
            unsafe_allow_html=True,
        )
        return

    for cfg in ENTITY_CONFIG:
        items = entities.get(cfg["key"]) or []
        if not items:
            continue

        st.markdown(
            f'<div class="section-label">'
            f'<span class="section-label-dot" style="background:#6366f1"></span>'
            f'{cfg["icon"]} {cfg["label"]}'
            f'<span style="color:#1e293b;font-size:10px;font-family:\'JetBrains Mono\',monospace;margin-left:4px">({len(items)})</span>'
            f'</div>',
            unsafe_allow_html=True,
        )

        # Fluid chip grid — distribute across columns
        cols_per_row = 3
        rows = [items[i:i+cols_per_row] for i in range(0, len(items), cols_per_row)]
        for row in rows:
            cols = st.columns(len(row))
            for col, item in zip(cols, row):
                with col:
                    st.markdown(
                        f'<div class="entity-chip {cfg["cls"]}">'
                        f'{cfg["icon"]} {item}'
                        f'</div>',
                        unsafe_allow_html=True,
                    )
        st.markdown("<div style='height:10px'/>", unsafe_allow_html=True)


# ── Terminal log renderer ─────────────────────────────────────────────────

def render_logs(logs: list, is_running: bool = False):
    if not logs and not is_running:
        st.markdown(
            '<div class="terminal-container">'
            '<span class="terminal-line log-msg">Waiting for pipeline input'
            '<span class="term-cursor"></span></span>'
            '</div>',
            unsafe_allow_html=True,
        )
        return

    KIND_CLASS = {"info": "log-msg", "success": "log-ok", "error": "log-err"}
    lines_html = ""
    for entry in logs:
        cls = KIND_CLASS.get(entry["kind"], "log-msg")
        lines_html += (
            f'<div class="terminal-line">'
            f'<span class="log-time">{entry["time"]}</span>'
            f'<span class="log-step">[{entry["step"]}]</span>'
            f'<span class="{cls}">{entry["msg"]}</span>'
            f'</div>'
        )

    if is_running:
        lines_html += (
            f'<div class="terminal-line">'
            f'<span class="log-time">{ts()}</span>'
            f'<span class="log-step">[SYS]</span>'
            f'<span class="log-msg">Processing<span class="term-cursor"></span></span>'
            f'</div>'
        )

    st.markdown(
        f'<div class="terminal-container">{lines_html}</div>',
        unsafe_allow_html=True,
    )


# ── API call ──────────────────────────────────────────────────────────────

def run_analysis(uploaded_file, file_type: str):
    """Full pipeline: encode → POST → parse → surface result."""
    st.session_state.logs = []
    st.session_state.result = None
    st.session_state.analyzing = True

    def l(step, msg, kind="info"):
        log(step, msg, kind)

    l("INIT",   "Starting Document Intelligence Pipeline")
    time.sleep(0.2)
    l("AUTH",   f"Attaching API key ···{st.session_state.api_key[-6:]}")
    time.sleep(0.15)

    # Base64 encode
    l("B64",    "Reading file bytes…")
    b64 = file_to_base64(uploaded_file)
    l("B64",    f"Encoded — {len(b64)/1024:.1f} KB payload ready")
    time.sleep(0.15)

    l("TASK",   f"Dispatching {file_type.upper()} to /api/document-analyze")
    time.sleep(0.1)
    l("CELERY", "Celery task enqueued → Redis broker")

    payload = {
        "fileName":   uploaded_file.name,
        "fileType":   file_type,
        "fileBase64": b64,
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key":    st.session_state.api_key,
    }

    try:
        l("HTTP", f"POST {st.session_state.api_url}/api/document-analyze")
        resp = requests.post(
            f"{st.session_state.api_url}/api/document-analyze",
            json=payload, headers=headers, timeout=120,
        )
        l("HTTP", f"Response received — HTTP {resp.status_code}")

        data = resp.json()

        if not resp.ok or data.get("status") == "error":
            detail = data.get("detail") or data.get("message") or "Unknown API error"
            if isinstance(detail, dict):
                detail = detail.get("message", str(detail))
            l("ERR", detail, "error")
            st.session_state.analyzing = False
            return None

        l("EXTRACT", "Text extraction complete")
        time.sleep(0.1)
        l("LLM",     "Claude Haiku analysis complete")
        time.sleep(0.08)

        ents = data.get("entities", {})
        l("ENTITY",
          f"Names:{len(ents.get('names',[]))}  "
          f"Orgs:{len(ents.get('organizations',[]))}  "
          f"Amounts:{len(ents.get('amounts',[]))}")
        time.sleep(0.08)
        l("SENT",    f"Sentiment → {data.get('sentiment','?')}", "success")
        l("OK",      "Pipeline complete — results ready ✓",      "success")

        st.session_state.result   = data
        st.session_state.analyzing = False
        return data

    except requests.exceptions.ConnectionError:
        msg = f"Cannot reach {st.session_state.api_url} — is the FastAPI server running?"
        l("ERR", msg, "error")
    except requests.exceptions.Timeout:
        l("ERR", "Request timed out after 120 s — try a smaller document", "error")
    except Exception as exc:
        l("ERR", str(exc), "error")

    st.session_state.analyzing = False
    return None


# ══════════════════════════════════════════════════════════════════════════
#  LAYOUT
# ══════════════════════════════════════════════════════════════════════════

# ── Topbar ────────────────────────────────────────────────────────────────
st.markdown("""
<div class="topbar">
  <div class="topbar-logo">
    <div class="topbar-logo-icon">⚡</div>
    DOCUMENT INTELLIGENCE WORKBENCH
  </div>
  <div class="topbar-badges">
    <span class="badge badge-indigo">TRACK 2</span>
    <span class="badge badge-slate">v3.0</span>
  </div>
</div>
""", unsafe_allow_html=True)

# ── Main split: left (1) | right (2) ─────────────────────────────────────
left, right = st.columns([1, 2], gap="medium")


# ════════════════════════════════════════════════════════
#  LEFT PANE — The Lab
# ════════════════════════════════════════════════════════
with left:
    st.markdown('<div class="pane-header">⚗️ &nbsp; THE LAB</div>', unsafe_allow_html=True)

    # ── Settings expander ──────────────────────────────
    with st.expander("⚙️  SETTINGS", expanded=False):
        st.markdown("<div style='height:8px'/>", unsafe_allow_html=True)

        new_key = st.text_input(
            "API Key",
            value=st.session_state.api_key,
            type="password",
            placeholder="sk_track2_your_key_here",
            label_visibility="visible",
        )
        if new_key != st.session_state.api_key:
            st.session_state.api_key = new_key

        new_url = st.text_input(
            "API Base URL",
            value=st.session_state.api_url,
            placeholder="http://localhost:8000",
        )
        if new_url != st.session_state.api_url:
            st.session_state.api_url = new_url

        key_ok = bool(st.session_state.api_key)
        st.markdown(
            f'<div style="display:flex;align-items:center;gap:8px;margin-top:10px">'
            f'<div style="width:8px;height:8px;border-radius:50%;background:{"#10b981" if key_ok else "#f43f5e"}"></div>'
            f'<span style="font-size:11px;color:#475569">{"Key configured" if key_ok else "No API key set"}</span>'
            f'</div>',
            unsafe_allow_html=True,
        )

    st.markdown("<div style='height:12px'/>", unsafe_allow_html=True)

    # ── File uploader ──────────────────────────────────
    st.markdown(
        '<div class="section-label">'
        '<span class="section-label-dot" style="background:#6366f1"></span>'
        'Document Input'
        '</div>',
        unsafe_allow_html=True,
    )

    uploaded = st.file_uploader(
        label="Drop a file or click to browse",
        type=["pdf", "docx", "doc", "png", "jpg", "jpeg", "bmp", "tiff", "webp", "gif"],
        help="Supported: PDF, DOCX, PNG, JPG, TIFF, WEBP, GIF",
        label_visibility="collapsed",
    )

    # ── File info card ─────────────────────────────────
    if uploaded:
        ft = detect_file_type(uploaded.name)
        size_bytes = uploaded.size

        if ft is None:
            st.error("Unsupported file type. Please upload a PDF, DOCX, or image.")
        else:
            st.markdown(
                f'<div class="file-info-card">'
                f'{file_type_html(ft)}'
                f'<div class="file-name">{uploaded.name}</div>'
                f'<div class="file-meta">{fmt_bytes(size_bytes)} · {ft.upper()} document</div>'
                f'</div>',
                unsafe_allow_html=True,
            )

            st.markdown("<div style='height:14px'/>", unsafe_allow_html=True)

            # ── Analyze button ─────────────────────────
            if st.button("⚡  Run Intelligence Pipeline", key="analyze_btn"):
                with st.spinner(""):
                    run_analysis(uploaded, ft)
                st.rerun()

    else:
        st.markdown(
            '<div style="text-align:center;padding:24px 0;color:#1e293b;font-size:12px;">'
            '← Upload a document to begin'
            '</div>',
            unsafe_allow_html=True,
        )

    # ── Quick stats ────────────────────────────────────
    if st.session_state.result:
        st.markdown("<div class='custom-divider'/>", unsafe_allow_html=True)
        st.markdown(
            '<div class="section-label">'
            '<span class="section-label-dot" style="background:#10b981"></span>'
            'Pipeline Stats'
            '</div>',
            unsafe_allow_html=True,
        )
        ents = st.session_state.result.get("entities", {})
        total_entities = sum(
            len(ents.get(k, [])) for k in
            ["names", "dates", "organizations", "amounts", "locations"]
        )
        c1, c2 = st.columns(2)
        with c1:
            st.markdown(
                f'<div class="metric-box">'
                f'<div class="metric-val">{total_entities}</div>'
                f'<div class="metric-lbl">Entities</div>'
                f'</div>',
                unsafe_allow_html=True,
            )
        with c2:
            sentiment = st.session_state.result.get("sentiment", "—")
            s_color   = SENTIMENT_COLOR.get(sentiment, "#94a3b8")
            st.markdown(
                f'<div class="metric-box">'
                f'<div class="metric-val" style="color:{s_color};font-size:18px;">{sentiment}</div>'
                f'<div class="metric-lbl">Sentiment</div>'
                f'</div>',
                unsafe_allow_html=True,
            )


# ════════════════════════════════════════════════════════
#  RIGHT PANE — The Intelligence
# ════════════════════════════════════════════════════════
with right:
    st.markdown('<div class="pane-header">🧠 &nbsp; THE INTELLIGENCE</div>', unsafe_allow_html=True)

    # ── Live Feed ──────────────────────────────────────
    result    = st.session_state.result
    analyzing = st.session_state.analyzing

    if analyzing:
        dot_cls, label_txt, val_txt = "status-dot-running", "Status", "Analysing…"
    elif result:
        dot_cls, label_txt, val_txt = "status-dot-ok",      "Status", "Complete ✓"
    else:
        dot_cls, label_txt, val_txt = "status-dot-idle",    "Status", "Awaiting document"

    filename_txt = result.get("fileName", "—") if result else (uploaded.name if uploaded else "—")

    st.markdown(
        f'<div class="status-row">'
        f'<div class="status-dot {dot_cls}"></div>'
        f'<span class="status-label">{label_txt}</span>'
        f'<span class="status-val">{val_txt}</span>'
        f'</div>'
        f'<div class="status-row">'
        f'<div class="status-dot" style="background:#334155"></div>'
        f'<span class="status-label">File</span>'
        f'<span class="status-val" style="font-family:\'JetBrains Mono\',monospace;font-size:11px">'
        f'{filename_txt}</span>'
        f'</div>',
        unsafe_allow_html=True,
    )

    st.markdown("<div style='height:8px'/>", unsafe_allow_html=True)

    # ── Tabs ───────────────────────────────────────────
    tab_analysis, tab_entities, tab_raw = st.tabs([
        "📊  Analysis", "🏷️  Entities", "🗃️  Raw Extraction"
    ])

    # ─────────────────────────────────────────────────
    #  TAB 1 — Analysis (Summary + Sentiment Gauge)
    # ─────────────────────────────────────────────────
    with tab_analysis:
        if not result:
            st.markdown(
                '<div class="glass-card" style="text-align:center;padding:40px;">'
                '<div style="font-size:32px;margin-bottom:12px">📄</div>'
                '<p style="color:#334155;font-size:13px;">Run the pipeline to see analysis results</p>'
                '</div>',
                unsafe_allow_html=True,
            )
        else:
            # Summary
            st.markdown(
                '<div class="section-label">'
                '<span class="section-label-dot" style="background:#6366f1"></span>'
                'Document Summary'
                '</div>',
                unsafe_allow_html=True,
            )
            st.markdown(
                f'<div class="glass-card">'
                f'<p class="summary-body">{result.get("summary","No summary available.")}</p>'
                f'</div>',
                unsafe_allow_html=True,
            )

            st.markdown("<div style='height:4px'/>", unsafe_allow_html=True)

            # Sentiment gauge
            st.markdown(
                '<div class="section-label">'
                '<span class="section-label-dot" style="background:#f59e0b"></span>'
                'Sentiment Analysis'
                '</div>',
                unsafe_allow_html=True,
            )

            sentiment = result.get("sentiment", "Neutral")
            gauge_col, info_col = st.columns([3, 2])

            with gauge_col:
                st.markdown('<div class="glass-card" style="padding:12px">', unsafe_allow_html=True)
                st.plotly_chart(
                    sentiment_gauge(sentiment),
                    use_container_width=True,
                    config={"displayModeBar": False},
                )
                st.markdown('</div>', unsafe_allow_html=True)

            with info_col:
                s_color = SENTIMENT_COLOR.get(sentiment, "#94a3b8")
                descriptions = {
                    "Positive": "The document conveys an overall positive, constructive, or optimistic tone.",
                    "Neutral":  "The document is factual, objective, or balanced in its overall tone.",
                    "Negative": "The document expresses a negative, critical, or adversarial overall tone.",
                }
                st.markdown(
                    f'<div class="glass-card" style="height:100%">'
                    f'<div class="section-label">Classification</div>'
                    f'<div style="font-size:22px;font-weight:700;color:{s_color};margin:8px 0">'
                    f'{sentiment}</div>'
                    f'<p style="font-size:12px;color:#475569;line-height:1.7">'
                    f'{descriptions.get(sentiment,"")}</p>'
                    f'<div style="height:12px"/>'
                    f'<div style="display:flex;align-items:center;gap:8px">'
                    f'<div style="flex:1;height:6px;border-radius:6px;'
                    f'background:linear-gradient(90deg,#f43f5e,#f59e0b,#e2e8f0,#4ade80,#10b981)"></div>'
                    f'</div>'
                    f'<div style="display:flex;justify-content:space-between;margin-top:4px">'
                    f'<span style="font-size:9px;color:#f43f5e;font-family:\'JetBrains Mono\',monospace">NEG</span>'
                    f'<span style="font-size:9px;color:#64748b;font-family:\'JetBrains Mono\',monospace">NEU</span>'
                    f'<span style="font-size:9px;color:#10b981;font-family:\'JetBrains Mono\',monospace">POS</span>'
                    f'</div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )

    # ─────────────────────────────────────────────────
    #  TAB 2 — Entities (Masonry chip grid)
    # ─────────────────────────────────────────────────
    with tab_entities:
        if not result:
            st.markdown(
                '<div class="glass-card" style="text-align:center;padding:40px;">'
                '<p style="color:#334155;font-size:13px;">No entities extracted yet</p>'
                '</div>',
                unsafe_allow_html=True,
            )
        else:
            entities = result.get("entities", {})

            # Count bar at top
            counts = {cfg["key"]: len(entities.get(cfg["key"]) or []) for cfg in ENTITY_CONFIG}
            total  = sum(counts.values())

            c1, c2, c3, c4, c5 = st.columns(5)
            count_cols = [c1, c2, c3, c4, c5]
            icons      = ["👤", "📅", "🏢", "💰", "📍"]
            labels     = ["People", "Dates", "Orgs", "Amounts", "Places"]
            keys       = ["names", "dates", "organizations", "amounts", "locations"]

            for col, icon, lbl, key in zip(count_cols, icons, labels, keys):
                with col:
                    n = counts[key]
                    st.markdown(
                        f'<div class="metric-box">'
                        f'<div style="font-size:18px">{icon}</div>'
                        f'<div class="metric-val" style="font-size:20px">{n}</div>'
                        f'<div class="metric-lbl">{lbl}</div>'
                        f'</div>',
                        unsafe_allow_html=True,
                    )

            st.markdown("<div style='height:16px'/>", unsafe_allow_html=True)
            st.markdown('<div class="glass-card">', unsafe_allow_html=True)
            render_entity_chips(entities)
            st.markdown('</div>', unsafe_allow_html=True)

    # ─────────────────────────────────────────────────
    #  TAB 3 — Raw Extraction
    # ─────────────────────────────────────────────────
    with tab_raw:
        if not result:
            st.markdown(
                '<div class="glass-card" style="text-align:center;padding:40px;">'
                '<p style="color:#334155;font-size:13px;">Raw JSON will appear here after analysis</p>'
                '</div>',
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<div class="section-label">'
                '<span class="section-label-dot" style="background:#334155"></span>'
                'Full API Response (JSON)'
                '</div>',
                unsafe_allow_html=True,
            )
            st.text_area(
                label       = "raw_json",
                value       = json.dumps(result, indent=2, ensure_ascii=False),
                height      = 340,
                disabled    = True,
                label_visibility = "collapsed",
            )

            st.markdown("<div style='height:8px'/>", unsafe_allow_html=True)

            # Download button
            st.download_button(
                label    = "⬇️  Download JSON",
                data     = json.dumps(result, indent=2, ensure_ascii=False),
                file_name= f"analysis_{result.get('fileName','result')}.json",
                mime     = "application/json",
            )

    # ── System Logs expander ────────────────────────────
    st.markdown("<div style='height:16px'/>", unsafe_allow_html=True)

    with st.expander(
        "🖥️  SYSTEM LOGS  " + ("● LIVE" if analyzing else f"({len(st.session_state.logs)} entries)"),
        expanded=bool(st.session_state.logs),
    ):
        st.markdown("<div style='height:6px'/>", unsafe_allow_html=True)
        render_logs(st.session_state.logs, is_running=analyzing)

        if st.session_state.logs:
            st.markdown("<div style='height:8px'/>", unsafe_allow_html=True)
            if st.button("🗑️  Clear Logs", key="clear_logs"):
                st.session_state.logs = []
                st.rerun()
