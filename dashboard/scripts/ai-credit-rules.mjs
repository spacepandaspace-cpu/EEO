export function orderAiCredits(amountYuan) {
  if(amountYuan===null || !['string','number'].includes(typeof amountYuan) || String(amountYuan).trim()==='') throw new Error('订单金额缺失');
  const cents=Math.round(Number(amountYuan)*100);
  if(!Number.isSafeInteger(cents)||cents<0||Math.abs(cents/100-Number(amountYuan))>0.000001) throw new Error('订单金额无效');
  const purchased=cents; // 1元=100 AI额度，1分=1 AI额度。
  const bonus=purchased*(cents>=1_000_000?1:0.5);
  if(purchased+bonus>Number.MAX_SAFE_INTEGER) throw new Error('订单AI额度超过安全计算范围');
  return {purchased,bonus,total:purchased+bonus};
}
export function paymentAiCredits(orders) {
  return orders.reduce((sum,order)=>{const credits=orderAiCredits(order.amount);return {purchased:sum.purchased+credits.purchased,bonus:sum.bonus+credits.bonus,total:sum.total+credits.total,amount:sum.amount+Number(order.amount),count:sum.count+1};},{purchased:0,bonus:0,total:0,amount:0,count:0});
}
