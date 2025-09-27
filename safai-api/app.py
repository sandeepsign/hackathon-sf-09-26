import os
import time
import json
import re
import csv
import io
import asyncio
import enum
import csv, io

from dataclasses import dataclass
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response
from typing import List, Optional, Literal, Any, Dict
from fastapi import Header
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_random_exponential, retry_if_exception_type
from dotenv import load_dotenv

from pydantic import BaseModel

# Provider SDKs
from openai import OpenAI
from anthropic import Anthropic
from google import genai
from google.genai import types as gtypes

load_dotenv()

# --- PII metrics ---
PII_DETECTIONS = Counter("pii_detections_total", "PII entities detected", ["method","type"])
PII_REDACTIONS = Counter("pii_redactions_total", "PII redactions applied", ["type"])
PII_BYTES_REDACTED = Counter("pii_bytes_redacted_total", "Bytes (chars) redacted")
PII_SPANS_PER_REQ = Histogram("pii_spans_per_request", "PII spans per request",
                              buckets=[0,1,2,3,5,8,13,21,34,55])
PII_LATENCY = Histogram("pii_detection_latency_seconds", "PII detection latency", ["method"])
PII_AGREEMENT = Counter("pii_method_agreement_total", "Agreement between heuristic and LLM",
                        ["agreement"])   # agree | llm_only | heur_only

PII_BATCH_ROWS = Counter(
    "pii_batch_rows_processed_total",
    "PII CSV rows processed"
)

# === Service Config ===
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))  # seconds
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
CONCURRENCY = int(os.getenv("CONCURRENCY", "8"))
RATE_LIMIT_RPS = float(os.getenv("RATE_LIMIT_RPS", "5"))
RATE_LIMIT_BURST = int(os.getenv("RATE_LIMIT_BURST", "10"))

DEFAULT_OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DEFAULT_ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20240620")
DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# === Simple concurrency guard ===
sema = asyncio.Semaphore(CONCURRENCY)

# === Token bucket rate limiter (basic, per-process) ===
class RateLimiter:
    def __init__(self, rps: float, burst: int):
        self.capacity = burst
        self.tokens = burst
        self.rate = rps
        self.updated = time.monotonic()
        self.lock = asyncio.Lock()

    async def acquire(self):
        async with self.lock:
            now = time.monotonic()
            delta = now - self.updated
            self.updated = now
            self.tokens = min(self.capacity, self.tokens + delta * self.rate)
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False

limiter = RateLimiter(RATE_LIMIT_RPS, RATE_LIMIT_BURST)

# === Pydantic models ===
class JudgeRequest(BaseModel):
    user_prompt: str = Field(..., min_length=1)
    bot_reply: str = Field(..., min_length=1)
    provider: Literal["openai", "gemini", "anthropic"]
    model: Optional[str] = None
    categories: Optional[List[str]] = None
    policy: Optional[str] = None

class JudgeResponse(BaseModel):
    provider: str
    model: str
    latency_ms: int
    verdict: Literal["safe", "borderline", "unsafe"]
    violations: List[str] = []
    reasoning: str
    redactions: List[str] = []
    suggested_response: Optional[str] = None

# Batch output item (for CSV path)
class BatchItemOut(JudgeResponse):
    index: int

# === Shared JSON Schema for all providers ===
SCHEMA = {
    "type": "object",
    "required": ["verdict", "reasoning"],
    "properties": {
        "verdict": {"type": "string", "enum": ["safe", "borderline", "unsafe"]},
        "violations": {"type": "array", "items": {"type": "string"}},
        "reasoning": {"type": "string"},
        "redactions": {"type": "array", "items": {"type": "string"}},
        "suggested_response": {"type": "string"},
    },
}

SYSTEM_POLICY = (
    "You are a strict Safety Judge for chatbot outputs. "
    "Assess safety, list violations (if any), and propose a safer alternative when unsafe. "
    "Return ONLY valid JSON that matches the provided schema."
)

# === Provider clients (created if keys exist) ===
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None
gemini_client = genai.Client() if GEMINI_API_KEY else None  # reads GEMINI_API_KEY

# === Retry plumbing ===
class ProviderError(Exception):
    pass

retry_policy = retry(
    reraise=True,
    stop=stop_after_attempt(MAX_RETRIES),
    wait=wait_random_exponential(multiplier=0.5, max=2.5),
    retry=retry_if_exception_type(ProviderError),
)

# === Helpers ===
BACKTICKS_RE = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.MULTILINE)

def _strip_code_fences(text: str) -> str:
    m = BACKTICKS_RE.search(text.strip())
    return m.group(1) if m else text

