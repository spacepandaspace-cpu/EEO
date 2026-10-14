from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


PROJECT = Path(__file__).resolve().parent.parent
DATA = PROJECT / "data"
CAPTURE_DIR = DATA / "risk_api_captures_2026-09-21"
FALSE_POSITIVE_CAPTURE_DIR = DATA / "false_positive_api_captures_2026-09-21"
DAILY_DIR = DATA / "school_detail_daily_2026-09-21"
MASTER_FILE = DATA / "customer_master_audit_2026-09-21.tsv"
SNAPSHOT_FILE = DATA / "backend_usage_snapshot_2026-09-21.tsv"
RISK_LESSON_FILE = DATA / "risk_lesson_minimal_2026-09-21.tsv"
FALSE_POSITIVE_LESSON_FILE = DATA / "false_positive_lesson_minimal_2026-09-21.tsv"
DAILY_METRIC_FILE = DATA / "backend_daily_metrics_2026-09-21.tsv"

TZ = ZoneInfo("Asia/Shanghai")
SNAPSHOT_DATE = "2026-09-21"
PRELAUNCH_END = "2026-08-17"
CAMPAIGN_END = "2026-09-17"


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def write_tsv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def date_from_epoch(value: str) -> str:
    if not value:
        return ""
    return datetime.fromtimestamp(int(value), tz=TZ).date().isoformat()


def risk_level(score: int) -> str:
    if score >= 8:
        return "high"
    if score >= 4:
        return "medium"
    if score >= 1:
        return "low"
    return "none"


