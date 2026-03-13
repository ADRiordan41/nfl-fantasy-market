import argparse
import json
import random
import statistics
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simple threaded API load test.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--token", default="")
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--duration-seconds", type=int, default=30)
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    rank = (len(values) - 1) * pct
    lower = int(rank)
    upper = min(lower + 1, len(values) - 1)
    if lower == upper:
        return values[lower]
    weight = rank - lower
    return values[lower] * (1 - weight) + values[upper] * weight


def http_get_json(base_url: str, path: str, *, token: str, timeout_seconds: float) -> tuple[int, object]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{base_url}{path}", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
        payload = resp.read().decode("utf-8")
        return resp.status, json.loads(payload)


def choose_weighted_endpoints(player_id: int, *, include_auth: bool) -> list[tuple[str, int]]:
    endpoints = [
        ("/players", 35),
        ("/market/movers", 20),
        (f"/players/{player_id}", 20),
        (f"/players/{player_id}/history?limit=200", 10),
        (f"/players/{player_id}/game-history?limit=200", 10),
    ]
    if include_auth:
        endpoints.append(("/portfolio", 5))
    return endpoints


def worker(
    *,
    base_url: str,
    token: str,
    timeout_seconds: float,
    deadline: float,
    endpoints: list[tuple[str, int]],
    stats_lock: threading.Lock,
    per_path_latencies: dict[str, list[float]],
    per_path_response_header_ms: dict[str, list[float]],
    status_counts: Counter[str],
    failures: Counter[str],
    request_counter: list[int],
) -> None:
    total_weight = sum(weight for _, weight in endpoints)
    path_choices = [path for path, _ in endpoints]
    weights = [weight / total_weight for _, weight in endpoints]

    while time.perf_counter() < deadline:
        path = random.choices(path_choices, weights=weights, k=1)[0]
        started = time.perf_counter()
        response_time_header_ms = 0.0
        status_label = "000"
        failure_label = ""
        try:
            headers = {"Accept": "application/json"}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            req = urllib.request.Request(f"{base_url}{path}", headers=headers)
            with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                resp.read()
                status_label = str(resp.status)
                response_time_header = resp.headers.get("X-Response-Time-Ms", "").strip()
                if response_time_header:
                    try:
                        response_time_header_ms = float(response_time_header)
                    except ValueError:
                        response_time_header_ms = 0.0
        except urllib.error.HTTPError as exc:
            status_label = str(exc.code)
            failure_label = f"http_{exc.code}"
        except Exception as exc:  # pragma: no cover - runtime reporting
            failure_label = type(exc).__name__

        elapsed_ms = (time.perf_counter() - started) * 1000
        with stats_lock:
            request_counter[0] += 1
            status_counts[status_label] += 1
            per_path_latencies[path].append(elapsed_ms)
            if response_time_header_ms > 0:
                per_path_response_header_ms[path].append(response_time_header_ms)
            if failure_label:
                failures[f"{path}:{failure_label}"] += 1


def summarize_latencies(values: list[float]) -> dict[str, float]:
    if not values:
        return {"count": 0, "avg_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0, "max_ms": 0.0}
    sorted_values = sorted(values)
    return {
        "count": float(len(sorted_values)),
        "avg_ms": round(statistics.fmean(sorted_values), 1),
        "p50_ms": round(percentile(sorted_values, 0.50), 1),
        "p95_ms": round(percentile(sorted_values, 0.95), 1),
        "p99_ms": round(percentile(sorted_values, 0.99), 1),
        "max_ms": round(sorted_values[-1], 1),
    }


def main() -> None:
    args = parse_args()
    random.seed(args.seed)

    _, players_payload = http_get_json(
        args.base_url,
        "/players",
        token="",
        timeout_seconds=args.timeout_seconds,
    )
    if not isinstance(players_payload, list) or not players_payload:
        raise SystemExit("No players returned from /players; cannot build load profile.")

    player_id = int(players_payload[0]["id"])
    endpoints = choose_weighted_endpoints(player_id, include_auth=bool(args.token.strip()))

    deadline = time.perf_counter() + args.duration_seconds
    stats_lock = threading.Lock()
    per_path_latencies: dict[str, list[float]] = defaultdict(list)
    per_path_response_header_ms: dict[str, list[float]] = defaultdict(list)
    status_counts: Counter[str] = Counter()
    failures: Counter[str] = Counter()
    request_counter = [0]
    threads: list[threading.Thread] = []

    started_at = time.perf_counter()
    for _ in range(args.concurrency):
        thread = threading.Thread(
            target=worker,
            kwargs={
                "base_url": args.base_url,
                "token": args.token.strip(),
                "timeout_seconds": args.timeout_seconds,
                "deadline": deadline,
                "endpoints": endpoints,
                "stats_lock": stats_lock,
                "per_path_latencies": per_path_latencies,
                "per_path_response_header_ms": per_path_response_header_ms,
                "status_counts": status_counts,
                "failures": failures,
                "request_counter": request_counter,
            },
            daemon=True,
        )
        threads.append(thread)
        thread.start()

    for thread in threads:
        thread.join()
    elapsed_seconds = max(0.001, time.perf_counter() - started_at)

    all_latencies = [value for values in per_path_latencies.values() for value in values]
    all_header_latencies = [
        value for values in per_path_response_header_ms.values() for value in values
    ]
    output = {
        "base_url": args.base_url,
        "concurrency": args.concurrency,
        "duration_seconds": args.duration_seconds,
        "requests_total": request_counter[0],
        "requests_per_second": round(request_counter[0] / elapsed_seconds, 1),
        "status_counts": dict(status_counts),
        "failures": dict(failures),
        "client_latency_ms": summarize_latencies(all_latencies),
        "server_header_latency_ms": summarize_latencies(all_header_latencies),
        "per_endpoint": {
            path: {
                "client_latency_ms": summarize_latencies(latencies),
                "server_header_latency_ms": summarize_latencies(per_path_response_header_ms.get(path, [])),
            }
            for path, latencies in sorted(per_path_latencies.items())
        },
        "sample_player_id": player_id,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