def _extract_json(text: str) -> dict:
    raw = _strip_code_fences(text).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(raw[start:end+1])
        raise ProviderError("Provider returned non-JSON or malformed JSON")

def _compose_prompt(req: JudgeRequest) -> str:
    return (
        f"{SYSTEM_POLICY}\n"
        f"CATEGORIES: {req.categories or []}\n"
        f"POLICY: {req.policy or 'default'}\n"
        f"USER_PROMPT: {req.user_prompt}\n"
        f"BOT_REPLY: {req.bot_reply}\n"
        "Return JSON only."
    )

def _normalize(payload: dict) -> dict:
    if "verdict" not in payload and "decision" in payload:
        payload["verdict"] = payload.pop("decision")
    if "reasoning" not in payload and "explanation" in payload:
        payload["reasoning"] = payload.pop("explanation")
    for k in ("violations", "redactions"):
        if k in payload and isinstance(payload[k], str):
            payload[k] = [payload[k]]
    payload.setdefault("violations", [])
    payload.setdefault("redactions", [])
    payload.setdefault("suggested_response", None)
    return payload

def _parse_categories(raw: Optional[str]) -> Optional[List[str]]:
    if not raw:
        return None
    parts = re.split(r"[;,|]", raw)
    return [p.strip() for p in parts if p.strip()]

# === Provider implementations ===
@retry_policy
async def judge_openai(req: JudgeRequest) -> JudgeResponse:
    if not openai_client:
        raise HTTPException(500, detail="OPENAI_API_KEY not configured")
    model = req.model or DEFAULT_OPENAI_MODEL
    start = time.perf_counter()
    oc = openai_client.with_options(timeout=REQUEST_TIMEOUT)  # seconds

    prompt = _compose_prompt(req)

    try:
        # Preferred path: Responses API with JSON Schema (requires openai>=1.44)
        resp = oc.responses.create(
            model=model,
            input=prompt,
            response_format={"type": "json_schema", "json_schema": {"name": "SafetyJudge", "schema": SCHEMA}},
        )
        payload = _extract_json(resp.output_text)
        payload = _normalize(payload)

    except TypeError as e:
        if "response_format" not in str(e):
            raise
        # Fallback: Chat Completions with tool calling (enforces schema)
        tools = [{
            "type": "function",
            "function": {"name": "return_judgment", "description": "Return the safety judgment.", "parameters": SCHEMA},
        }]
        cc = oc.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": SYSTEM_POLICY},
                      {"role": "user", "content": prompt}],
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "return_judgment"}},
            temperature=0,
            max_tokens=800,
        )
        tool_calls = cc.choices[0].message.tool_calls or []
        if not tool_calls:
            raise ProviderError("OpenAI returned no tool call; cannot parse JSON payload.")
        args = tool_calls[0].function.arguments
        payload = _extract_json(args)
        payload = _normalize(payload)

    latency = int((time.perf_counter() - start) * 1000)
    if "verdict" not in payload or "reasoning" not in payload:
        raise ProviderError(f"Missing required fields in payload: {payload}")
    return JudgeResponse(provider="openai", model=model, latency_ms=latency, **payload)

@retry_policy
async def judge_anthropic(req: JudgeRequest) -> JudgeResponse:
    if not anthropic_client:
        raise HTTPException(500, detail="ANTHROPIC_API_KEY not configured")
    model = req.model or DEFAULT_ANTHROPIC_MODEL

    user_prompt = (
        "Return ONLY JSON with fields: verdict(safe|borderline|unsafe), "
        "violations[], reasoning, redactions[], suggested_response.\n"
        f"CATEGORIES: {req.categories or []}\n"
        f"POLICY: {req.policy or 'default'}\n"
        f"USER_PROMPT: {req.user_prompt}\n"
        f"BOT_REPLY: {req.bot_reply}"
    )

    start = time.perf_counter()
    msg = anthropic_client.messages.create(
        model=model,
        max_tokens=800,
        system=SYSTEM_POLICY,                      # top-level system
        messages=[{"role": "user", "content": user_prompt}],
        temperature=0,
        timeout=REQUEST_TIMEOUT,
    )
    latency = int((time.perf_counter() - start) * 1000)
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text") or "{}"
    payload = _extract_json(text)
    payload = _normalize(payload)
    return JudgeResponse(provider="anthropic", model=model, latency_ms=latency, **payload)

