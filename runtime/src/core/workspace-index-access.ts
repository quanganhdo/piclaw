import { AsyncLocalStorage } from 'node:async_hooks';
import { readAccessConfig } from './config-access.js';
import { getWorkspaceDir } from './config-context.js';
import { getExecutionIdentity } from './execution-context.js';

export class WorkspaceIndexAccessDenied extends Error {
  constructor(){super('Workspace index access denied.');this.name='WorkspaceIndexAccessDenied';}
}

const effectAuthority=new AsyncLocalStorage<()=>void>();
/** Host-only invocation fence, retained by each access snapshot across awaits. */
export function withWorkspaceIndexAuthority<T>(assertCurrent:()=>void,body:()=>T):T{
  assertCurrent();return effectAuthority.run(assertCurrent,body);
}

/** Bind background indexing to the current single-user workspace. */
export function workspaceIndexAccess() {
  const mode=readAccessConfig().mode,workspace=getWorkspaceDir(),identity=getExecutionIdentity(),assertEffect=effectAuthority.getStore();let denied=false;
  const validate=()=>{
    try{
      assertEffect?.();
      if(denied||readAccessConfig().mode!==mode||getWorkspaceDir()!==workspace||getExecutionIdentity()!==identity
        ||mode!=='single-user'||(identity&&identity.mode!=='single-user'))throw new WorkspaceIndexAccessDenied();
    }catch{denied=true;throw new WorkspaceIndexAccessDenied();}
  };
  validate();return {mode,workspace,validate};
}
