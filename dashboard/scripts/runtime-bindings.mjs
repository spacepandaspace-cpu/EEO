// Read server secrets at startup; never copy them into build artifacts.
export function runtimeBindings(environment = process.env) {
  const token = environment.EEO_SYNC_TOKEN;
  if (token && (token.length < 32 || token.length > 200 || /\s/.test(token))) {
    throw new Error('EEO_SYNC_TOKEN must contain 32-200 non-whitespace characters');
  }
  const bindings=token?{EEO_SYNC_TOKEN:token}:{};
  if(environment.AUTH_MODE==='workbench'){
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