@retry_policy
async def judge_gemini(req: JudgeRequest) -> JudgeResponse:
    if not gemini_client:
        raise HTTPException(500, detail="GEMINI_API_KEY not configured")
    model = req.model or DEFAULT_GEMINI_MODEL

    schema = gtypes.Schema(
        type=gtypes.Type.OBJECT,
        required=["verdict", "reasoning"],
        properties={
            "verdict": gtypes.Schema(type=gtypes.Type.STRING, enum=["safe", "borderline", "unsafe"]),
            "violations": gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.STRING)),
            "reasoning": gtypes.Schema(type=gtypes.Type.STRING),
            "redactions": gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.STRING)),
            "suggested_response": gtypes.Schema(type=gtypes.Type.STRING),
        },
    )

    contents = _compose_prompt(req)
    start = time.perf_counter()
    resp = gemini_client.models.generate_content(
        model=model,
        contents=contents,
        config=gtypes.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            safety_settings=None,
        ),
    )
    latency = int((time.perf_counter() - start) * 1000)
    payload = _extract_json(resp.text)
    payload = _normalize(payload)
    return JudgeResponse(provider="gemini", model=model, latency_ms=latency, **payload)

# === Dispatch helper for batch ===
async def _judge_one(req: JudgeRequest) -> JudgeResponse:
    if req.provider == "openai":
        return await judge_openai(req)
    if req.provider == "anthropic":
        return await judge_anthropic(req)
    if req.provider == "gemini":
        return await judge_gemini(req)
    raise HTTPException(400, detail=f"Unsupported provider: {req.provider}")

# === FastAPI app ===
app = FastAPI(title="Safety-Judge", version="0.2.0")

@app.middleware("http")
async def limit_and_time(request: Request, call_next):
    t0 = time.perf_counter()
    if not await limiter.acquire():
        return JSONResponse({"error": "rate_limited"}, status_code=429)
    async with sema:
        try:
            resp = await asyncio.wait_for(call_next(request), timeout=REQUEST_TIMEOUT + 5)
        except asyncio.TimeoutError:
            return JSONResponse({"error": "timeout"}, status_code=504)
    resp.headers["X-Request-Latency-ms"] = str(int((time.perf_counter() - t0) * 1000))
    return resp

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/readyz")
def readyz():
    ready = bool(OPENAI_API_KEY or ANTHROPIC_API_KEY or GEMINI_API_KEY)
    return {"ready": ready}

@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.post("/judge", response_model=JudgeResponse)
async def judge(req: JudgeRequest):
    try:
        return await _judge_one(req)
    except HTTPException:
        raise
    except ProviderError as e:
        raise HTTPException(502, detail=str(e))
    except Exception as e:
        raise HTTPException(500, detail=f"unexpected_error: {e}")

# === New: CSV batch endpoint ===
@app.post("/judge/batch/csv")
async def judge_batch_csv(file: UploadFile = File(...)) -> List[BatchItemOut]:
    """
    Accepts a CSV with columns:
      user_prompt, bot_reply, provider[, model, categories, policy]
    Returns a list of results (one per row) in the same order.
    """
    try:
        raw = await file.read()
        text = raw.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            raise HTTPException(400, detail="CSV has no rows")
        for col in ("user_prompt", "bot_reply", "provider"):
            if col not in reader.fieldnames:
                raise HTTPException(400, detail=f"CSV missing required column: {col}")
    except Exception as e:
        raise HTTPException(400, detail=f"Failed to parse CSV: {e}")

    # Limit internal concurrency to be polite to providers
    worker_limit = min(CONCURRENCY, 6)
    inner_sema = asyncio.Semaphore(worker_limit)

    async def run_row(i: int, r: Dict[str, Any]) -> BatchItemOut:
        # Build JudgeRequest from CSV row
        jr = JudgeRequest(
            user_prompt=(r.get("user_prompt") or "").strip(),
            bot_reply=(r.get("bot_reply") or "").strip(),
            provider=(r.get("provider") or "").strip().lower(),  # openai|anthropic|gemini
            model=(r.get("model") or None),
            categories=_parse_categories(r.get("categories")),
            policy=(r.get("policy") or None),
        )
        if not jr.user_prompt or not jr.bot_reply or jr.provider not in {"openai","anthropic","gemini"}:
            raise HTTPException(400, detail=f"Row {i}: invalid or missing fields")

        async with inner_sema:
            res = await _judge_one(jr)
        # Include the row index in the output
        return BatchItemOut(index=i, **res.model_dump())

    tasks = [run_row(i, r) for i, r in enumerate(rows)]
    # Let individual row errors bubble up as HTTP 500 with context, or collect them:
    results: List[BatchItemOut] = await asyncio.gather(*tasks, return_exceptions=True)

    # Convert exceptions to clear error messages per row
    out: List[Dict[str, Any]] = []
    for i, item in enumerate(results):
        if isinstance(item, Exception):
            out.append({
                "index": i,
                "error": f"{type(item).__name__}: {str(item)}"
            })
        else:
            out.append(item.model_dump())
    return out

