'use strict';
// Fixed Functions wrapper; the source-OFF discovery path imports no SDK.
const Core=require('./deployment-runtime.cjs');
function createProductionDeployment(options={}){
  let configuration;
  try{const d=Object.getOwnPropertyDescriptor(options,'configuration');if(d&&Object.hasOwn(d,'value'))configuration=Core.validateConfiguration(d.value);}catch{}
  const fixed={configuration,host:'functions'};
  if(configuration?.enabled===true)try{for(const key of ['environment','loadAdminSdk','createRuntime']){const d=Object.getOwnPropertyDescriptor(options,key);if(d){if(!Object.hasOwn(d,'value'))throw Error();fixed[key]=d.value;}}}catch{fixed.configuration=null;}
  const deployment=Core.createDeployment(fixed);
  if(!deployment.enabled)return Object.freeze({enabled:false,functionOptions:null,handler:deployment.handler});
  const L=Core.LIMITS;
  const functionOptions=Object.freeze({region:L.region,memory:L.memory,cpu:L.cpu,minInstances:L.minInstances,maxInstances:L.maxInstances,concurrency:L.concurrency,timeoutSeconds:L.timeoutSeconds,serviceAccount:configuration.serviceAccount,cors:false,invoker:'public',preserveExternalChanges:false});
  return Object.freeze({enabled:true,functionOptions,handler:deployment.handler});
}
function createFunctionsExports(options={}){
  let configuration,onRequest;
  try{const d=Object.getOwnPropertyDescriptor(options,'configuration');if(d&&Object.hasOwn(d,'value'))configuration=Core.validateConfiguration(d.value);}catch{}
  if(!configuration)throw Error('invalid_deployment_configuration');
  if(configuration.enabled!==true)return Object.freeze({});
  try{const d=Object.getOwnPropertyDescriptor(options,'onRequest');if(d&&Object.hasOwn(d,'value'))onRequest=d.value;}catch{}
  if(typeof onRequest!=='function')throw Error('invalid_deployment_configuration');
  const deployment=createProductionDeployment(options);
  if(!deployment.enabled)throw Error('invalid_deployment_configuration');
  return Object.freeze({[Core.FUNCTION_NAME]:onRequest(deployment.functionOptions,deployment.handler)});
}
module.exports=Object.freeze({createProductionDeployment,createFunctionsExports,validateConfiguration:Core.validateConfiguration,LIMITS:Core.LIMITS,POLICY:Core.POLICY,FUNCTION_NAME:Core.FUNCTION_NAME});
