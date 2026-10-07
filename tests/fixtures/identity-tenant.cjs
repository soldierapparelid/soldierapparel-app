'use strict';
// Synthetic fixtures only; no real email, UID, worker, wage or project.
const Initial=require('../../server/production-identity-tenant.cjs');
const State=require('../../server/production-identity-state.cjs');
const PROJECT='demo-identity-state',TENANT='synthetic-tenant',URL='https://'+PROJECT+'.firebaseio.com';
const INITIAL='2026-10-06T01:00:00.000Z',BEFORE='2026-10-06T02:00:00.000Z',NOW='2026-10-06T03:00:00.000Z',AFTER='2026-10-06T04:00:00.000Z';
const EMAIL='syntheticpartner@gmail.com',QC_EMAIL='syntheticquality@gmail.com';
const copy=v=>JSON.parse(JSON.stringify(v));
function approval(profile={active:true,owner:false,workerId:'worker-1',modules:{jahit:true}},email=EMAIL){return {email,profile,reviewed:true,approvedAt:BEFORE,expiresAt:AFTER,revision:1,status:'pending'};}
function tenant(){
  const prepared=Initial.createInitialIdentityTenantPreparer({enabled:true,scope:{projectId:PROJECT,tenantId:TENANT}}).prepare({ownerUid:'owner-1',bootstrapId:'bootstrap-1',initializedAt:INITIAL,workerCatalog:{schemaVersion:1,revision:1,reviewed:true,workers:{'worker-1':{division:'jahit',reviewed:true},'worker-2':{division:'jahit',reviewed:true},'worker-pending':{division:'potong',reviewed:true}}}});
  if(!prepared.ok)throw Error('Synthetic fixture invalid');const value=copy(prepared.tenant);
  value.enrollmentRegistry={schemaVersion:1,approvals:{'approval-1':approval(),'approval-q':approval({active:true,owner:false,modules:{qc:true}},QC_EMAIL)}};return value;
}
function identity(changes={}){return {projectId:PROJECT,uid:'partner-1',email:EMAIL,googleSubject:'1000123456789',authTimeMs:Date.parse(NOW)-1000,issuedAtMs:Date.parse(NOW)-1000,expiresAtMs:Date.parse(NOW)+3600000,verifiedAt:NOW,...changes};}
const claimed=()=>State.claimIdentityEnrollment(tenant(),identity(),NOW).next;
const revokeCommand=(changes={})=>({requestId:'revoke-1',approvalId:'approval-1',expectedApprovalRevision:2,expectedGrantRevision:1,...changes});
module.exports=Object.freeze({PROJECT,TENANT,URL,INITIAL,BEFORE,NOW,AFTER,EMAIL,QC_EMAIL,copy,approval,tenant,identity,claimed,revokeCommand});