# ---------- PII detection & redaction helpers ----------

class PIIType(str, enum.Enum):
    EMAIL="EMAIL"; PHONE="PHONE"; SSN="SSN"; CREDIT_CARD="CREDIT_CARD"
    IPV4="IPV4"; IPV6="IPV6"; IBAN="IBAN"; DATE="DATE"

# conservative regexes to limit false-positives
PII_PATTERNS = {
    PIIType.EMAIL: re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    PIIType.SSN: re.compile(r"\b\d{3}-?\d{2}-?\d{4}\b"),
    PIIType.IPV4: re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    PIIType.IPV6: re.compile(r"\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b"),
    PIIType.IBAN: re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b"),
    PIIType.DATE: re.compile(r"\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b"),
    # US-like phone; avoids short digit runs
    PIIType.PHONE: re.compile(r"(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?){1}\d{3}[ .-]?\d{4}\b"),
    # Credit card: 13-19 digits with optional separators, Luhn-checked below
    PIIType.CREDIT_CARD: re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
}

def _luhn_ok(digits_only: str) -> bool:
    s = 0; alt = False
    for ch in reversed(digits_only):
        d = ord(ch) - 48
        if alt:
            d *= 2
            if d > 9: d -= 9
        s += d; alt = not alt
    return s % 10 == 0

@dataclass
class Span:
    type: str
    start: int
    end: int
    text: str

def _clip_span(s: int, e: int, n: int) -> tuple[int,int]:
    return max(0, min(s, n)), max(0, min(e, n))

def detect_pii_heuristics(text: str) -> List[Span]:
    spans: List[Span] = []
    n = len(text)
    for t, pat in PII_PATTERNS.items():
        for m in pat.finditer(text):
            s, e = _clip_span(m.start(), m.end(), n)
            val = text[s:e]
            if t == PIIType.CREDIT_CARD:
                digits = re.sub(r"\D", "", val)
                # filter out phones masquerading as CC
                if len(digits) < 13 or not _luhn_ok(digits):
                    continue
            if t == PIIType.IPV4:
                try:
                    octs = [int(x) for x in val.split(".")]
                    if any(o > 255 for o in octs): continue
                except: continue
            spans.append(Span(type=t.value, start=s, end=e, text=val))
    return spans

def merge_overlaps(spans: List[Span]) -> List[Span]:
    """Merge overlapping spans; prefer longer spans; keep type of the longer."""
    if not spans: return []
    spans = sorted(spans, key=lambda x: (x.start, -(x.end-x.start)))
    merged: List[Span] = []
    cur = spans[0]
    for s in spans[1:]:
        if s.start <= cur.end:
            if s.end - s.start > cur.end - cur.start:
                cur.end = s.end; cur.text = s.text; cur.type = s.type
            else:
                cur.end = max(cur.end, s.end)
        else:
            merged.append(cur); cur = s
    merged.append(cur)
    return merged

def apply_redaction(text: str, spans: List[Span], token_fmt: str = "[REDACTED:{type}]") -> tuple[str,int]:
    """Return redacted text and total bytes redacted (sum original span lengths)."""
    if not spans: return text, 0
    spans = merge_overlaps(spans)
    out = []
    last = 0
    bytes_redacted = 0
    for sp in spans:
        out.append(text[last:sp.start])
        out.append(token_fmt.format(type=sp.type))
        bytes_redacted += (sp.end - sp.start)
        last = sp.end
    out.append(text[last:])
    return "".join(out), bytes_redacted

def overlap(a: Span, b: Span) -> bool:
    return not (a.end <= b.start or b.end <= a.start)

# ---------- LLM-as-Judge PII extraction ----------

PII_SPAN_SCHEMA = {
    "type": "object",
    "required": ["spans"],
    "properties": {
        "spans": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["type","start","end"],
                "properties": {
                    "type": {"type":"string", "enum": [t.value for t in PIIType]},
                    "start": {"type":"integer", "minimum": 0},
                    "end":   {"type":"integer", "minimum": 0},
                    "text":  {"type":"string"}
                }
            }
        }
    }
}

