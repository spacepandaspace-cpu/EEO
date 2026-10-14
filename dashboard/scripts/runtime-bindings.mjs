// Read server secrets at startup; never copy them into build artifacts.
export function runtimeBindings(environment = process.env) {
  if(environment.AUTH_MODE==='hybrid'){
    const origin=new URL(environment.DASHBOARD_ORIGIN);
    if(origin.protocol!=='https:'||origin.origin!==environment.DASHBOARD_ORIGIN)throw new Error('DASHBOARD_ORIGIN must be the fixed HTTPS origin without a path');
    const accountToken=environment.WORKBENCH_ACCOUNT_TOKEN;
    if(!accountToken||accountToken.length<32||accountToken.length>200||/\s/.test(accountToken)||accountToken===environment.WORKBENCH_SECRET||accountToken===environment.EEO_SYNC_TOKEN)throw new Error('Hybrid mode requires a separate 32-200 character WORKBENCH_ACCOUNT_TOKEN');
  }
  const token = environment.EEO_SYNC_TOKEN;
  if (token && (token.length < 32 || token.length > 200 || /\s/.test(token))) {
    throw new Error('EEO_SYNC_TOKEN must contain 32-200 non-whitespace characters');
  }
  const bindings=token?{EEO_SYNC_TOKEN:token}:{};
  if(['workbench','hybrid'].includes(environment.AUTH_MODE)){
    if(!environment.WORKBENCH_SECRET||environment.WORKBENCH_SECRET.length<32)throw new Error('WORKBENCH_SECRET must be configured with at least 32 characters');
    if(!['ttl','introspect'].includes(environment.WORKBENCH_REVOKE_MODE))throw new Error('WORKBENCH_REVOKE_MODE must be ttl or introspect');
    for(const name of ['WORKBENCH_LOGIN_URL','WORKBENCH_LOGOUT_URL']){
      const url=new URL(environment[name]);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw new Error(`${name} must be a fixed HTTPS URL without credentials or query`);
    }
    if(new URL(environment.WORKBENCH_LOGIN_URL).origin!==new URL(environment.WORKBENCH_LOGOUT_URL).origin)throw new Error('Workbench login/logout origins must match');
    if(environment.WORKBENCH_REVOKE_MODE==='introspect'){
      const url=new URL(environment.WORKBENCH_INTROSPECT_URL);
      if(url.protocol!=='https:'||url.origin!==new URL(environment.WORKBENCH_LOGIN_URL).origin||url.username||url.password||url.search||url.hash||!environment.WORKBENCH_INTROSPECT_TOKEN)throw new Error('Introspection requires same-origin HTTPS and a machine token');
    }
    for(const name of ['AUTH_MODE','WORKBENCH_SECRET','WORKBENCH_LOGIN_URL','WORKBENCH_LOGOUT_URL','WORKBENCH_REVOKE_MODE','WORKBENCH_INTROSPECT_URL','WORKBENCH_INTROSPECT_TOKEN'])if(environment[name])bindings[name]=environment[name];
  }
  return bindings;
}
