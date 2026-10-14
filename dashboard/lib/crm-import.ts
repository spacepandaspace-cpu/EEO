import * as XLSX from "xlsx";

import type { DashboardSnapshot } from "@/app/dashboard-types";

export type CrmPaymentImportRow = {
  sourceRecordKey: string;
  uid: string | null;
  customerName: string;
  consultantName: string;
  orderNo: string;
  paidDate: string;
  amountCents: number;
  mappingStatus: "matched" | "unmapped";
  sourceRow: number;
  rawJson: string;
};

export type CrmWorkbookResult = {
  sheetName: string;
  rows: CrmPaymentImportRow[];
  dataAsOf: string;
  amountCents: number;
  matchedCount: number;
  unmappedCount: number;
  warnings: string[];
  corrections: string[];
};

const HEADER_ALIASES = {
  uid: ["uid", "sid", "uid（sid）", "客户uid"],
  customer: ["客户", "客户名称", "客户名", "机构", "机构名称"],
  consultant: ["所有人", "当前顾问", "顾问", "销售", "负责人"],
  order: ["订单", "订单号", "订单编号"],
  paidDate: ["到款日期", "付款日期", "付款时间", "支付时间", "到账日期"],
  amount: ["金额", "金额（元）", "金额(元)", "到款金额", "到款金额（元）", "实收金额", "实收金额（元）", "付款金额"],
} as const;

const CONFIRMED_AMOUNT_CORRECTIONS = new Map([
  ["济南新希望教育科技发展有限公司|2026-09-04", 2_000_000],
]);

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function normalized(value: unknown) {
  return cleanText(value).replace(/[\s　]+/g, "").replace(/[（）]/g, (character) => character === "（" ? "(" : ")").toLocaleLowerCase("zh-CN");
}

