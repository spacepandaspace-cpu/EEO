from __future__ import annotations

import csv
import json
from pathlib import Path


PROJECT = Path(__file__).resolve().parent.parent
MASTER_FILE = PROJECT / "data" / "customer_master_audit_2026-09-21.tsv"
USAGE_FILE = PROJECT / "data" / "backend_usage_snapshot_2026-09-21.tsv"
OUTPUT_FILE = PROJECT / "data" / "customer_credit_estimate_2026-09-21.tsv"

FREE_CLAIM_CREDITS = 2_000
CREDITS_PER_YUAN = 100
CREDITS_PER_LESSON = 50


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def payment_bonus(amount_yuan: int) -> int:
    purchased = amount_yuan * CREDITS_PER_YUAN
    return purchased if amount_yuan >= 10_000 else purchased // 2


def main() -> None:
    master = read_tsv(MASTER_FILE)
    usage = {row["uid"]: row for row in read_tsv(USAGE_FILE)}
    output_rows: list[dict[str, object]] = []

    for customer in master:
        uid = customer["uid"]
        usage_row = usage.get(uid, {})
        campaign_lessons = int(usage_row.get("campaignLessons") or 0)
        post_campaign_lessons = int(usage_row.get("postCampaignLessons") or 0)
        post_launch_lessons = campaign_lessons + post_campaign_lessons
        theoretical_consumed = post_launch_lessons * CREDITS_PER_LESSON

        claimed = customer["claim"].lower() == "true"
        free_credits = FREE_CLAIM_CREDITS if claimed else 0
        payment_details = json.loads(customer["paymentDetails"] or "[]")
        payment_amount = sum(int(item["amount"]) for item in payment_details)
        purchased_credits = payment_amount * CREDITS_PER_YUAN
        bonus_credits = sum(payment_bonus(int(item["amount"])) for item in payment_details)
        known_inflow = free_credits + purchased_credits + bonus_credits
        theoretical_net = known_inflow - theoretical_consumed

        if theoretical_net < 0:
            estimate_status = "已知入账不足以覆盖正式期推算消耗"
        elif known_inflow == 0 and theoretical_consumed == 0:
            estimate_status = "无已知正式期额度事件或消耗"
        elif known_inflow > 0 and theoretical_consumed == 0:
            estimate_status = "有已知入账、暂无正式期推算消耗"
        else:
            estimate_status = "可形成非负理论已知余额"

        output_rows.append(
            {
                "uid": uid,
                "customerName": customer["customerName"],
                "consultant": customer["consultant"],
                "claim": claimed,
                "claimDate": customer["claimDate"],
                "freeCredits": free_credits,
                "paymentCount": len(payment_details),
                "paymentAmountYuan": payment_amount,
                "purchasedCredits": purchased_credits,
                "bonusCredits": bonus_credits,
                "knownCreditsIn": known_inflow,
                "campaignLessons": campaign_lessons,
                "postCampaignLessons": post_campaign_lessons,
                "postLaunchLessons": post_launch_lessons,
                "theoreticalConsumedCredits": theoretical_consumed,
                "theoreticalKnownNet": theoretical_net,
                "estimateStatus": estimate_status,
                "estimateNote": "非平台实际余额；未计期初余额、其他活动/人工调整、过期和额度扣减顺序",
            }
        )

    fields = list(output_rows[0])
    with OUTPUT_FILE.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(output_rows)

    negative_rows = [row for row in output_rows if int(row["theoreticalKnownNet"]) < 0]
    summary = {
        "customers": len(output_rows),
        "claim_customers": sum(bool(row["claim"]) for row in output_rows),
        "paid_customers": sum(int(row["paymentCount"]) > 0 for row in output_rows),
        "free_credits": sum(int(row["freeCredits"]) for row in output_rows),
        "payment_amount_yuan": sum(int(row["paymentAmountYuan"]) for row in output_rows),
        "purchased_credits": sum(int(row["purchasedCredits"]) for row in output_rows),
        "bonus_credits": sum(int(row["bonusCredits"]) for row in output_rows),
        "known_credits_in": sum(int(row["knownCreditsIn"]) for row in output_rows),
        "post_launch_lessons": sum(int(row["postLaunchLessons"]) for row in output_rows),
        "theoretical_consumed_credits": sum(
            int(row["theoreticalConsumedCredits"]) for row in output_rows
        ),
        "aggregate_theoretical_known_net": sum(
            int(row["theoreticalKnownNet"]) for row in output_rows
        ),
        "negative_customer_count": len(negative_rows),
        "negative_customer_uids": [row["uid"] for row in negative_rows],
        "written": str(OUTPUT_FILE),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
