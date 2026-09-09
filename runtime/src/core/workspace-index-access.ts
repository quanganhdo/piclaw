import { readAccessConfig } from './config-access.js';
import { getWorkspaceDir } from './config-context.js';
import { getExecutionIdentity } from './execution-context.js';

export class WorkspaceIndexAccessDenied extends Error {
  constructor(){super('Workspace index access denied.');this.name='WorkspaceIndexAccessDenied';}
}

/** Trusted background APIs only in family mode. This does not grant a model a search capability. */
export function workspaceIndexAccess() {
  const mode=readAccessConfig().mode,workspace=getWorkspaceDir(),identity=getExecutionIdentity();let denied=false;
  const validate=()=>{
    try{
      if(denied||readAccessConfig().mode!==mode||getWorkspaceDir()!==workspace||getExecutionIdentity()!==identity
        ||(mode!=='single-user'&&mode!=='family-shared')||(identity&&(mode==='family-shared'||identity.mode!=='single-user')))throw new WorkspaceIndexAccessDenied();
    }catch{denied=true;throw new WorkspaceIndexAccessDenied();}
  };
  validate();return {mode,workspace,validate};
}
