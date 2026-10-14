import 'server-only';
import { env } from '@/lib/node-runtime';
export function safeMutation(request:Request) {
  if(request.headers.get('sec-fetch-site')==='cross-site')return false;
  const origin=request.headers.get('origin');
  return !origin || origin===(env.DASHBOARD_ORIGIN || new URL(request.url).origin);
}
