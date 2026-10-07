'use strict';
// Reviewed public source graph only. Hashes use UTF-8 after CRLF -> LF.
// A changed source must be reviewed again; there is no override/update switch.
const rows=[
  ['server/production-enrollment-identity.cjs','518d9d28611e506ea2994d4698f55333be4bfff4e5ba770649ec8d6c3a01d758',{}],
  ['server/production-authority.cjs','0df33e596bfc94f453f1d6f9cfa1dceded44dbfd80d911d18df193e5cc0e6acf',{'node:crypto':'@crypto'}],
  ['server/production-enrollment-registry.cjs','e002d62e0f8242e74a4aabc0305b5bc5a05f587e6d3bcfe617029903627780f4',{'./production-authority.cjs':'server/production-authority.cjs','./production-enrollment-identity.cjs':'server/production-enrollment-identity.cjs'}],
  ['server/production-identity-tenant.cjs','9a0205bd142904323f8d1f2627942bbb97e5c4dcdfa68b280bceda03d65297a8',{}],
  ['server/production-identity-state.cjs','4e703962af340042895f6512831d581e682e34ab7a3d4e0090f032c385a2b03c',{'./production-identity-tenant.cjs':'server/production-identity-tenant.cjs','./production-enrollment-registry.cjs':'server/production-enrollment-registry.cjs','./production-enrollment-identity.cjs':'server/production-enrollment-identity.cjs'}],
  ['production-workflow.js','32a3709435dde95407c837ea40b1d94074a1fbe06372a15b4acbb6d9869bd718',{}],
  ['production-payroll.js','3e332ba21f47aea1861841a86a05d23353818dcb73d5a1bd0545d8adedb19a72',{}],
  ['server/production-legacy-operations.cjs','d1753f4e4c22a1f4bf51d16defae705d1a0c3be14d68249e94141577453ca35e',{'node:crypto':'@crypto','./production-identity-state.cjs':'server/production-identity-state.cjs','./production-enrollment-identity.cjs':'server/production-enrollment-identity.cjs','../production-workflow.js':'production-workflow.js','../production-payroll.js':'production-payroll.js'}],
  ['server/production-legacy-finance.cjs','db9ef3fb635d72a1996cb6f22d9d35f5e9fedc639923eb8643da39c68c6e7d7d',{'./production-legacy-operations.cjs':'server/production-legacy-operations.cjs'}]
];
const modules=Object.freeze(rows.map(([file,sha256,dependencies])=>Object.freeze({file,sha256,dependencies:Object.freeze(dependencies)})));
const configuration=Object.freeze({legacyOperationsEnabled:false,legacyFinanceEnabled:false,binding:Object.freeze({projectId:'',databaseURL:'',tenantId:''}),tariffPolicy:null});
module.exports=Object.freeze({schemaVersion:1,modules,configuration});
