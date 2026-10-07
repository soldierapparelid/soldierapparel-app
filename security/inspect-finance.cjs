'use strict';
// Read-only, local inspection. No SDK, network, file export or import command.
const fs=require('node:fs');
const {prepareCandidate}=require('./finance-rehearsal.cjs');
const MAX_BYTES=16*1024*1024;
function main(args){
  try{
    if(args.length!==1||/^https?:\/\//i.test(args[0]))throw new Error('invalid_input');
    const descriptor=fs.openSync(args[0],'r');let text;
    try{const info=fs.fstatSync(descriptor);if(!info.isFile()||info.size>MAX_BYTES)throw new Error('invalid_input');text=fs.readFileSync(descriptor,'utf8');if(Buffer.byteLength(text)>MAX_BYTES)throw new Error('invalid_input');}finally{fs.closeSync(descriptor);}
    const result=prepareCandidate(JSON.parse(text));
    process.stdout.write(JSON.stringify(result.report)+'\n');
    return result.report.status==='blocked'?2:0;
  }catch{
    // Parser and filesystem errors can include names, paths, values or secrets.
    process.stdout.write('{"status":"blocked","readyForProduction":false,"issues":{"invalid_input":1}}\n');return 2;
  }
}
if(require.main===module)process.exitCode=main(process.argv.slice(2));
module.exports={main};
