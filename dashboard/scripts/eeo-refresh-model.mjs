import assert from 'node:assert/strict';

const count = value => Number.isSafeInteger(value) && value >= 0;
const day = (date, offset = 0) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const sum = (rows, from, to) => rows.filter(row => row.date >= from && row.date <= to).reduce((total, row) => total + row.lessons, 0);
const nullableSum = (a, b) => a === null || b === null ? null : a + b;

export function refreshUsage(snapshot, details, manifest, credits, options = {}) {
  assert.equal(manifest.failureCount, 0, '采集失败，不能发布');
  assert.equal(details.length, snapshot.customers.length, '客户覆盖不完整');
  const from = manifest.range.from, to = manifest.range.to;
  const dates = [];
  for (let date = from; date <= to; date = day(date, 1)) dates.push(date);
  assert(dates.length > 0 && dates.length <= 365, '采集区间无效或超过365天');
  const expected = new Set(snapshot.customers.map(customer => customer.uid));
  const incoming = new Map();
  const merged = new Map(snapshot.customerDaily.filter(row => row.date < from || row.date > to).map(row => [`${row.uid}|${row.date}`, row]));
  const oldDaily = new Map(snapshot.customerDaily.map(row => [`${row.uid}|${row.date}`, row]));
  for (const detail of details) {
    assert(expected.has(detail.uid) && !incoming.has(detail.uid), '未知或重复UID');
    assert(count(detail.analyzedLessonCount), '累计使用汇总无效');
    for (const key of ['riskLessonCount','reviewedRiskLessonCount','falsePositiveCount']) assert(count(detail[key]), `累计${key}无效`);
    assert.equal(detail.dailyMetrics.length, dates.length, '逐日数据不完整');
    incoming.set(detail.uid, detail);
    const seen = new Set();
    for (const row of detail.dailyMetrics) {
      assert(dates.includes(row.date) && !seen.has(row.date), '日期缺失或重复');
      seen.add(row.date);
      assert(count(row.analyzedLessonCount) && count(row.riskLessonCount)
        && (row.falsePositiveCount === null || count(row.falsePositiveCount)), '日汇总无效');
      assert(row.riskLessonCount <= row.analyzedLessonCount, '风险数超过课节数');
      const key = `${detail.uid}|${row.date}`, old = oldDaily.get(key);
      // Only the original historical export contains verified daily status fields.
      // Later captures formerly synthesized zero for absent fields; do not reuse them.
      const historicalStatus = old && row.date <= '2026-09-20';
      const keepBreakdown = historicalStatus && old.low !== null && old.medium !== null && old.high !== null
        && old.low + old.medium + old.high === row.riskLessonCount;
      merged.set(key, {
        uid:detail.uid, date:row.date, lessons:row.analyzedLessonCount, risk:row.riskLessonCount,
        low:keepBreakdown ? old.low : row.riskLessonCount === 0 ? 0 : null,
        medium:keepBreakdown ? old.medium : row.riskLessonCount === 0 ? 0 : null,
        high:keepBreakdown ? old.high : row.riskLessonCount === 0 ? 0 : null,
        reviewed:keepBreakdown ? old.reviewed : null,
        falsePositive:row.falsePositiveCount ?? (historicalStatus && keepBreakdown ? old.falsePositive : null),
      });
    }
  }
  const customerDaily = [...merged.values()].sort((a,b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
  const byUid = new Map();
  for (const row of customerDaily) {
    const rows = byUid.get(row.uid) || []; rows.push(row); byUid.set(row.uid, rows);
  }
  const completeTo = to === new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short'}).format(new Date(manifest.capturedAt)) ? day(to,-1) : to;
  const holidayTo = options.weekly ? completeTo : '2026-10-07';
  const holidayFrom = options.weekly ? day(holidayTo,-6) : '2026-10-01';
  const previousTo = day(holidayFrom,-1), previousFrom = day(holidayFrom,-7);
  const customers = snapshot.customers.map(old => {
    const detail = incoming.get(old.uid), rows = byUid.get(old.uid) || [];
    const historical = rows.reduce((total,row) => total + row.lessons, 0);
    assert.equal(historical, detail.analyzedLessonCount, `UID ${old.uid}累计与逐日数据不能对账`);
    assert(detail.analyzedLessonCount >= old.analyzedLessons, `UID ${old.uid}累计减少，需人工检查`);
    const holidayLessons = sum(rows,holidayFrom,holidayTo), previousHolidayWeekLessons = sum(rows,previousFrom,previousTo);
    const postLaunchLessons = sum(rows,'2026-08-18',to);
    const lessonsAfterPayment = old.paymentDate ? sum(rows,old.paymentDate,to) : 0;
    const last7Lessons = sum(rows,day(completeTo,-6),completeTo), last14Lessons = sum(rows,day(completeTo,-13),completeTo);
    const prior28Average = sum(rows,day(completeTo,-34),day(completeTo,-7)) / 4;
    let rolling = 0, maxRolling7Lessons = 0;
    const lessonByDate = new Map(rows.map(row => [row.date,row.lessons]));
    for (let date = rows[0]?.date || from; date <= completeTo; date = day(date,1)) {
      rolling += lessonByDate.get(date) || 0;
      rolling -= lessonByDate.get(day(date,-7)) || 0;
      maxRolling7Lessons = Math.max(maxRolling7Lessons, rolling);
    }
    const declinePct = prior28Average ? Math.max(0,Math.round((1-last7Lessons/prior28Average)*100)) : 0;
    const knownCreditsIn = credits.get(old.uid);
    assert(count(knownCreditsIn), `UID ${old.uid}已知额度入账缺失`);
    const theoreticalNet = knownCreditsIn - postLaunchLessons * 50;
    const reasons = [];
    if (holidayLessons >= 40) reasons.push(`${options.weekly?'近7天':'十一'}高消耗：跟进需求`);
    if (old.paid && holidayLessons === 0) reasons.push(`已充值：${options.weekly?'近7天':'十一'}未使用`);
    else if (old.paid && holidayLessons <= 10) reasons.push(`已充值：${options.weekly?'近7天':'十一'}低消耗`);
    if (old.paid && lessonsAfterPayment === 0) reasons.push('付费未启用');
    else if (old.paid && last14Lessons === 0) reasons.push('付费后停用');
    if (maxRolling7Lessons >= 40 && last14Lessons === 0) reasons.push('大量使用后归零');
    if (declinePct >= 50 && last7Lessons < prior28Average) reasons.push('近期使用骤降');
    if (!old.paid && postLaunchLessons >= 40) reasons.push('高使用未付费');
    if (old.claim && historical === 0) reasons.push('领额未使用');
    if (historical > 0 && last14Lessons === 0) reasons.push('14天沉默');
    if (theoreticalNet < 0) reasons.push('额度来源不完整');
    let score = old.paid ? 10 : 0;
    if (old.paymentTotal >= 10000) score += 5;
    score += maxRolling7Lessons >= 1000 ? 10 : maxRolling7Lessons >= 200 ? 7 : maxRolling7Lessons >= 40 ? 4 : historical > 0 ? 2 : 0;
    score += maxRolling7Lessons >= 40 && last14Lessons === 0 ? 35 : declinePct >= 50 ? 30 : historical > 0 && last14Lessons === 0 ? 15 : 0;
    score += !old.paid && postLaunchLessons >= 200 ? 30 : !old.paid && postLaunchLessons >= 40 ? 25 : !old.paid && postLaunchLessons > 0 ? 15 : old.claim && historical === 0 ? 10 : 0;
    const focus = holidayLessons >= 40 ? '高消耗需求跟进' : old.paid && holidayLessons <= 10 ? '充值低消耗排查' : '';
    const followupAction = focus === '高消耗需求跟进'
      ? `确认${options.weekly?'近期':'假期'}使用场景、效果与误报体验；了解后续排课、报表/工作流需求及额度补充计划。`
      : focus ? `确认是否有${options.weekly?'近期':'假期'}排课、监测开关与课程接入、管理员/教师启用情况、额度到账及首次使用障碍。` : '';
    const forced = old.paid && (lessonsAfterPayment === 0 || holidayLessons <= 10 || last14Lessons === 0);
    const payment=options.paymentCredits?.get(old.uid);
    const verifiedPayment=payment && payment.amount===old.paymentTotal && payment.count===old.paymentCount;
    return {...old, ...(payment ? {purchasedAiCredits:verifiedPayment?payment.purchased:null,bonusAiCredits:verifiedPayment?payment.bonus:null,paidAiCredits:verifiedPayment?payment.total:null} : {}), used:historical>0, analyzedLessons:historical, postLaunchLessons, lessonsAfterPayment,
      lastUsage:rows.filter(row=>row.lessons>0).at(-1)?.date || old.lastUsage,
      last7Lessons,last14Lessons,maxRolling7Lessons,declinePct,theoreticalNet,theoreticalLessons:Math.floor(theoreticalNet/50),
      holidayLessons,previousHolidayWeekLessons,holidayActiveDays:rows.filter(row=>row.date>=holidayFrom&&row.date<=holidayTo&&row.lessons>0).length,
      holidayGrowthPct:previousHolidayWeekLessons ? Math.round((holidayLessons/previousHolidayWeekLessons-1)*1000)/10 : null,
      holidayFollowup:focus, followupAction, reasons,score:Math.min(score,100),
      priority:forced || score>=60 ? '立即关注' : focus || score>=40 ? '重点跟进' : score>=20 ? '持续观察' : '常规'};
  }).sort((a,b)=>['立即关注','重点跟进','持续观察','常规'].indexOf(a.priority)-['立即关注','重点跟进','持续观察','常规'].indexOf(b.priority) || b.score-a.score || b.holidayLessons-a.holidayLessons);
  const dailyMap = new Map();
  for (const row of customerDaily) {
    const aggregate = dailyMap.get(row.date) || {date:row.date,lessons:0,risk:0,low:0,medium:0,high:0,reviewed:0,falsePositive:0};
    aggregate.lessons += row.lessons; aggregate.risk += row.risk ?? row.low+row.medium+row.high;
    for (const key of ['low','medium','high','reviewed','falsePositive']) aggregate[key] = nullableSum(aggregate[key],row[key]);
    dailyMap.set(row.date,aggregate);
  }
  const dailyAggregate = [...dailyMap.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const total = key => customers.reduce((value,customer)=>value+customer[key],0);
  const b = {...snapshot.baselines,
    historicalUsedCount:customers.filter(c=>c.used).length,postLaunchUsedCount:customers.filter(c=>c.postLaunchLessons>0).length,
    totalLessons:total('analyzedLessons'),postLaunchLessons:total('postLaunchLessons'),
    riskLessons:details.reduce((value,row)=>value+row.riskLessonCount,0),
    reviewedLessons:details.reduce((value,row)=>value+row.reviewedRiskLessonCount,0),
    falsePositiveLessons:details.reduce((value,row)=>value+row.falsePositiveCount,0),
    lowRiskLessons:null,mediumRiskLessons:null,highRiskLessons:null,
  };
  assert.equal(b.paidAmount,snapshot.baselines.paidAmount,'CRM金额必须保持不变');
  const metricDefinitions = snapshot.metricDefinitions.map(metric=> metric.code === 'activated_customer_payment_rate'
    ? {...metric,numerator:customers.filter(c=>c.paid&&c.used).length,denominator:b.historicalUsedCount}
    : metric.code === 'post_payment_continued_usage_rate' ? {...metric,numerator:customers.filter(c=>c.paid&&c.lessonsAfterPayment>0).length,denominator:b.paidCount} : metric);
  const usageFocus = {holidayFrom,holidayTo,previousFrom,previousTo,completeTo,periodLabel:options.weekly?'近7天':'十一',
    highUsageThreshold:40,lowPaidThreshold:10,
    description:`${options.weekly?'近7天':'十一'}（${holidayFrom}至${holidayTo}）对比前周（${previousFrom}至${previousTo}）：高消耗客户跟进需求，已充值但低消耗客户排查使用障碍。2,000 AI额度/500 AI额度（40课节/10课节）为可调整的工作阈值，不代表客户价值或真实未使用原因。`,
    holidayTotal:total('holidayLessons'),previousTotal:total('previousHolidayWeekLessons'),
    highUsageCount:customers.filter(c=>c.holidayLessons>=40).length,
    paidLowUsageCount:customers.filter(c=>c.paid&&c.holidayLessons<=10).length,
    holidayActiveCount:customers.filter(c=>c.holidayLessons>0).length,
  };
  return {...snapshot,customers,customerDaily,dailyAggregate,baselines:b,metricDefinitions,usageFocus,
    asOf:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(manifest.capturedAt)),
    sourceMetadata:{...snapshot.sourceMetadata,
      eeo:{dataAsOf:to,capturedAt:manifest.capturedAt,matchedCustomers:details.length,dailyRange:{from,to},dailyReconciled:true,listScope:'monitorStatus=0，仅筛选列表',filteredInstitutionCount:manifest.platformInstitutionCount,riskBreakdownComplete:false,dailyStatusAvailableThrough:'2026-09-20',dailyFields:['lessons','risk'],missingDailyFields:['riskGrades','reviewed','falsePositive']},
      crm:{...snapshot.sourceMetadata?.crm,status:'unchanged_no_new_orders'},
    }};
}
