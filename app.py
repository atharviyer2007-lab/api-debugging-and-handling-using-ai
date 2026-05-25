"""
NeuralOps v2.0 — API Failure Detection & Debugging Agent
Flask Backend · MCP-style tool reasoning · Groq AI Chat

HOW TO RUN:
  1. pip install flask flask-cors groq
  2. Open this file, find line that says PASTE_YOUR_GROQ_KEY_HERE
  3. Replace it with your key from https://console.groq.com  (free)
  4. python app.py
  5. Open http://127.0.0.1:5000 in browser
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import random
import time
import datetime
import os
import uuid

app = Flask(__name__)
CORS(app)

# ─── Config ────────────────────────────────────────────────────────
ERROR_RATE_THRESHOLD = float(os.getenv("ERROR_RATE_THRESHOLD", "5.0"))
LATENCY_THRESHOLD_MS = int(os.getenv("LATENCY_THRESHOLD_MS",   "300"))
MAX_HISTORY_POINTS   = int(os.getenv("MAX_HISTORY_POINTS",      "60"))

# ─── PASTE YOUR GROQ KEY HERE ──────────────────────────────────────
# Get a FREE key at https://console.groq.com → API Keys → Create Key
GROQ_API_KEY = "PASTE_YOUR_GROQ_KEY_HERE"
# ──────────────────────────────────────────────────────────────────

# ─── Shared State ──────────────────────────────────────────────────
incident_active  = False
incident_type    = None
metrics_history  = []
alert_log        = []
incident_id      = None

# ─── Failure Scenarios ─────────────────────────────────────────────
FAILURE_SCENARIOS = {
    "deployment-regression": {
        "label":          "Deployment Regression",
        "services":       ["payments", "db"],
        "description":    "Faulty HikariCP pool config in payments-api v2.14.1",
        "latency_range":  (800, 2200),
        "error_range":    (14.0, 24.0),
        "gateway_status": "warning",
    },
    "db-overload": {
        "label":          "Database Overload",
        "services":       ["db", "auth", "payments"],
        "description":    "CPU spike on db-primary — slow query storm from unindexed JOIN",
        "latency_range":  (600, 1800),
        "error_range":    (8.0, 18.0),
        "gateway_status": "warning",
    },
    "memory-leak": {
        "label":          "Memory Leak",
        "services":       ["auth"],
        "description":    "Memory leak in auth-service v4.3.0 — GC pressure causing pauses",
        "latency_range":  (300, 800),
        "error_range":    (5.0, 10.0),
        "gateway_status": "ok",
    },
}

SERVICES = {
    "auth":     {"base_latency": 12,  "error_prob": 0.005},
    "payments": {"base_latency": 34,  "error_prob": 0.008},
    "db":       {"base_latency": 8,   "error_prob": 0.003},
    "cdn":      {"base_latency": 5,   "error_prob": 0.001},
    "gateway":  {"base_latency": 21,  "error_prob": 0.004},
}

LOG_POOL = [
    ("INFO",  "GET /api/v2/users 200 OK — 14ms"),
    ("INFO",  "POST /api/v2/auth/token 200 OK — 11ms"),
    ("DEBUG", "DB query: SELECT * FROM sessions — 8ms"),
    ("INFO",  "GET /api/v2/payments/status 200 OK — 32ms"),
    ("INFO",  "CDN cache HIT — edge node fra01"),
    ("INFO",  "Health check passed — all nodes green"),
    ("DEBUG", "Redis cache: HIT ratio 94.2%"),
    ("INFO",  "GET /api/v2/products?page=1 200 OK — 19ms"),
    ("WARN",  "Response time threshold exceeded: /api/v2/products (450ms)"),
    ("DEBUG", "JWT token validated — sub: user#84201"),
    ("INFO",  "Scheduled job: cleanup_sessions completed (0.4s)"),
    ("INFO",  "Outbound webhook delivered: order.completed"),
    ("INFO",  "POST /api/v2/orders 201 Created — 28ms"),
    ("DEBUG", "gRPC call: user-service.GetProfile — 6ms"),
    ("INFO",  "Kafka consumer lag: 0 — partition 0/1/2 all caught up"),
]

INCIDENT_LOG_POOLS = {
    "deployment-regression": [
        ("CRITICAL", "ALERT: error rate spike — 18.4% (threshold: 5%)"),
        ("ERROR",    "DB replication lag: 8.4s on db-replica-02"),
        ("ERROR",    "payments-api: NullPointerException at PaymentProcessor.java:342"),
        ("WARN",     "Auto-scaling triggered: 3 → 8 pods (payments-api)"),
        ("ERROR",    "Circuit breaker OPEN — payments-api (failure rate 62%)"),
        ("CRITICAL", "INCIDENT-001: payments degraded — user impact ~14%"),
        ("ERROR",    "Connection pool exhausted: postgresql://db-primary:5432"),
        ("ERROR",    "Timeout: upstream payment-service >3000ms"),
        ("WARN",     "Rate limit approaching: 4200/5000 req/min"),
        ("ERROR",    "503 Service Unavailable — payments-api pod crash-looping"),
    ],
    "db-overload": [
        ("CRITICAL", "ALERT: db-primary CPU 98% — slow query storm detected"),
        ("ERROR",    "Long-running query detected: SELECT * FROM transactions JOIN users — 14s"),
        ("ERROR",    "DB connection wait timeout: 30s on db-primary"),
        ("WARN",     "Query queue depth: 2,847 pending on db-primary"),
        ("ERROR",    "Cascade: auth-service failing DB lookups — 503 errors"),
        ("CRITICAL", "INCIDENT-002: database overload — all services degraded"),
        ("ERROR",    "Missing index on transactions.user_id — full table scan"),
        ("WARN",     "Read replica db-replica-01 promotion considered"),
    ],
    "memory-leak": [
        ("WARN",     "auth-service pod-2: heap usage 81% — threshold: 75%"),
        ("WARN",     "GC pause: 1.4s on auth-service pod-2 (G1GC)"),
        ("ERROR",    "auth-service pod-2: heap usage 94% — OOM imminent"),
        ("ERROR",    "auth-service pod-2 restarted due to OutOfMemoryError"),
        ("WARN",     "auth-service pod-3 exhibiting same growth pattern"),
        ("CRITICAL", "INCIDENT-003: auth-service memory leak — rolling restarts"),
        ("ERROR",    "Token validation latency: 740ms (normal: 12ms)"),
        ("WARN",     "Kubernetes: 2/4 auth-service pods in CrashLoopBackOff"),
    ],
}

DEPLOYMENTS = [
    {"service": "payments-api", "version": "v2.14.1", "status": "success", "time": "18 min ago", "author": "ci-bot",   "commit": "a3f92d1", "env": "production"},
    {"service": "auth-service", "version": "v4.3.0",  "status": "success", "time": "2 hrs ago",  "author": "priya.k",  "commit": "b7c10e4", "env": "production"},
    {"service": "user-service", "version": "v1.9.8",  "status": "running", "time": "just now",   "author": "alex.m",   "commit": "d92aa31", "env": "staging"},
    {"service": "api-gateway",  "version": "v3.0.5",  "status": "fail",    "time": "47 min ago", "author": "ci-bot",   "commit": "f11bc99", "env": "production"},
    {"service": "cdn-edge",     "version": "v6.1.0",  "status": "success", "time": "5 hrs ago",  "author": "ops-team", "commit": "c44de02", "env": "production"},
]


# ─── MCP Tool Functions ─────────────────────────────────────────────

def get_logs(count=20):
    pool = INCIDENT_LOG_POOLS.get(incident_type, LOG_POOL) if incident_active else LOG_POOL
    logs = []
    for _ in range(count):
        level, msg = random.choice(pool)
        ts = datetime.datetime.now() - datetime.timedelta(seconds=random.randint(0, 30))
        logs.append({
            "timestamp": ts.strftime("%H:%M:%S"),
            "level":     level,
            "message":   msg,
            "service":   random.choice(list(SERVICES.keys()))
        })
    return sorted(logs, key=lambda x: x["timestamp"], reverse=True)


def get_metrics():
    scenario = FAILURE_SCENARIOS.get(incident_type) if incident_active else None

    if scenario:
        avg_latency = random.randint(*scenario["latency_range"])
        error_rate  = round(random.uniform(*scenario["error_range"]), 2)
        active_inci = 1
    else:
        avg_latency = random.randint(10, 60)
        error_rate  = round(random.uniform(0.1, 1.2), 2)
        active_inci = 0

    services = {}
    for name, cfg in SERVICES.items():
        if scenario and name in scenario["services"]:
            status  = "critical"
            latency = random.randint(scenario["latency_range"][0] // 2, scenario["latency_range"][1])
        elif scenario and name == "gateway":
            status  = scenario["gateway_status"]
            latency = random.randint(200, 500) if scenario["gateway_status"] == "warning" else cfg["base_latency"] + random.randint(0, 15)
        else:
            status  = "ok"
            latency = cfg["base_latency"] + random.randint(-3, 15)
        services[name] = {"status": status, "latency": latency}

    snapshot = {
        "avg_latency":      avg_latency,
        "error_rate":       error_rate,
        "uptime":           "98.12" if incident_active else "99.97",
        "requests_per_min": random.randint(800, 1800),
        "active_incidents": active_inci,
        "services":         services,
        "timestamp":        time.time(),
        "incident_type":    incident_type,
    }

    metrics_history.append({
        "ts":         snapshot["timestamp"],
        "latency":    avg_latency,
        "error_rate": error_rate,
        "rpm":        snapshot["requests_per_min"],
    })
    if len(metrics_history) > MAX_HISTORY_POINTS:
        metrics_history.pop(0)

    if error_rate > ERROR_RATE_THRESHOLD:
        alert_log.append({"id": str(uuid.uuid4())[:8], "type": "error_rate",
                          "value": error_rate, "threshold": ERROR_RATE_THRESHOLD, "ts": snapshot["timestamp"]})
    if avg_latency > LATENCY_THRESHOLD_MS:
        alert_log.append({"id": str(uuid.uuid4())[:8], "type": "latency",
                          "value": avg_latency, "threshold": LATENCY_THRESHOLD_MS, "ts": snapshot["timestamp"]})
    return snapshot


def get_deployments():
    return DEPLOYMENTS


def get_history():
    return metrics_history[-MAX_HISTORY_POINTS:]


def detect_anomaly(metrics, logs):
    if metrics["error_rate"] > ERROR_RATE_THRESHOLD or metrics["avg_latency"] > LATENCY_THRESHOLD_MS:
        critical_logs = [l for l in logs if l["level"] in ("ERROR", "CRITICAL")]
        return {
            "anomaly_detected": True,
            "signals": [
                f"Error rate {metrics['error_rate']}% exceeds {ERROR_RATE_THRESHOLD}% threshold",
                f"Avg latency {metrics['avg_latency']}ms exceeds {LATENCY_THRESHOLD_MS}ms SLA",
                f"{len(critical_logs)} critical/error entries in sample window",
                f"Incident type fingerprint: {metrics.get('incident_type','unknown')}",
            ],
            "pattern": metrics.get("incident_type", "unknown-anomaly"),
        }
    return {"anomaly_detected": False, "signals": [], "pattern": None}


def analyze_incident(metrics, logs, deployments, anomaly):
    if not anomaly["anomaly_detected"]:
        return {
            "root_cause":       "No anomaly detected — system operating normally",
            "affected_service": "None",
            "severity":         "OK",
            "explanation":      (
                f"All services within normal parameters. Error rate is below {ERROR_RATE_THRESHOLD}% "
                f"threshold and latency is within {LATENCY_THRESHOLD_MS}ms SLA."
            ),
            "suggested_fix":    "No action required. Continue passive monitoring.",
            "tools_used":       ["get_logs()", "get_metrics()", "get_deployments()", "detect_anomaly()"],
            "confidence":       "99%",
            "scenario":         "healthy",
        }

    pattern  = anomaly["pattern"]

    if pattern == "deployment-regression":
        deploy = next(
            (d for d in deployments if d["status"] in ("fail", "success") and "payments" in d["service"]), None
        )
        return {
            "root_cause": (
                f"Faulty DB connection pool in {deploy['service']} {deploy['version']} "
                f"deployed {deploy['time']} by {deploy['author']}."
                if deploy else "Deployment regression detected — no correlated deployment found."
            ),
            "affected_service": "payments-api, db-primary",
            "severity":   "CRITICAL" if metrics["error_rate"] > 10 else "HIGH",
            "explanation": (
                f"payments-api {deploy['version'] if deploy else 'unknown'} introduced a misconfigured "
                f"HikariCP connection pool (maxPoolSize: 2 instead of 20). Under {metrics['requests_per_min']:,} "
                f"req/min, connections exhausted in 4 min. DB replica lag reached 8.4s, triggering circuit "
                f"breaker. Result: {metrics['error_rate']}% error rate, {metrics['avg_latency']}ms avg latency."
            ),
            "suggested_fix": (
                f"1. IMMEDIATE: kubectl rollout undo deploy/payments-api\n"
                f"2. Patch HikariCP: maxPoolSize=20, connectionTimeout=30000\n"
                f"3. Monitor DB replica lag — normalises ~2-3 min post-rollback\n"
                f"4. Reset circuit breaker after stability confirmed\n"
                f"5. Load test in staging before re-deploying hotfix"
            ),
            "tools_used": ["get_logs()", "get_metrics()", "get_deployments()", "detect_anomaly()", "analyze_incident()"],
            "confidence": "94%" if deploy else "71%",
            "scenario":   pattern,
        }

    if pattern == "db-overload":
        return {
            "root_cause":       "Missing index on transactions.user_id causing full-table scans under load.",
            "affected_service": "db-primary, auth-service, payments-api",
            "severity":         "HIGH",
            "explanation": (
                f"A missing composite index on transactions(user_id, created_at) is forcing full sequential "
                f"scans on every lookup. At {metrics['requests_per_min']:,} req/min, db-primary CPU hit 98% "
                f"with 2,847 queries queued. Cascade failures propagating to auth and payments. "
                f"Avg latency: {metrics['avg_latency']}ms. Error rate: {metrics['error_rate']}%."
            ),
            "suggested_fix": (
                "1. IMMEDIATE: Promote db-replica-01 to reduce read pressure\n"
                "2. CREATE INDEX CONCURRENTLY idx_tx_user ON transactions(user_id, created_at);\n"
                "3. Kill long queries: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE duration > interval '30s';\n"
                "4. After index: CPU should drop to <30% within 5 min\n"
                "5. Add: log_min_duration_statement = 1000"
            ),
            "tools_used": ["get_logs()", "get_metrics()", "get_deployments()", "detect_anomaly()", "analyze_incident()"],
            "confidence": "91%",
            "scenario":   pattern,
        }

    if pattern == "memory-leak":
        return {
            "root_cause":       "Unbounded JWT session cache in auth-service v4.3.0 — no TTL eviction.",
            "affected_service": "auth-service",
            "severity":         "HIGH",
            "explanation": (
                f"auth-service v4.3.0 introduced an in-memory session cache that never evicts expired entries. "
                f"Heap grows ~200MB/hr. After ~4h GC pauses exceed 1s causing auth latency spikes. "
                f"Currently 2/4 pods in CrashLoopBackOff. Avg latency: {metrics['avg_latency']}ms."
            ),
            "suggested_fix": (
                "1. IMMEDIATE: kubectl rollout restart deploy/auth-service\n"
                "2. Rollback: kubectl set image deploy/auth-service auth=auth-service:v4.2.9\n"
                "3. Hotfix: cache.setExpireAfterWrite(30, TimeUnit.MINUTES)\n"
                "4. JVM flags: -XX:+UseG1GC -Xmx512m -XX:+HeapDumpOnOutOfMemoryError\n"
                "5. Alert on heap >70%"
            ),
            "tools_used": ["get_logs()", "get_metrics()", "get_deployments()", "detect_anomaly()", "analyze_incident()"],
            "confidence": "88%",
            "scenario":   pattern,
        }

    return {
        "root_cause":       f"Unknown anomaly pattern: {pattern}",
        "affected_service": "Unknown",
        "severity":         "UNKNOWN",
        "explanation":      "Anomaly detected but pattern could not be correlated to a known failure mode.",
        "suggested_fix":    "Manual investigation required. Check infrastructure dashboards.",
        "tools_used":       ["get_logs()", "get_metrics()", "detect_anomaly()"],
        "confidence":       "40%",
        "scenario":         pattern,
    }


# ─── API Routes ─────────────────────────────────────────────────────

@app.route("/logs", methods=["GET"])
def logs_endpoint():
    count = int(request.args.get("count", 30))
    level = request.args.get("level", None)
    logs  = get_logs(count)
    if level and level != "ALL":
        logs = [l for l in logs if l["level"].upper().startswith(level.upper())]
    return jsonify({"logs": logs, "total": len(logs)})


@app.route("/metrics", methods=["GET"])
def metrics_endpoint():
    return jsonify(get_metrics())


@app.route("/metrics/history", methods=["GET"])
def history_endpoint():
    return jsonify({"history": get_history(), "points": len(metrics_history)})


@app.route("/deployments", methods=["GET"])
def deployments_endpoint():
    return jsonify({"deployments": get_deployments()})


@app.route("/alerts", methods=["GET"])
def alerts_endpoint():
    limit = int(request.args.get("limit", 20))
    return jsonify({"alerts": alert_log[-limit:], "total": len(alert_log)})


@app.route("/simulate-failure", methods=["POST"])
def simulate_failure():
    global incident_active, incident_type, incident_id
    body         = request.get_json(silent=True) or {}
    scenario_key = body.get("scenario", "deployment-regression")
    if scenario_key not in FAILURE_SCENARIOS:
        return jsonify({"error": f"Unknown scenario: {scenario_key}"}), 400
    incident_active = True
    incident_type   = scenario_key
    incident_id     = str(uuid.uuid4())[:8].upper()
    scenario        = FAILURE_SCENARIOS[scenario_key]
    return jsonify({
        "status":      "failure_injected",
        "incident_id": incident_id,
        "scenario":    scenario_key,
        "label":       scenario["label"],
        "description": scenario["description"],
        "services":    scenario["services"],
        "timestamp":   datetime.datetime.now().isoformat(),
    })


@app.route("/resolve", methods=["POST"])
def resolve_incident():
    global incident_active, incident_type, incident_id
    prev_id         = incident_id
    incident_active = False
    incident_type   = None
    incident_id     = None
    return jsonify({"status": "resolved", "incident_id": prev_id,
                    "timestamp": datetime.datetime.now().isoformat()})


@app.route("/analyze", methods=["POST"])
def analyze_endpoint():
    logs        = get_logs(30)
    metrics     = get_metrics()
    deployments = get_deployments()
    anomaly     = detect_anomaly(metrics, logs)
    analysis    = analyze_incident(metrics, logs, deployments, anomaly)
    return jsonify(analysis)


@app.route("/scenarios", methods=["GET"])
def scenarios_endpoint():
    return jsonify({
        "scenarios": [
            {"key": k, "label": v["label"], "description": v["description"]}
            for k, v in FAILURE_SCENARIOS.items()
        ]
    })


@app.route("/status", methods=["GET"])
def status_endpoint():
    return jsonify({
        "service":         "NeuralOps API Failure Detection Agent",
        "version":         "2.0.0",
        "status":          "running",
        "incident_active": incident_active,
        "incident_type":   incident_type,
        "incident_id":     incident_id,
        "thresholds": {
            "error_rate_pct": ERROR_RATE_THRESHOLD,
            "latency_ms":     LATENCY_THRESHOLD_MS,
        },
    })


@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "NeuralOps v2.0",
        "endpoints": ["/status", "/logs", "/metrics", "/metrics/history",
                      "/deployments", "/alerts", "/scenarios",
                      "/simulate-failure (POST)", "/resolve (POST)",
                      "/analyze (POST)", "/chat (POST)"],
    })


@app.route("/chat", methods=["POST"])
def chat_endpoint():
    """
    Chat endpoint — proxies to Groq API (free, avoids browser CORS).
    Get a FREE key at https://console.groq.com → API Keys → Create Key
    Paste it into GROQ_API_KEY at the top of this file.
    """
    body    = request.get_json(silent=True) or {}
    message = body.get("message", "").strip()
    history = body.get("history", [])
    system  = body.get("system", "You are an expert SRE/DevOps AI assistant for NeuralOps.")

    if not message:
        return jsonify({"error": "message is required"}), 400

    if not GROQ_API_KEY or GROQ_API_KEY == "PASTE_YOUR_GROQ_KEY_HERE":
        return jsonify({
            "error": "GROQ_API_KEY not set",
            "reply": (
                "**Setup required:** Open app.py and paste your Groq key on line 18.\n\n"
                "Get a FREE key at https://console.groq.com → API Keys → Create Key\n\n"
                "It looks like this: `gsk_...`"
            )
        }), 503

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)
        msgs   = [m for m in history[-9:] if m.get("role") in ("user", "assistant") and m.get("content")]
        msgs.append({"role": "user", "content": message})
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1000,
            messages=[{"role": "system", "content": system}] + msgs,
        )
        return jsonify({"reply": resp.choices[0].message.content, "backend": True})
    except Exception as e:
        return jsonify({"error": str(e), "reply": f"**Backend error:** {e}"}), 500


if __name__ == "__main__":
    print("=" * 60)
    print("  NeuralOps v2.0 — http://127.0.0.1:5000")
    print("  pip install flask flask-cors groq")
    print("  Get FREE Groq key: https://console.groq.com")
    print("=" * 60)
    app.run(debug=True, port=5000)