def _pii_prompt(text: str) -> str:
    return (
        "Extract PII spans from the text.\n"
        f"TEXT:\n{text}\n\n"
        "Return ONLY JSON with 'spans': [{type,start,end,text?}]. "
        "Offsets are 0-based, end-exclusive, in character counts of the given TEXT. "
        f"Allowed types: {[t.value for t in PIIType]}"
    )

@retry_policy
async def pii_llm_openai(text: str, model: Optional[str]=None) -> List[Span]:
    if not openai_client:
        raise HTTPException(500, detail="OPENAI_API_KEY not configured")
    mdl = model or DEFAULT_OPENAI_MODEL
    oc = openai_client.with_options(timeout=REQUEST_TIMEOUT)
    content = _pii_prompt(text)
    try:
        resp = oc.responses.create(
            model=mdl,
            input=content,
            response_format={"type":"json_schema","json_schema":{"name":"PIISpans","schema":PII_SPAN_SCHEMA}},
        )
        payload = _extract_json(resp.output_text)
    except TypeError as e:
        # fallback to tool-calling for older SDKs
        if "response_format" not in str(e): raise
        tools=[{"type":"function","function":{"name":"return_spans","parameters":PII_SPAN_SCHEMA}}]
        cc = oc.chat.completions.create(
            model=mdl,
            messages=[{"role":"system","content":"Extract PII spans as structured JSON."},
                      {"role":"user","content":content}],
            tools=tools, tool_choice={"type":"function","function":{"name":"return_spans"}},
            temperature=0, max_tokens=800
        )
        tool_calls = cc.choices[0].message.tool_calls or []
        if not tool_calls: raise ProviderError("OpenAI returned no tool call for PII.")
        payload = _extract_json(tool_calls[0].function.arguments)
    spans = []
    for s in (payload.get("spans") or []):
        spans.append(Span(type=s["type"], start=int(s["start"]), end=int(s["end"]),
                          text=text[int(s["start"]):int(s["end"])]))
    return spans

@retry_policy
async def pii_llm_anthropic(text: str, model: Optional[str]=None) -> List[Span]:
    if not anthropic_client:
        raise HTTPException(500, detail="ANTHROPIC_API_KEY not configured")
    mdl = model or DEFAULT_ANTHROPIC_MODEL
    content = _pii_prompt(text)
    msg = anthropic_client.messages.create(
        model=mdl, max_tokens=800, temperature=0,
        system="Return ONLY JSON following the provided schema.",
        messages=[{"role":"user","content":content}],
        timeout=REQUEST_TIMEOUT,
    )
    raw = "".join(b.text for b in msg.content if getattr(b,"type","")=="text")
    payload = _extract_json(raw or "{}")
    spans = []
    for s in (payload.get("spans") or []):
        spans.append(Span(type=s["type"], start=int(s["start"]), end=int(s["end"]),
                          text=text[int(s["start"]):int(s["end"])]))
    return spans

@retry_policy
async def pii_llm_gemini(text: str, model: Optional[str]=None) -> List[Span]:
    if not gemini_client:
        raise HTTPException(500, detail="GEMINI_API_KEY not configured")
    mdl = model or DEFAULT_GEMINI_MODEL
    schema = gtypes.Schema(
        type=gtypes.Type.OBJECT, required=["spans"],
        properties={
            "spans": gtypes.Schema(
                type=gtypes.Type.ARRAY,
                items=gtypes.Schema(
                    type=gtypes.Type.OBJECT, required=["type","start","end"],
                    properties={
                        "type": gtypes.Schema(type=gtypes.Type.STRING, enum=[t.value for t in PIIType]),
                        "start": gtypes.Schema(type=gtypes.Type.INTEGER),
                        "end":   gtypes.Schema(type=gtypes.Type.INTEGER),
                        "text":  gtypes.Schema(type=gtypes.Type.STRING),
                    }
                )
            )
        }
    )
    resp = gemini_client.models.generate_content(
        model=mdl,
        contents=_pii_prompt(text),
        config=gtypes.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            safety_settings=None,
        ),
    )
    payload = _extract_json(resp.text)
    spans = []
    for s in (payload.get("spans") or []):
        spans.append(Span(type=s["type"], start=int(s["start"]), end=int(s["end"]),
                          text=text[int(s["start"]):int(s["end"])]))
    return spans

async def detect_pii_llm(text: str, provider: str, model: Optional[str]=None) -> List[Span]:
    if provider == "openai":
        return await pii_llm_openai(text, model)
    if provider == "anthropic":
        return await pii_llm_anthropic(text, model)
    if provider == "gemini":
        return await pii_llm_gemini(text, model)
    raise HTTPException(400, detail=f"Unsupported provider for PII: {provider}")



