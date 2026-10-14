from __future__ import annotations

import csv
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


PROJECT = Path(__file__).resolve().parent.parent
DATA = PROJECT / "data"
MASTER_FILE = DATA / "customer_master_audit_2026-09-21.tsv"
SNAPSHOT_FILE = DATA / "backend_usage_snapshot_2026-09-21.tsv"
DAILY_FILE = DATA / "backend_daily_metrics_2026-09-21.tsv"
CLAIM_FILE = DATA / "claim_usage_alignment_2026-09-21.tsv"
PAID_FILE = DATA / "paid_uid_mapping_review_2026-09-21.tsv"


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def write_tsv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    master = read_tsv(MASTER_FILE)
    snapshot = {row["uid"]: row for row in read_tsv(SNAPSHOT_FILE)}
    daily: dict[str, list[tuple[date, int]]] = defaultdict(list)
    for row in read_tsv(DAILY_FILE):
        count = int(row["analyzedLessons"])
        if count:
            daily[row["uid"]].append((date.fromisoformat(row["date"]), count))

    claim_rows: list[dict[str, object]] = []
    for customer in master:
        if customer["claim"] != "True":
            continue
        uid = customer["uid"]
        record_date = date.fromisoformat(customer["claimDate"])
        events = daily.get(uid, [])
        before = sum(count for event_date, count in events if event_date < record_date)
        on_or_after = sum(count for event_date, count in events if event_date >= record_date)
        within_7 = sum(
            count
            for event_date, count in events
            if record_date <= event_date <= record_date + timedelta(days=6)
        )
        after_dates = [event_date for event_date, count in events if event_date >= record_date and count]
        claim_rows.append(
            {
                "uid": uid,
                "backendName": snapshot.get(uid, {}).get("backendName", ""),
                "recordDate": record_date.isoformat(),
                "lessonsBeforeRecord": before,
                "lessonsOnOrAfterRecord": on_or_after,
                "lessonsWithin7Days": within_7,
                "firstUsageOnOrAfter": min(after_dates).isoformat() if after_dates else "",
                "lastUsageOnOrAfter": max(after_dates).isoformat() if after_dates else "",
            }
        )
    write_tsv(
        CLAIM_FILE,
        claim_rows,
        [
            "uid",
            "backendName",
            "recordDate",
            "lessonsBeforeRecord",
            "lessonsOnOrAfterRecord",
            "lessonsWithin7Days",
            "firstUsageOnOrAfter",
            "lastUsageOnOrAfter",
        ],
    )

    paid_rows = read_tsv(PAID_FILE)
    paid_fields = list(paid_rows[0])
    if "paymentStatus" not in paid_fields:
        paid_fields.append("paymentStatus")
    for row in paid_rows:
        uid = row["proposedUid"]
        paid_date = date.fromisoformat(row["paidDate"])
        events = daily.get(uid, [])
        row["lessonsBeforePayment"] = str(
            sum(count for event_date, count in events if event_date < paid_date)
        )
        row["lessonsOnOrAfterPayment"] = str(
            sum(count for event_date, count in events if event_date >= paid_date)
        )
        row["paymentStatus"] = "确认到账"
    write_tsv(PAID_FILE, paid_rows, paid_fields)

    print(
        {
            "claim_rows": len(claim_rows),
            "paid_rows": len(paid_rows),
            "claim_total_on_or_after": sum(int(row["lessonsOnOrAfterRecord"]) for row in claim_rows),
            "claim_total_within_7_days": sum(int(row["lessonsWithin7Days"]) for row in claim_rows),
            "paid_total_on_or_after": sum(int(row["lessonsOnOrAfterPayment"]) for row in paid_rows),
        }
    )


if __name__ == "__main__":
    main()
