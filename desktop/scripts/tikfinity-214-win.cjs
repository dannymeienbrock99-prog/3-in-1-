'use strict';
const fs=require('node:fs'),path=require('node:path');
// Historical entry point retained for packaging. Verification must not rewrite current source or QA expectations.
function apply(root=path.resolve(__dirname,'..')){
 const read=name=>fs.readFileSync(path.join(root,name),'utf8');
 if(!read('src/core/config-store.cjs').includes('DEFAULT_TIKFINITY_WIDGETS'))throw new Error('TikFinity-Konfigurationsgrundlage fehlt.');
 if(!read('src/renderer/app.js').includes('pfTikChatUrl'))throw new Error('TikFinity-Chatverbindung fehlt.');
 if(!read('src/core/settings/schema.cjs').includes('isTikFinityWidgetUrl'))throw new Error('TikFinity-URL-Prüfung fehlt.');
 console.log('Aktuelle TikFinity-Integration geprüft; Quelldateien unverändert.');
}
module.exports={apply};
if(require.main===module)apply();