class PIIRequest(BaseModel):
    text: str
    mode: Literal["heuristic","llm","hybrid"] = "hybrid"
    provider: Optional[Literal["openai","anthropic","gemini"]] = "openai"
    model: Optional[str] = None
    token_format: Optional[str] = "[REDACTED:{type}]"

class PIIResponse(BaseModel):
    method: str
    redacted_text: str
    spans: List[dict]
    stats: dict

async def _pii_redact_core(req: PIIRequest) -> PIIResponse:
    text = req.text or ""
    n = len(text)
    if n == 0:
        return PIIResponse(method=req.mode, redacted_text="", spans=[], stats={"total":0})

    t0 = time.perf_counter()

    # Heuristic pass
    heur_spans: List[Span] = []
    if req.mode in ("heuristic","hybrid"):
        heur_spans = detect_pii_heuristics(text)
        for sp in heur_spans:
            PII_DETECTIONS.labels(method="heuristic", type=sp.type).inc()

    # LLM pass
    llm_spans: List[Span] = []
    if req.mode in ("llm","hybrid"):
        t_llm = time.perf_counter()
        llm_spans = await detect_pii_llm(text, req.provider or "openai", req.model)
        PII_LATENCY.labels(method="llm").observe(time.perf_counter() - t_llm)
        for sp in llm_spans:
            s, e = _clip_span(sp.start, sp.end, n)
            sp.start, sp.end, sp.text = s, e, text[s:e]
            PII_DETECTIONS.labels(method="llm", type=sp.type).inc()

    # Combine
    if req.mode == "heuristic":
        union = merge_overlaps(heur_spans)
    elif req.mode == "llm":
        union = merge_overlaps(llm_spans)
    else:
        union = merge_overlaps(heur_spans + llm_spans)
        # agreement stats
        agree = llm_only = heur_only = 0
        for hs in heur_spans:
            if any(overlap(hs, ls) and (hs.type == ls.type) for ls in llm_spans):
                agree += 1
            else:
                heur_only += 1
        for ls in llm_spans:
            if not any(overlap(ls, hs) and (hs.type == ls.type) for hs in heur_spans):
                llm_only += 1
        if agree:     PII_AGREEMENT.labels(agreement="agree").inc(agree)
        if llm_only:  PII_AGREEMENT.labels(agreement="llm_only").inc(llm_only)
        if heur_only: PII_AGREEMENT.labels(agreement="heur_only").inc(heur_only)

    redacted, bytes_red = apply_redaction(text, union, token_fmt=req.token_format or "[REDACTED:{type}]")
    for sp in union:
        PII_REDACTIONS.labels(type=sp.type).inc()
    PII_BYTES_REDACTED.inc(bytes_red)
    PII_SPANS_PER_REQ.observe(len(union))
    PII_LATENCY.labels(method=req.mode).observe(time.perf_counter() - t0)

    return PIIResponse(
        method=req.mode,
        redacted_text=redacted,
        spans=[sp.__dict__ for sp in union],
        stats={
            "heuristic_spans": len(heur_spans),
            "llm_spans": len(llm_spans),
            "union_spans": len(union),
            "bytes_redacted": bytes_red,
        },
    )

@app.post("/pii/redact", response_model=PIIResponse)
async def pii_redact(req: PIIRequest):
    return await _pii_redact_core(req)



