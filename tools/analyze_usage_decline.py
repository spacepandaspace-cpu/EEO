from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


PROJECT = Path(__file__).resolve().parent.parent
DATA = PROJECT / "data"
DAILY_FILE = DATA / "backend_daily_metrics_2026-09-21.tsv"
MASTER_FILE = DATA / "customer_master_audit_2026-09-21.tsv"
OUTPUT_FILE = DATA / "usage_decline_diagnostic_2026-09-21.tsv"
AS_OF = date(2026, 9, 21)


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def main() -> None:
    master = {row["uid"]: row for row in read_tsv(MASTER_FILE)}
    by_uid: dict[str, dict[date, int]] = defaultdict(dict)
    for row in read_tsv(DAILY_FILE):
        by_uid[row["uid"]][date.fromisoformat(row["date"])] = int(row["analyzedLessons"])

    rows: list[dict[str, object]] = []
    for uid, values in by_uid.items():
        ordered_dates = sorted(values)
        rolling: list[tuple[date, int]] = []
        for end_date in ordered_dates:
            start_date = end_date - timedelta(days=6)
            rolling.append(
                (
                    end_date,
                    sum(count for day, count in values.items() if start_date <= day <= end_date),
                )
            )
        max_end, max_rolling_7 = max(rolling, key=lambda item: item[1])
        last_7_start = AS_OF - timedelta(days=6)
        last_14_start = AS_OF - timedelta(days=13)
        previous_28_start = AS_OF - timedelta(days=34)
        previous_28_end = AS_OF - timedelta(days=7)
        last_7 = sum(count for day, count in values.items() if last_7_start <= day <= AS_OF)
        last_14 = sum(count for day, count in values.items() if last_14_start <= day <= AS_OF)
        previous_28 = sum(
            count for day, count in values.items() if previous_28_start <= day <= previous_28_end
        )
        previous_28_weekly_avg = previous_28 / 4
        drop_from_baseline = previous_28_weekly_avg - last_7
        decline_from_baseline = (
            1 - last_7 / previous_28_weekly_avg if previous_28_weekly_avg else None
        )
        decline_from_peak = 1 - last_7 / max_rolling_7 if max_rolling_7 else None
        heavy_ever = max_rolling_7 >= 40
        stopped_14 = heavy_ever and last_14 == 0
        sudden_drop = (
            previous_28_weekly_avg >= 40
            and last_7 <= previous_28_weekly_avg * 0.5
            and drop_from_baseline >= 20
        )
        rows.append(
            {
                "uid": uid,
                "customerName": master[uid]["customerName"],
                "consultant": master[uid]["consultant"],
                "paid": master[uid]["paid"],
                "claim": master[uid]["claim"],
                "maxRolling7Lessons": max_rolling_7,
                "maxRolling7End": max_end.isoformat(),
                "previous28Lessons": previous_28,
                "previous28WeeklyAvg": round(previous_28_weekly_avg, 2),
                "last14Lessons": last_14,
                "last7Lessons": last_7,
                "dropFromPrevious28WeeklyAvg": round(drop_from_baseline, 2),
                "declineFromPrevious28Pct": ""
                if decline_from_baseline is None
                else round(decline_from_baseline * 100, 1),
                "declineFromPeakPct": ""
                if decline_from_peak is None
                else round(decline_from_peak * 100, 1),
                "heavyEverCandidate": heavy_ever,
                "stopped14Candidate": stopped_14,
                "suddenDropCandidate": sudden_drop,
            }
        )

    rows.sort(
        key=lambda row: (
            not bool(row["stopped14Candidate"]),
            not bool(row["suddenDropCandidate"]),
            -float(row["dropFromPrevious28WeeklyAvg"]),
            -int(row["maxRolling7Lessons"]),
        )
    )
    fields = list(rows[0])
    with OUTPUT_FILE.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)

    print(
        json.dumps(
            {
                "customers_with_usage": len(rows),
                "heavy_ever_candidate": sum(bool(row["heavyEverCandidate"]) for row in rows),
                "stopped_14_candidate": sum(bool(row["stopped14Candidate"]) for row in rows),
                "sudden_drop_candidate": sum(bool(row["suddenDropCandidate"]) for row in rows),
                "top_candidates": [
                    {
                        key: row[key]
                        for key in [
                            "uid",
                            "customerName",
                            "paid",
                            "maxRolling7Lessons",
                            "previous28WeeklyAvg",
                            "last14Lessons",
                            "last7Lessons",
                            "declineFromPrevious28Pct",
                            "stopped14Candidate",
                            "suddenDropCandidate",
                        ]
                    }
                    for row in rows[:15]
                ],
                "written": str(OUTPUT_FILE),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
