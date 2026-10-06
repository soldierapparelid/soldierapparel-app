'use strict';
// Reviewed dependency assembly only: no SDK init, listener, deploy or secrets.
const Adapter=require('./production-tenant-adapter.cjs'),Service=require('./production-command-service.cjs'),Http=require('./production-http-handler.cjs'),Limiter=require('./production-rate-limiter.cjs'),Session=require('./production-session-service.cjs');
const Admin=require('./production-tenant-admin.cjs'),TariffLedger=require('./production-tariff-ledger.cjs');
const Enrollment=require('./production-enrollment-service.cjs');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function exact(v,keys){return object(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
const disabled=()=>Object.freeze({handler:Http.createProductionHttpHandler()});
function createProductionRuntime(options={}){
  if(options.enabled!==true)return disabled();
  const enrollmentFlag=Object.getOwnPropertyDescriptor(options,'enrollmentEnabled');
  if(enrollmentFlag&&(!enrollmentFlag.enumerable||!Object.hasOwn(enrollmentFlag,'value')||typeof enrollmentFlag.value!=='boolean'))return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  const enrollmentEnabled=enrollmentFlag?.value===true;
  const {projectId,databaseURL,tenantId,database,auth,allowedOrigins,policy}=options;
  if(!exact(policy,['rateWindowMs','rateLimit','deadlineMs','maxInFlight'])||!auth||!auth.app||!auth.app.options||auth.app.options.projectId!==projectId||typeof auth.verifyIdToken!=='function')return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  const clock=options.clock===undefined?()=>new Date().toISOString():options.clock;
  if(typeof clock!=='function')return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  try{
    const scope={enabled:true,projectId,databaseURL,tenantId,database,...(options.testOnlyEmulator===undefined?{}:{testOnlyEmulator:options.testOnlyEmulator})};
    const adapter=Adapter.createProductionTenantAdapter(scope);
    const createLimiter=ownerOnly=>Limiter.createProductionRateLimiter({...scope,windowMs:policy.rateWindowMs,limit:policy.rateLimit,clock:()=>{
      const value=clock();if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString()!==value)throw Error('invalid_clock');return Date.parse(value);
    },allow:async q=>{
      // No bucket for an ungranted Google UID. Final command authorization is
      // still repeated in the canonical tenant CAS; this read grants no write.
      const grant=await adapter.repository.readGrant(q);return grant.projectId===projectId&&grant.uid===q.uid&&grant.profile.active===true&&(!ownerOnly||grant.profile.owner===true);
    }});
    // Both predicates use the SAME private UID bucket and fixed policy. Only
    // the canonical admission predicate differs for an owner-only route.
    const limiter=createLimiter(false),ownerLimiter=createLimiter(true);
    const service=Service.createProductionCommandService({enabled:true,projectId,auth,repository:adapter.repository,gateway:adapter.gateway,clock,admit:q=>limiter.admit(q)});
    const sessionService=Session.createProductionSessionService({...scope,auth,clock,admit:q=>limiter.admit(q)});
    const ownerAdmit=q=>ownerLimiter.admit(q);
    const ownerTariffService=Session.createProductionOwnerTariffService({...scope,auth,clock,admit:ownerAdmit});
    const admin=Admin.createProductionTenantAdmin({...scope,auth,clock,admit:ownerAdmit});
    const enrollmentService=enrollmentEnabled?Enrollment.createProductionEnrollmentService({...scope,auth,clock}):undefined;
    const ownerTariffWriter=Object.freeze({execute:async request=>{
      // Only the durable future-tariff command is exposed. Grant editing,
      // seeding, config activation and legacy commands remain unregistered.
      try{TariffLedger.validateTariffCommand(request.command);}catch{return Object.freeze({ok:false,error:'invalid_request'});}
      return admin.execute(request);
    },resolveTariffDraft:async request=>{
      try{TariffLedger.validateTariffCommand(request.command);}catch{return Object.freeze({ok:false,error:'invalid_request'});}
      return admin.resolveTariffDraft(request);
    }});
    return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true,service,sessionService,ownerTariffService,ownerTariffWriter,...(enrollmentEnabled?{enrollmentService}:{}),ownerBinding:Object.freeze({projectId,tenantId}),allowedOrigins,path:'/v1/production/commands',deadlineMs:policy.deadlineMs,maxInFlight:policy.maxInFlight})});
  }catch{return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});}
}
module.exports=Object.freeze({createProductionRuntime});
