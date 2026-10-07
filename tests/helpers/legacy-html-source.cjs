'use strict';
// Legacy business regression tests use the same fixed source version as the
// protected owner builder. Root HTML entries are routing shims after cutover;
// their release coherence and routing are checked separately.
module.exports=require('../../server/apps-script/legacy-page-source.cjs').readLegacyPageSource;
