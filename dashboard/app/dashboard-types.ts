export type SessionUser = {
  username: string;
  role: "admin" | "consultant";
  consultantName?: string | null;
  jobNumber?: string | null;
};

export type Customer = {
  usageDataPending?: boolean;
  uid: string;
  eeoAccountName: string;
  eeoAccountNameStatus: string;
  customerName: string;
  consultant: string;
  consultantJobNumber?: string | null;
  trial: boolean;
  claim: boolean;
  claimDate: string;
  paid: boolean;
  paymentCount: number;
  paymentTotal: number;
  purchasedAiCredits?: number | null;
  bonusAiCredits?: number | null;
  paidAiCredits?: number | null;
  used: boolean;
  analyzedLessons: number;
  postLaunchLessons: number;
  lastUsage: string;
  last7Lessons: number;
  last14Lessons: number;
  maxRolling7Lessons: number;
  declinePct: number;
  theoreticalNet: number;
  theoreticalLessons: number;
  paymentDate: string;
  lessonsAfterPayment: number;
  reasons: string[];
  score: number;
  priority: string;
  holidayLessons?: number;
  previousHolidayWeekLessons?: number;
  holidayActiveDays?: number;
  holidayGrowthPct?: number | null;
  holidayFollowup?: string;
  followupAction?: string;
};

export type DailyAggregate = {
  date: string;
  lessons: number;
  risk: number;
  low: number | null;
  medium: number | null;
  high: number | null;
  reviewed: number | null;
  falsePositive: number | null;
};

export type CustomerDaily = Omit<DailyAggregate, "risk"> & { uid: string; risk?: number };

export type Baselines = {
  customerCount: number;
  trialCount: number;
  claimCount: number;
  historicalUsedCount: number;
  postLaunchUsedCount: number;
  paidCount: number;
  paidAmount: number;
  totalLessons: number;
  postLaunchLessons: number;
  riskLessons: number;
  lowRiskLessons: number | null;
  mediumRiskLessons: number | null;
  highRiskLessons: number | null;
  reviewedLessons: number | null;
  falsePositiveLessons: number | null;
};

export type MetricDefinition = {
  code: "activated_customer_payment_rate" | "post_payment_continued_usage_rate";
  label: string;
  category: "conversion" | "retention";
  definition: string;
  formula: string;
  numerator: number;
  denominator: number;
  source: string;
};

export type CustomerAlias = {
  uid: string;
  alias: string;
  source: "customer_master" | "eeo_account" | "crm_payment";
};

export type DashboardSnapshot = {
  version: string;
  asOf: string;
  customers: Customer[];
  dailyAggregate: DailyAggregate[];
  customerDaily: CustomerDaily[];
  consultants: string[];
  baselines: Baselines;
  metricDefinitions: MetricDefinition[];
  customerAliases: CustomerAlias[];
  sourceMetadata?: { eeo?: { capturedAt?: string; dataAsOf?: string }; crm?: { dataAsOf?: string; status?: string } };
  usageFocus?: {
    periodLabel?: string; holidayFrom: string; holidayTo: string; previousFrom: string; previousTo: string;
    completeTo: string; highUsageThreshold: number; lowPaidThreshold: number;
    description: string; holidayTotal: number; previousTotal: number;
    highUsageCount: number; paidLowUsageCount: number; holidayActiveCount: number;
  };
};
