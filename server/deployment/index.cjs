'use strict';
const configuration=require('./configuration.cjs');
// OFF discovery imports no Firebase SDK and exports no deployable function.
// This prepared package must never be deployed to an existing codebase while
// OFF: the Firebase CLI can remove previously deployed functions implicitly.
if(configuration.enabled===true){
  const {onRequest}=require('firebase-functions/v2/https');
  const {createFunctionsExports}=require('./functions-adapter.cjs');
  module.exports=createFunctionsExports({configuration,onRequest});
}else module.exports=Object.freeze({});