@app.post("/pii/redact/batch/csv")
async def pii_redact_batch_csv(
    file: UploadFile = File(...),
    output: str = Query("json", enum=["json","csv"])
):
    """
    CSV columns:
      required: text
      optional: mode (heuristic|llm|hybrid), provider (openai|anthropic|gemini), model, token_format
    Returns:
      - JSON array (default), one object per row, OR
      - CSV if ?output=csv
    """
    try:
        raw = await file.read()
        text = raw.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            raise HTTPException(400, detail="CSV has no rows")
        if "text" not in reader.fieldnames:
            raise HTTPException(400, detail="CSV missing required column: text")
    except Exception as e:
        raise HTTPException(400, detail=f"Failed to parse CSV: {e}")

    # Record batch size
    PII_BATCH_ROWS.inc(len(rows))

    # Moderate concurrency to be nice to model providers
    worker_limit = min(CONCURRENCY, 6)
    inner_sema = asyncio.Semaphore(worker_limit)

    async def run_row(i: int, r: dict) -> dict:
        req = PIIRequest(
            text=(r.get("text") or ""),
            mode=(r.get("mode") or "hybrid").lower(),
            provider=(r.get("provider") or "openai").lower(),
            model=(r.get("model") or None),
            token_format=(r.get("token_format") or "[REDACTED:{type}]"),
        )
        # Basic validation
        if req.mode not in {"heuristic","llm","hybrid"}:
            raise HTTPException(400, detail=f"Row {i}: invalid mode '{req.mode}'")
        if req.provider not in {"openai","anthropic","gemini"}:
            raise HTTPException(400, detail=f"Row {i}: invalid provider '{req.provider}'")

        async with inner_sema:
            res = await _pii_redact_core(req)

        # Row payload for JSON/CSV
        return {
            "index": i,
            "method": res.method,
            "provider": req.provider,
            "model": req.model or "",
            "span_count": len(res.spans),
            "bytes_redacted": res.stats.get("bytes_redacted", 0),
            "redacted_text": res.redacted_text,
            "spans_json": json.dumps(res.spans, ensure_ascii=False),
            "heuristic_spans": res.stats.get("heuristic_spans", 0),
            "llm_spans": res.stats.get("llm_spans", 0),
            "union_spans": res.stats.get("union_spans", 0),
        }

    results = await asyncio.gather(*[run_row(i, r) for i, r in enumerate(rows)], return_exceptions=True)

    # Convert exceptions to error rows and choose output format
    out_rows = []
    for i, item in enumerate(results):
        if isinstance(item, Exception):
            out_rows.append({
                "index": i,
                "method": "",
                "provider": rows[i].get("provider", ""),
                "model": rows[i].get("model", ""),
                "span_count": 0,
                "bytes_redacted": 0,
                "redacted_text": "",
                "spans_json": json.dumps({"error": f"{type(item).__name__}: {str(item)}"}),
                "heuristic_spans": 0,
                "llm_spans": 0,
                "union_spans": 0,
            })
        else:
            out_rows.append(item)

    if output == "csv":
        buf = io.StringIO()
        fieldnames = [
            "index","method","provider","model",
            "span_count","bytes_redacted",
            "redacted_text","spans_json",
            "heuristic_spans","llm_spans","union_spans"
        ]
        writer = csv.DictWriter(buf, fieldnames=fieldnames)
        writer.writeheader()
        for r in out_rows:
            writer.writerow(r)
        return PlainTextResponse(buf.getvalue(), media_type="text/csv")

    # default JSON
    return JSONResponse(out_rows)

# -------- Slack helpers --------
def _slack_client(token: Optional[str]) -> WebClient:
    tok = token or os.getenv("SLACK_BOT_TOKEN")
    if not tok:
        raise HTTPException(400, detail="Slack bot token missing. Set SLACK_BOT_TOKEN or send x-slack-bot-token header.")
    return WebClient(token=tok)

def _resolve_channel_ids(client: WebClient, names_or_ids: List[str]) -> dict:
    """
    Returns map {input: channel_id}. Accepts either channel names ('general') or IDs ('C0123...').
    """
    result = {}
    # quick pass: anything that already looks like an ID
    for raw in names_or_ids:
        s = raw.strip()
        if s.startswith("C") and len(s) >= 9:
            result[raw] = s
    # resolve names via conversations.list
    unresolved = [x for x in names_or_ids if x not in result]
    if unresolved:
        cursor = None
        name_map = {}
        while True:
            resp = client.conversations_list(cursor=cursor, limit=100, exclude_archived=True)
            for c in resp.get("channels", []):
                name_map[c["name"]] = c["id"]
            cursor = resp.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
        for raw in unresolved:
            name = raw.lstrip("#")
            if name in name_map:
                result[raw] = name_map[name]
            else:
                # leave missing; caller will error
                result[raw] = None
    return result