function headerIndex(headers: unknown[], aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map(normalized));
  return headers.findIndex((value) => normalizedAliases.has(normalized(value)));
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const decoded = XLSX.SSF.parse_date_code(value);
    if (decoded?.y && decoded?.m && decoded?.d) return `${decoded.y}-${String(decoded.m).padStart(2, "0")}-${String(decoded.d).padStart(2, "0")}`;
  }
  const text = cleanText(value);
  const match = text.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function parseAmountCents(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(cleanText(value).replace(/[￥¥,，\s]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : Number.NaN;
}

function buildAliasMap(snapshot: DashboardSnapshot) {
  const aliases = new Map<string, Set<string>>();
  for (const row of snapshot.customerAliases) {
    const key = normalized(row.alias);
    if (!key) continue;
    const current = aliases.get(key) ?? new Set<string>();
    current.add(row.uid);
    aliases.set(key, current);
  }
  for (const row of snapshot.customers) {
    for (const label of [row.customerName, row.eeoAccountName]) {
      const key = normalized(label);
      const current = aliases.get(key) ?? new Set<string>();
      current.add(row.uid); aliases.set(key, current);
    }
  }
  return aliases;
}

function matchUid(explicitUid: string, customerName: string, aliases: Map<string, Set<string>>, snapshot: DashboardSnapshot) {
  if (explicitUid && snapshot.customers.some((customer) => customer.uid === explicitUid)) return explicitUid;
  const candidates = aliases.get(normalized(customerName));
  return candidates?.size === 1 ? [...candidates][0] : null;
}

export function parseCrmWorkbook(bytes: ArrayBuffer, snapshot: DashboardSnapshot): CrmWorkbookResult {
  const workbook = XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true, sheets: 0, sheetRows: 5002 });
  if (!workbook.SheetNames.length) throw new Error("CRM文件中没有可读取的工作表");
  const sheetName = workbook.SheetNames.find((name) => name.includes("售卖") || name.includes("付费")) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const dimensions = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (dimensions.e.r > 5000 || dimensions.e.c > 63) throw new Error("CRM表超过5000行或64列，请拆分后导入。");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  const headerRowIndex = matrix.findIndex((row) => {
    if (!Array.isArray(row)) return false;
    return headerIndex(row, HEADER_ALIASES.customer) >= 0 && headerIndex(row, HEADER_ALIASES.paidDate) >= 0 && headerIndex(row, HEADER_ALIASES.amount) >= 0;
  });
  if (headerRowIndex < 0) throw new Error("未找到CRM表头，需要包含客户、到款日期和金额列");

  const headers = matrix[headerRowIndex];
  const indexes = {
    uid: headerIndex(headers, HEADER_ALIASES.uid),
    customer: headerIndex(headers, HEADER_ALIASES.customer),
    consultant: headerIndex(headers, HEADER_ALIASES.consultant),
    order: headerIndex(headers, HEADER_ALIASES.order),
    paidDate: headerIndex(headers, HEADER_ALIASES.paidDate),
    amount: headerIndex(headers, HEADER_ALIASES.amount),
  };
  const aliases = buildAliasMap(snapshot);
  const duplicateOccurrences = new Map<string, number>();
  const warnings: string[] = [];
  const corrections: string[] = [];
  const rows: CrmPaymentImportRow[] = [];
  const asiRows = matrix.slice(headerRowIndex + 1).filter(row => cleanText(row[indexes.customer]) === "ASI_" && ["2026-09-01", "2026-09-02"].includes(parseDate(row[indexes.paidDate])));
  const asiNet = asiRows.reduce((sum, row) => sum + parseAmountCents(row[indexes.amount]), 0);
  const asiHasRefund = asiRows.some(row => parseAmountCents(row[indexes.amount]) < 0);
  if (asiHasRefund && (asiRows.length !== 2 || asiNet !== 500_000)) throw new Error("ASI_冲抵组合与已确认的50000−45000=5000元不一致，请核对后导入");
  let asiImported = false;

  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const source = matrix[index] ?? [];
    const customerName = cleanText(source[indexes.customer]);
    if (!customerName || /^(合计|总计|小计)$/i.test(customerName)) continue;
    let paidDate = parseDate(source[indexes.paidDate]);
    const sourceAmountCents = parseAmountCents(source[indexes.amount]);
    if (customerName === "济南新希望教育科技发展有限公司" && sourceAmountCents === 100) {
      corrections.push(`第${index + 1}行：济南新希望1元无效订单排除`); continue;
    }
    if (customerName === "文星教育" && (!Number.isFinite(sourceAmountCents) || sourceAmountCents === 0)) {
      corrections.push(`第${index + 1}行：文星教育0元无效订单排除`); continue;
    }
    const mergedAsi = asiRows.includes(source) && asiHasRefund;
    if (mergedAsi && asiImported) continue;
    if (mergedAsi) { asiImported = true; corrections.push("ASI_两笔冲抵订单合并为1笔，实际到款5000元"); }
    if (mergedAsi) paidDate = parseDate(asiRows.find(row => parseAmountCents(row[indexes.amount]) > 0)?.[indexes.paidDate]);
    if (!paidDate || !Number.isInteger(sourceAmountCents) || (!mergedAsi && sourceAmountCents <= 0)) {
      warnings.push(`第${index + 1}行未导入：到款日期或金额无效`);
      continue;
    }
    const correctionKey = `${customerName}|${paidDate}`;
    const amountCents = mergedAsi ? asiNet : CONFIRMED_AMOUNT_CORRECTIONS.get(correctionKey) ?? sourceAmountCents;
    if (!mergedAsi && amountCents !== sourceAmountCents) corrections.push(`第${index + 1}行${customerName}：${sourceAmountCents / 100}元按已确认口径修正为${amountCents / 100}元`);
    const explicitUid = indexes.uid >= 0 ? cleanText(source[indexes.uid]) : "";
    const consultantName = indexes.consultant >= 0 ? cleanText(source[indexes.consultant]) : "";
    const orderNo = indexes.order >= 0 ? cleanText(source[indexes.order]) : "";
    const uid = matchUid(explicitUid, customerName, aliases, snapshot);
    const baseKey = mergedAsi ? "adjustment:asi:2026-09-net" : orderNo && orderNo !== "--"
      ? `order:${normalized(orderNo)}`
      : `row:${normalized(customerName)}:${paidDate}:${normalized(consultantName)}`;
    const occurrence = (duplicateOccurrences.get(baseKey) ?? 0) + 1;
    duplicateOccurrences.set(baseKey, occurrence);
    const sourceRecordKey = occurrence === 1 ? baseKey : `${baseKey}:${occurrence}`;
    rows.push({
      sourceRecordKey,
      uid,
      customerName,
      consultantName,
      orderNo,
      paidDate,
      amountCents,
      mappingStatus: uid ? "matched" : "unmapped",
      sourceRow: index + 1,
      rawJson: JSON.stringify({ explicitUid, customerName, consultantName, orderNo, paidDate, sourceAmount: sourceAmountCents / 100, appliedAmount: amountCents / 100 }),
    });
  }
  if (!rows.length) throw new Error("CRM文件中没有可导入的有效付费明细");
  return {
    sheetName,
    rows,
    dataAsOf: rows.reduce((latest, row) => row.paidDate > latest ? row.paidDate : latest, ""),
    amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    matchedCount: rows.filter((row) => row.mappingStatus === "matched").length,
    unmappedCount: rows.filter((row) => row.mappingStatus === "unmapped").length,
    warnings,
    corrections,
  };
}
