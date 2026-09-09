import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { getMessageByRowIdFromDatabase, replaceMessageContentInDatabase } from "../../../db/messages.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { admitFamilyMessage } from "../messaging/family-message-authority.js";
import {
  buildAdaptiveCardSubmissionText,
  buildAdaptiveCardSubmitBlock,
  getAdaptiveCardSubmitBehavior,
  markAdaptiveCardState,
  sanitizeAdaptiveCardActionPayload,
  sanitizeAdaptiveCardSubmissionData,
} from "../cards/adaptive-card-actions.js";
import { checkCsrfOrigin } from "./security.js";

const privilegedIntent = (value:unknown) => value && typeof value === "object" && typeof (value as any).intent === "string";

/** Generic owned-card submission only; login/recovery/add-on intents remain separate denied control planes. */
export async function handleFamilyCardAction(channel:WebChannelLike,req:Request,actor:AuthenticatedPrincipal):Promise<Response>{
  if(req.method!=="POST"||!req.headers.get("origin")||!checkCsrfOrigin(req))return channel.json({error:"Session access denied."},403);
  try{
    const input=await req.json();
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["post_id","thread_id","card_id","chat_jid","action","request_id"].includes(key)))throw new ChatAccessDenied();
    const normalized=sanitizeAdaptiveCardActionPayload(input),id=(input as any).request_id;
    if(!normalized.postId||normalized.postId<=0||!normalized.cardId||normalized.actionType!=="Action.Submit"||typeof id!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||privilegedIntent(normalized.actionData))throw new ChatAccessDenied();
    const db=getDb();
    const result=db.transaction(()=>{
      const target=resolveAuthorisedChat(db,actor,normalized.chatJid??undefined,"session.write"),data=sanitizeAdaptiveCardSubmissionData(normalized.actionData);
      const existing=db.query("SELECT message_rowid,chat_jid,thread_id FROM message_execution_authorities WHERE owner_user_id=? AND request_id=?").get(actor.userId,id) as {message_rowid:number;chat_jid:string;thread_id:number|null}|null;
      if(existing){
        const message=getMessageByRowIdFromDatabase(db,target.chatJid,existing.message_rowid),blocks=message?.data.content_blocks;
        const block=Array.isArray(blocks)&&blocks.length===1?blocks[0] as any:null;
        if(existing.chat_jid!==target.chatJid||normalized.threadId!==existing.thread_id||!message||message.data.content!==buildAdaptiveCardSubmissionText(normalized.actionTitle,normalized.cardId,data)
          ||block?.type!=="adaptive_card_submission"||block.card_id!==normalized.cardId||block.source_post_id!==normalized.postId||block.title!==(normalized.actionTitle||undefined)||JSON.stringify(block.data)!==JSON.stringify(data))throw new ChatAccessDenied();
        return {target:target.chatJid,source:null,interaction:message,queue:null,submittedAt:block.submitted_at,created:false};
      }
      const source=getMessageByRowIdFromDatabase(db,target.chatJid,normalized.postId!);if(!source)throw new ChatAccessDenied();
      const submittedAt=new Date().toISOString();
      const behavior=getAdaptiveCardSubmitBehavior(source.data.content_blocks,normalized.cardId),updated=behavior==="keep_active"?source.data.content_blocks:markAdaptiveCardState(source.data.content_blocks,normalized.cardId,"completed",submittedAt,{action_type:"Action.Submit",title:normalized.actionTitle||undefined,data,submitted_at:submittedAt});
      if(!updated)throw new ChatAccessDenied();
      const block=buildAdaptiveCardSubmitBlock({cardId:normalized.cardId,sourcePostId:normalized.postId!,title:normalized.actionTitle||undefined,data,submittedAt});
      const admitted=admitFamilyMessage(actor,{chatJid:target.chatJid,content:buildAdaptiveCardSubmissionText(normalized.actionTitle,normalized.cardId,data),requestId:id,threadId:normalized.threadId??source.data.thread_id??source.id,contentBlocks:[block]});
      let updatedSource=null;
      if(behavior!=="keep_active"){
        if(!replaceMessageContentInDatabase(db,target.chatJid,source.id,source.data.content,{contentBlocks:updated??undefined,linkPreviews:source.data.link_previews,mediaIds:source.data.media_ids}))throw new ChatAccessDenied();
        updatedSource=getMessageByRowIdFromDatabase(db,target.chatJid,source.id);if(!updatedSource)throw new ChatAccessDenied();
      }
      return {target:target.chatJid,source:updatedSource,interaction:admitted.interaction,queue:admitted.queue,submittedAt,created:admitted.created};
    }).immediate();
    if(result.created){
      if(result.source)channel.broadcastEvent("interaction_updated",result.source);
      if(result.queue?.state==="ready"){
        channel.broadcastEvent("new_post",result.interaction);
        channel.resumeChat(result.target,result.interaction.data?.thread_id??result.interaction.id);
      }else channel.broadcastEvent("agent_followup_queued",{chat_jid:result.target,row_id:result.interaction.id,content:result.interaction.data.content,timestamp:result.interaction.timestamp,thread_id:result.interaction.data.thread_id??null});
    }
    return channel.json({status:"ok",source_post_id:normalized.postId,card_id:normalized.cardId,submitted_at:result.submittedAt,user_message:result.interaction,created:result.created},result.created?201:200);
  }catch(error){if(error instanceof ChatAccessDenied)return channel.json({error:"Session access denied."},403);return channel.json({error:"Card submission failed."},400);}
}