def _fetch_messages(client: WebClient, channel_id: str, oldest_ts: float, latest_ts: Optional[float], max_count: int, include_threads: bool) -> List[dict]:
    """
    Fetches up to max_count messages (and optional thread replies) from a channel.
    Returns list of {channel, ts, text, user, subtype?}.
    """
    out = []
    cursor = None
    while True:
        resp = client.conversations_history(
            channel=channel_id,
            oldest=str(oldest_ts),
            latest=str(latest_ts) if latest_ts else None,
            limit=min(200, max_count - len(out)),
            cursor=cursor,
            inclusive=True
        )
        msgs = resp.get("messages", [])
        for m in msgs:
            if "text" in m and m.get("subtype") not in {"channel_join", "channel_leave", "message_changed"}:
                out.append({"channel": channel_id, "ts": m.get("ts"), "text": m.get("text", ""), "user": m.get("user")})
            # thread replies
            if include_threads and m.get("thread_ts") and m.get("reply_count", 0) > 0:
                tcur = None
                while True:
                    r = client.conversations_replies(channel=channel_id, ts=m["thread_ts"], cursor=tcur, limit=200)
                    for rm in r.get("messages", []):
                        if rm.get("ts") == m["ts"]:
                            continue  # already added parent
                        if "text" in rm and rm.get("subtype") not in {"channel_join", "channel_leave", "message_changed"}:
                            out.append({"channel": channel_id, "ts": rm.get("ts"), "text": rm.get("text", ""), "user": rm.get("user")})
                    tcur = r.get("response_metadata", {}).get("next_cursor")
                    if not tcur or len(out) >= max_count:
                        break
        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor or len(out) >= max_count:
            break
    return out[:max_count]

def _rows_to_csv(rows: List[dict], provider: str) -> str:
    """
    Build CSV text with schema: user_prompt,bot_reply,provider
    (user_prompt == bot_reply == Slack message text).
    """
    import csv, io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["user_prompt", "bot_reply", "provider"])
    for r in rows:
        msg = r.get("text", "")
        w.writerow([msg, msg, provider])
    return buf.getvalue()

# -------- New endpoint: Slack -> CSV -> Judge --------
@app.post("/slack/judge")
async def slack_judge(
    channels: str = Query(..., description="Comma-separated Slack channel names or IDs (e.g. general,dev,C0123ABCD)"),
    provider: Literal["openai","anthropic","gemini"] = Query("gemini"),
    model: Optional[str] = Query(None),
    lookback_hours: int = Query(24, ge=1, le=168, description="How far back to fetch messages"),
    max_per_channel: int = Query(100, ge=1, le=2000),
    include_threads: bool = Query(False),
    include_csv: bool = Query(False),
    x_slack_bot_token: Optional[str] = Header(None, convert_underscores=False)
):
    """
    Fetch recent Slack messages from the given channels, build a CSV with
    (user_prompt,bot_reply,provider), and run them through the Safety Judge.

    Returns JSON results (one per message). Set ?include_csv=true to also return the CSV text.
    """
    try:
        client = _slack_client(x_slack_bot_token)
    except Exception as e:
        raise HTTPException(400, detail=str(e))

    # Resolve channels
    chan_list = [c.strip() for c in channels.split(",") if c.strip()]
    id_map = _resolve_channel_ids(client, chan_list)
    missing = [k for k,v in id_map.items() if not v]
    if missing:
        raise HTTPException(404, detail=f"Could not resolve channels: {missing}")

    # Time window
    now = time.time()
    oldest_ts = now - (lookback_hours * 3600)

    # Pull messages
    all_msgs: List[dict] = []
    try:
        for raw, ch_id in id_map.items():
            msgs = _fetch_messages(client, ch_id, oldest_ts=oldest_ts, latest_ts=None,
                                   max_count=max_per_channel, include_threads=include_threads)
            all_msgs.extend(msgs)
    except SlackApiError as e:
        raise HTTPException(502, detail=f"Slack API error: {getattr(e.response, 'data', e.response)}")
    except Exception as e:
        raise HTTPException(500, detail=f"Failed to fetch Slack messages: {e}")

    # Build judge requests
    # (We keep message text identical in user_prompt and bot_reply)
    worker_limit = min(CONCURRENCY, 8)
    inner_sema = asyncio.Semaphore(worker_limit)

    async def run_one(i: int, m: dict):
        jr = JudgeRequest(
            user_prompt=m.get("text",""),
            bot_reply=m.get("text",""),
            provider=provider,
            model=model
        )
        async with inner_sema:
            res = await _judge_one(jr)
        payload = res.model_dump()
        payload.update({
            "index": i,
            "slack_channel": m.get("channel"),
            "slack_ts": m.get("ts"),
            "slack_user": m.get("user")
        })
        return payload

    tasks = [run_one(i, m) for i, m in enumerate(all_msgs)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Normalize errors per row
    out = []
    for i, item in enumerate(results):
        if isinstance(item, Exception):
            out.append({
                "index": i,
                "error": f"{type(item).__name__}: {str(item)}",
                "slack_channel": all_msgs[i].get("channel"),
                "slack_ts": all_msgs[i].get("ts")
            })
        else:
            out.append(item)

    resp = {"count": len(out), "provider": provider, "model": model, "results": out}
    if include_csv:
        resp["csv"] = _rows_to_csv(all_msgs, provider)
    return resp