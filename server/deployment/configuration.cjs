'use strict';
// Source-reviewed binding only. Empty/OFF is intentional. No browser override,
// credential file, environment activation switch, project discovery or secrets.
module.exports=Object.freeze({
  enabled:false,
  enrollmentEnabled:false,
  projectId:'',
  databaseURL:'',
  tenantId:'',
  allowedOrigins:Object.freeze([]),
  serviceAccount:''
});
