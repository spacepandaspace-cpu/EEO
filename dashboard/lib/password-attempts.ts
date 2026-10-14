// Bounded per-process budget. This server runs as a single Node process.
const attempts=new Map<string,{count:number;until:number}>();
export function allowPasswordAttempt(account:string,now=Date.now()) {
  for(const [key,value] of attempts)if(value.until<=now)attempts.delete(key);
  const previous=attempts.get(account);
  if(previous){if(previous.count>=5)return false;previous.count++;return true;}
  if(attempts.size>=1000)return false;
  attempts.set(account,{count:1,until:now+10*60*1000});
  return true;
}