def main() -> None:
    master = {row["uid"]: row for row in read_tsv(MASTER_FILE)}
    old_snapshot_rows = read_tsv(SNAPSHOT_FILE)
    old_snapshot = {row["uid"]: row for row in old_snapshot_rows}

    daily_captures: dict[str, dict[str, object]] = {}
    for path in sorted(DAILY_DIR.glob("*.json")):
        item = json.loads(path.read_text(encoding="utf-8"))
        daily_captures[str(item["uid"])] = item

    used_master_uids = {uid for uid, row in master.items() if row["used"] == "True"}
    missing_daily = sorted(used_master_uids - set(daily_captures), key=int)
    unexpected_daily = sorted(set(daily_captures) - used_master_uids, key=int)

    risk_pages: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for path in sorted(CAPTURE_DIR.glob("*_p*.json")):
        item = json.loads(path.read_text(encoding="utf-8"))
        risk_pages[(str(item["uid"]), str(item["level"]))].append(item)

    false_positive_pages: dict[str, list[dict[str, object]]] = defaultdict(list)
    for path in sorted(FALSE_POSITIVE_CAPTURE_DIR.glob("*_p*.json")):
        item = json.loads(path.read_text(encoding="utf-8"))
        false_positive_pages[str(item["uid"])].append(item)

    false_positive_capture_issues: list[str] = []
    false_positive_rows: list[dict[str, object]] = []
    false_positive_class_ids: dict[str, set[str]] = defaultdict(set)
    false_positive_by_uid_date: dict[tuple[str, str], int] = defaultdict(int)
    false_positive_total_by_uid: dict[str, int] = defaultdict(int)
    for uid, pages in sorted(false_positive_pages.items(), key=lambda item: int(item[0])):
        pages.sort(key=lambda item: int(item["page"]))
        total_values = {int(item["total"]) for item in pages}
        expected_pages = max(1, (next(iter(total_values)) + 99) // 100) if len(total_values) == 1 else 0
        actual_pages = [int(item["page"]) for item in pages]
        lessons = [lesson for page in pages for lesson in page.get("lessons", [])]
        total = next(iter(total_values)) if len(total_values) == 1 else -1
        if len(total_values) != 1:
            false_positive_capture_issues.append(
                f"{uid}: total values differ {sorted(total_values)}"
            )
        if expected_pages and actual_pages != list(range(1, expected_pages + 1)):
            false_positive_capture_issues.append(
                f"{uid}: pages {actual_pages}, expected 1..{expected_pages}"
            )
        if len(lessons) != total:
            false_positive_capture_issues.append(
                f"{uid}: captured {len(lessons)}, API total {total}"
            )
        for lesson in lessons:
            class_id = str(lesson["classId"])
            if class_id in false_positive_class_ids[uid]:
                false_positive_capture_issues.append(
                    f"{uid}: duplicate false-positive classId {class_id}"
                )
                continue
            false_positive_class_ids[uid].add(class_id)
            course_date = date_from_epoch(str(lesson.get("classBtime") or ""))
            false_positive_by_uid_date[(uid, course_date)] += 1
            false_positive_total_by_uid[uid] += 1
            score_raw = lesson.get("riskScore")
            false_positive_rows.append(
                {
                    "uid": uid,
                    "classId": class_id,
                    "courseDate": course_date,
                    "classBtime": lesson.get("classBtime", ""),
                    "teacherUid": lesson.get("teacherUid", ""),
                    "riskScore": "" if score_raw in (None, "") else int(score_raw),
                    "currentRiskLevel": "none"
                    if score_raw in (None, "", 0, "0")
                    else risk_level(int(score_raw)),
                }
            )

    risk_rows: list[dict[str, object]] = []
    risk_capture_issues: list[str] = []
    seen_class_ids: dict[str, set[str]] = defaultdict(set)
    risk_by_uid_date: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"low": 0, "medium": 0, "high": 0, "reviewed": 0, "falsePositive": 0}
    )
    risk_total_by_uid: dict[str, int] = defaultdict(int)
    reviewed_total_by_uid: dict[str, int] = defaultdict(int)

    for (uid, level), pages in sorted(risk_pages.items(), key=lambda item: (int(item[0][0]), item[0][1])):
        pages.sort(key=lambda item: int(item["page"]))
        total_values = {int(item["total"]) for item in pages}
        expected_pages = max(1, (next(iter(total_values)) + 99) // 100) if len(total_values) == 1 else 0
        actual_pages = [int(item["page"]) for item in pages]
        if len(total_values) != 1:
            risk_capture_issues.append(f"{uid}/{level}: total values differ {sorted(total_values)}")
        if expected_pages and actual_pages != list(range(1, expected_pages + 1)):
            risk_capture_issues.append(
                f"{uid}/{level}: pages {actual_pages}, expected 1..{expected_pages}"
            )
        lessons = [lesson for page in pages for lesson in page.get("lessons", [])]
        total = next(iter(total_values)) if len(total_values) == 1 else -1
        if len(lessons) != total:
            risk_capture_issues.append(
                f"{uid}/{level}: captured {len(lessons)}, API total {total}"
            )

        for lesson in lessons:
            class_id = str(lesson["classId"])
            if class_id in seen_class_ids[uid]:
                risk_capture_issues.append(f"{uid}: duplicate classId {class_id}")
                continue
            seen_class_ids[uid].add(class_id)
            score = int(lesson.get("riskScore") or 0)
            computed_level = risk_level(score)
            normalized_filter_level = "medium" if level == "middle" else level
            if computed_level != normalized_filter_level:
                risk_capture_issues.append(
                    f"{uid}/{class_id}: score {score} -> {computed_level}, endpoint {level}"
                )
            course_date = date_from_epoch(str(lesson.get("classBtime") or ""))
            is_false_positive = class_id in false_positive_class_ids[uid]
            # 后台“已查看”总数包含随后被标记为误报的课节；误报是已查看的子集。
            is_reviewed = int(lesson.get("isRead") or 0) == 1
            key = (uid, course_date)
            risk_by_uid_date[key][computed_level] += 1
            risk_by_uid_date[key]["reviewed"] += int(is_reviewed)
            risk_total_by_uid[uid] += 1
            reviewed_total_by_uid[uid] += int(is_reviewed)
            risk_rows.append(
                {
                    "uid": uid,
                    "classId": class_id,
                    "courseDate": course_date,
                    "classBtime": lesson.get("classBtime", ""),
                    "teacherUid": lesson.get("teacherUid", ""),
                    "riskScore": score,
                    "riskLevel": computed_level,
                    "isRead": int(lesson.get("isRead") or 0),
                    "optStatus": int(is_false_positive),
                    "riskLabels": json.dumps(
                        lesson.get("riskLabels") or [], ensure_ascii=False, separators=(",", ":")
                    ),
                }
            )

    expected_positive_risk_uids = {
        uid
        for uid, item in daily_captures.items()
        if int(item["overview"]["riskLessonCount"]) > 0
    }
    captured_risk_uids = {uid for uid, _ in risk_pages}
    missing_risk_uids = sorted(expected_positive_risk_uids - captured_risk_uids, key=int)
    unexpected_risk_uids = sorted(captured_risk_uids - expected_positive_risk_uids, key=int)

    reconciliation_issues: list[str] = []
    daily_rows: list[dict[str, object]] = []
    for uid in sorted(daily_captures, key=int):
        item = daily_captures[uid]
        overview = item["overview"]
        trends = item["analysisTrend"]
        analyzed_sum = sum(int(row["lessonCount"]) for row in trends)
        trend_risk_sum = sum(int(row["riskLessonCount"]) for row in trends)
        if analyzed_sum != int(overview["analyzedLessonCount"]):
            reconciliation_issues.append(
                f"{uid}: daily analyzed {analyzed_sum} != overview {overview['analyzedLessonCount']}"
            )
        if trend_risk_sum != int(overview["riskLessonCount"]):
            reconciliation_issues.append(
                f"{uid}: daily risk {trend_risk_sum} != overview {overview['riskLessonCount']}"
            )
        if risk_total_by_uid[uid] != int(overview["riskLessonCount"]):
            reconciliation_issues.append(
                f"{uid}: risk details {risk_total_by_uid[uid]} != overview {overview['riskLessonCount']}"
            )
        if reviewed_total_by_uid[uid] != int(overview["reviewedRiskLessonCount"]):
            reconciliation_issues.append(
                f"{uid}: reviewed details {reviewed_total_by_uid[uid]} != overview {overview['reviewedRiskLessonCount']}"
            )
        if false_positive_total_by_uid[uid] != int(overview["falsePositiveCount"]):
            reconciliation_issues.append(
                f"{uid}: false positive details {false_positive_total_by_uid[uid]} != overview {overview['falsePositiveCount']}"
            )

        for trend in trends:
            date = str(trend["date"])
            risk = risk_by_uid_date[(uid, date)]
            detail_risk_sum = risk["low"] + risk["medium"] + risk["high"]
            if detail_risk_sum != int(trend["riskLessonCount"]):
                reconciliation_issues.append(
                    f"{uid}/{date}: detail risk {detail_risk_sum} != trend {trend['riskLessonCount']}"
                )
            daily_rows.append(
                {
                    "uid": uid,
                    "customerName": master[uid]["customerName"],
                    "consultant": master[uid]["consultant"],
                    "date": date,
                    "analyzedLessons": int(trend["lessonCount"]),
                    "riskLessons": detail_risk_sum,
                    "lowRiskLessons": risk["low"],
                    "mediumRiskLessons": risk["medium"],
                    "highRiskLessons": risk["high"],
                    "reviewedRiskLessons": risk["reviewed"],
                    "falsePositiveLessons": false_positive_by_uid_date[(uid, date)],
                    "theoreticalConsumedCredits": int(trend["lessonCount"]) * 50,
                }
            )

    write_tsv(
        RISK_LESSON_FILE,
        sorted(risk_rows, key=lambda row: (int(row["uid"]), row["courseDate"], row["classId"])),
        [
            "uid",
            "classId",
            "courseDate",
            "classBtime",
            "teacherUid",
            "riskScore",
            "riskLevel",
            "isRead",
            "optStatus",
            "riskLabels",
        ],
    )
    write_tsv(
        FALSE_POSITIVE_LESSON_FILE,
        sorted(
            false_positive_rows,
            key=lambda row: (int(row["uid"]), row["courseDate"], row["classId"]),
        ),
        [
            "uid",
            "classId",
            "courseDate",
            "classBtime",
            "teacherUid",
            "riskScore",
            "currentRiskLevel",
        ],
    )
    write_tsv(
        DAILY_METRIC_FILE,
        daily_rows,
        [
            "uid",
            "customerName",
            "consultant",
            "date",
            "analyzedLessons",
            "riskLessons",
            "lowRiskLessons",
            "mediumRiskLessons",
            "highRiskLessons",
            "reviewedRiskLessons",
            "falsePositiveLessons",
            "theoreticalConsumedCredits",
        ],
    )

    captured_at = datetime.now(tz=TZ).isoformat(timespec="seconds")
    snapshot_fields = list(old_snapshot_rows[0])
    if "snapshotCapturedAt" not in snapshot_fields:
        snapshot_fields.append("snapshotCapturedAt")
    last30_start = (datetime.fromisoformat(SNAPSHOT_DATE).date() - timedelta(days=29)).isoformat()
    new_snapshot_rows: list[dict[str, object]] = []
    for old in old_snapshot_rows:
        uid = old["uid"]
        output: dict[str, object] = dict(old)
        output["snapshotCapturedAt"] = captured_at
        if uid in daily_captures:
            item = daily_captures[uid]
            trends = item["analysisTrend"]
            positive = [row for row in trends if int(row["lessonCount"]) > 0]
            output.update(
                {
                    "monitorEnabled": str(bool(item["monitorEnabled"])).lower(),
                    "openedAt": date_from_epoch(str(item["createdAt"])),
                    "lastActiveAt": date_from_epoch(str(item["lastActiveAt"])),
                    "total": int(item["overview"]["analyzedLessonCount"]),
                    "risk": int(item["overview"]["riskLessonCount"]),
                    "falsePositive": int(item["overview"]["falsePositiveCount"]),
                    "reviewedRisk": int(item["overview"]["reviewedRiskLessonCount"]),
                    "activeDays": len(positive),
                    "firstUsage": positive[0]["date"] if positive else "",
                    "lastUsage": positive[-1]["date"] if positive else "",
                    "preLaunchLessons": sum(
                        int(row["lessonCount"]) for row in trends if row["date"] <= PRELAUNCH_END
                    ),
                    "campaignLessons": sum(
                        int(row["lessonCount"])
                        for row in trends
                        if PRELAUNCH_END < row["date"] <= CAMPAIGN_END
                    ),
                    "postCampaignLessons": sum(
                        int(row["lessonCount"]) for row in trends if row["date"] > CAMPAIGN_END
                    ),
                    "last30Lessons": sum(
                        int(row["lessonCount"]) for row in trends if row["date"] >= last30_start
                    ),
                }
            )
        new_snapshot_rows.append(output)
    write_tsv(SNAPSHOT_FILE, new_snapshot_rows, snapshot_fields)

    print(
        json.dumps(
            {
                "daily_capture_uids": len(daily_captures),
                "missing_daily_uids": missing_daily,
                "unexpected_daily_uids": unexpected_daily,
                "risk_lesson_rows": len(risk_rows),
                "expected_positive_risk_uids": len(expected_positive_risk_uids),
                "captured_risk_uids": len(captured_risk_uids),
                "missing_risk_uids": missing_risk_uids,
                "unexpected_risk_uids": unexpected_risk_uids,
                "risk_capture_issues": risk_capture_issues,
                "false_positive_capture_issues": false_positive_capture_issues,
                "false_positive_lesson_rows": len(false_positive_rows),
                "reconciliation_issues": reconciliation_issues,
                "daily_metric_rows": len(daily_rows),
                "snapshot_total_lessons_92": sum(
                    int(row.get("total") or 0)
                    for row in new_snapshot_rows
                    if row["uid"] in master
                ),
                "snapshot_post_launch_lessons_92": sum(
                    int(row.get("campaignLessons") or 0) + int(row.get("postCampaignLessons") or 0)
                    for row in new_snapshot_rows
                    if row["uid"] in master
                ),
                "written": [
                    str(RISK_LESSON_FILE),
                    str(FALSE_POSITIVE_LESSON_FILE),
                    str(DAILY_METRIC_FILE),
                    str(SNAPSHOT_FILE),
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
