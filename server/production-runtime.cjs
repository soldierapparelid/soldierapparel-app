'use strict';
// Reviewed dependency assembly only: no SDK init, listener, deploy or secrets.
const Adapter=require('./production-tenant-adapter.cjs'),Service=require('./production-command-service.cjs'),Http=require('./production-http-handler.cjs'),Limiter=require('./production-rate-limiter.cjs'),Session=require('./production-session-service.cjs');
const Admin=require('./production-tenant-admin.cjs'),TariffLedger=require('./production-tariff-ledger.cjs');
const Enrollment=require('./production-enrollment-service.cjs');
const Revocation=require('./production-identity-revocation-service.cjs');
const LegacyOperations=require('./production-legacy-operations-service.cjs');
const HistoryService=require('./production-legacy-history-service.cjs'),HistoryLoader=require('./production-legacy-history-loader.cjs'),HistoryCodec=require('./production-legacy-history-archive-codec.cjs');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function exact(v,keys){return object(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d&&d.enumerable&&Object.hasOwn(d,'value');});}
const disabled=()=>Object.freeze({handler:Http.createProductionHttpHandler()});
function createProductionRuntime(options={}){
  if(options.enabled!==true)return disabled();
  const enrollmentFlag=Object.getOwnPropertyDescriptor(options,'enrollmentEnabled');
  if(enrollmentFlag&&(!enrollmentFlag.enumerable||!Object.hasOwn(enrollmentFlag,'value')||typeof enrollmentFlag.value!=='boolean'))return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  const enrollmentEnabled=enrollmentFlag?.value===true;
  const revocationFlag=Object.getOwnPropertyDescriptor(options,'identityRevocationEnabled');
  if(revocationFlag&&(!revocationFlag.enumerable||!Object.hasOwn(revocationFlag,'value')||typeof revocationFlag.value!=='boolean'))return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  const identityRevocationEnabled=revocationFlag?.value===true;
  const historyFlag=Object.getOwnPropertyDescriptor(options,'legacyHistoryEnabled');
  if(historyFlag&&(!historyFlag.enumerable||!Object.hasOwn(historyFlag,'value')||typeof historyFlag.value!=='boolean'))return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  const legacyHistoryEnabled=historyFlag?.value===true;
  const legacyFlag=Object.getOwnPropertyDescriptor(options,'legacyOperationsEnabled');
  if(legacyFlag&&(!legacyFlag.enumerable||!Object.hasOwn(legacyFlag,'value')||typeof legacyFlag.value!=='boolean'))return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});
  const legacyOperationsEnabled=legacyFlag?.value===true;
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
    const identityRevocationService=identityRevocationEnabled?Revocation.createProductionIdentityRevocationService({enabled:true,projectId,databaseURL,tenantId,database,auth,clock,admit:ownerAdmit,...(options.testOnlyEmulator===undefined?{}:{testOnlyEmulator:exact(options.testOnlyEmulator,['host','port'])&&options.testOnlyEmulator.host==='127.0.0.1'&&options.testOnlyEmulator.port===9000})}):undefined;
    let legacyHistoryService;
    if(legacyHistoryEnabled){
      const d=Object.getOwnPropertyDescriptor(options,'legacyHistoryArchive');
      if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!exact(d.value,['snapshotVersion','publicationProof']))throw Error('unavailable');
      const archive=d.value,historyScope={projectId,databaseURL,tenantId,snapshotVersion:archive.snapshotVersion},publicationProof=HistoryCodec.validatePublicationProof(archive.publicationProof,historyScope);
      const historySource=HistoryLoader.createProductionLegacyHistoryLoader({enabled:true,scope:historyScope,database,publicationProof,...(options.testOnlyEmulator===undefined?{}:{testOnlyEmulator:exact(options.testOnlyEmulator,['host','port'])&&options.testOnlyEmulator.host==='127.0.0.1'&&options.testOnlyEmulator.port===9000})});
      legacyHistoryService=HistoryService.createProductionLegacyHistoryService({enabled:true,...historyScope,database,auth,historySource,admit:q=>limiter.admit(q),clock});
    }
    let legacyOperationsService;
    if(legacyOperationsEnabled){
      const d=Object.getOwnPropertyDescriptor(options,'legacyOperationsTariffPolicy');
      if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!exact(d.value,['version','reviewed','timeZone','quantityBasis']))throw Error('unavailable');
      const p=d.value;if(p.version!=='legacy-jahit-current-v1'||p.reviewed!==true||p.timeZone!=='Asia/Jakarta'||p.quantityBasis!=='good-plus-reject')throw Error('unavailable');
      const tariffPolicy=Object.freeze({version:p.version,reviewed:true,timeZone:p.timeZone,quantityBasis:p.quantityBasis});
      // This fixed compatible lane retains v2 provenance and actual legacy
      // root/source receipts; it never weakens the separate v1 command path.
      legacyOperationsService=LegacyOperations.createProductionLegacyOperationsService({enabled:true,projectId,databaseURL,tenantId,database,auth,clock,admit:q=>limiter.admit(q),tariffPolicy});
    }
    const ownerTariffWriter=Object.freeze({execute:async request=>{
      // Only the durable future-tariff command is exposed. Grant editing,
      // seeding and config activation remain unregistered.
      try{TariffLedger.validateTariffCommand(request.command);}catch{return Object.freeze({ok:false,error:'invalid_request'});}
      return admin.execute(request);
    },resolveTariffDraft:async request=>{
      try{TariffLedger.validateTariffCommand(request.command);}catch{return Object.freeze({ok:false,error:'invalid_request'});}
      return admin.resolveTariffDraft(request);
    }});
    return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true,service,sessionService,ownerTariffService,ownerTariffWriter,...(enrollmentEnabled?{enrollmentService}:{}),...(identityRevocationEnabled?{identityRevocationService}:{}),...(legacyHistoryEnabled?{legacyHistoryService,historyBinding:Object.freeze({projectId,databaseURL,tenantId})}:{}),...(legacyOperationsEnabled?{legacyOperationsService,legacyOperationsBinding:Object.freeze({projectId,databaseURL,tenantId})}:{}),ownerBinding:Object.freeze({projectId,tenantId}),allowedOrigins,path:'/v1/production/commands',deadlineMs:policy.deadlineMs,maxInFlight:policy.maxInFlight})});
  }catch{return Object.freeze({handler:Http.createProductionHttpHandler({enabled:true})});}
}
module.exports=Object.freeze({createProductionRuntime});
