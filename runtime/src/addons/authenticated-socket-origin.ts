import { getRequestOriginParts } from '../utils/request-client';
/** Cookie-authenticated WebSockets require the exact trusted external origin. */
export function isAuthenticatedSocketOrigin(request: Request): boolean {
  const origin=request.headers.get('origin');if(!origin||origin==='null')return false;
  try{
    const supplied=new URL(origin);if(supplied.protocol!=='http:'&&supplied.protocol!=='https:')return false;
    if(supplied.origin!==origin||supplied.username||supplied.password)return false;
    const expected=getRequestOriginParts(request);
    return supplied.host===expected.host&&supplied.protocol.replace(':','')===expected.proto;
  }catch{return false;}
}
