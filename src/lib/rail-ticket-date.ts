import { chinaDateTime, isJourneyDate } from "./train-position";

/** The official ticket pre-sale period is 15 days including today, in China time. */
export function ticketDateRange(now = Date.now()) {
  return { min: chinaDateTime(now).slice(0, 10), max: chinaDateTime(now + 14 * 86400000).slice(0, 10) };
}

export function ticketDateError(date: string, now = Date.now()): string | null {
  if (!isJourneyDate(date)) return "请填写有效的乘车日期。";
  const { min, max } = ticketDateRange(now);
  if (date < min) return `乘车日期 ${date} 已过期，不能查询历史余票。请选择 ${min} 至 ${max} 的日期。`;
  if (date > max) return `乘车日期 ${date} 超出 12306 预售期（含当天 15 天）。目前可查询 ${min} 至 ${max}。`;
  return null;
}
