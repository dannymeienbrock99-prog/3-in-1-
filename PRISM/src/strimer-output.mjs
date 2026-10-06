// This describes only reported devices and acknowledgements. A preview never
// creates a cable identity or counts as successful hardware output.
export function strimerConnectionState({native={},selectedDevice,rememberedMissing=false}={}){
 const provider=native?.lianliWireless||{};
 const reported=[...(Array.isArray(provider.diagnostics)?provider.diagnostics:[]),...(Array.isArray(native?.discovery)?native.discovery.filter(value=>value?.provider==='lianli-wireless'):[])];
 const diagnostics=[...new Map(reported.filter(value=>value&&typeof value==='object').map(value=>[`${value.name||''}|${value.code||''}|${value.reason||value.message||''}`,value])).values()].slice(0,16);
 if(rememberedMissing)return {phase:'missing',title:'Dein gespeichertes Kabel ist nicht verbunden',message:'Wähle ein verbundenes Kabel oder suche den Funkcontroller erneut. Es wird kein anderes Kabel automatisch angesprochen.',diagnostics};
 if(selectedDevice){
  if(selectedDevice.directMode===true&&Number.isInteger(selectedDevice.ledCount)&&selectedDevice.ledCount>0)return {phase:'ready',title:'Kabel bereit zur Übertragung',message:'„Auf dieses Kabel übertragen“ sendet den Effekt ausschließlich an das ausgewählte Kabel.',diagnostics};
  return {phase:'blocked',title:'Kabel erkannt · direkte Ausgabe nicht verfügbar',message:'Die Anbindung gibt für dieses Kabel keine eigenen RGB-Effekte frei. Verfügbare Herstellereffekte findest du unter „Effekte deiner Geräte“.',diagnostics};
 }
 const blocked=diagnostics.find(value=>['unavailable','denied','error'].includes(value.status)||['WIRELESS_ACCESS_DENIED','WIRELESS_IN_USE'].includes(value.code));
 if(blocked||['denied','unavailable','error'].includes(provider.status))return {phase:'blocked',title:'Wireless-Zugriff blockiert',message:blocked?.reason||blocked?.message||provider.message||'Der Funkcontroller konnte nicht geöffnet werden. Prüfe die Verbindung und suche erneut.',diagnostics};
 if(diagnostics.length||['ready','connected','detected'].includes(provider.status))return {phase:'missing',title:'Noch kein steuerbares Strimer-Kabel gemeldet',message:provider.message||'Der Funkcontroller wird erkannt, meldet aber noch kein gekoppeltes Strimer-Kabel für die direkte Ausgabe.',diagnostics};
 return {phase:'missing',title:'Strimer Wireless verbinden',message:provider.message||'Aktuell ist kein gekoppeltes Strimer-Kabel erreichbar. Verbinde den L-Wireless-Controller per USB und kopple deine Kabel in L-Connect 3.',diagnostics};
}

export function strimerTransmissionState(result,device){
 if(!device||!Array.isArray(result?.applied)||!result.applied.includes(device.id))throw new Error('Keine Übertragung für dieses Kabel bestätigt. Bitte erneut suchen und die Ausgabe prüfen.');
 if((device.provider||device.backend)==='lianli-wireless'){
  const upload=Array.isArray(result.uploads)?result.uploads.find(value=>value?.deviceId===device.id):null;
  if(!upload||upload.transmitted!==true||!['receiver','transmitted'].includes(upload.confirmation))throw new Error('Die Strimer-Anbindung hat keine gültige Übertragungsbestätigung geliefert.');
  if(upload.confirmation==='receiver'&&upload.confirmed===true)return {phase:'confirmed',title:'Funkempfänger bestätigt',message:`Der Effekt wurde an ${device.name} übertragen und vom Funkempfänger bestätigt.`};
  if(upload.confirmation==='transmitted'&&upload.confirmed===false)return {phase:'pending',title:'Übertragen · Funkbestätigung steht aus',message:'Der Funkcontroller hat die Daten übernommen. Der Empfänger hat den Effekt noch nicht bestätigt; prüfe das Licht am Kabel.'};
  throw new Error('Die Strimer-Anbindung hat eine widersprüchliche Funkbestätigung geliefert.');
 }
 return {phase:'transmitted',title:'An Kabel übertragen',message:`Die RGB-Anbindung hat die Ausgabe für ${device.name} angenommen. Prüfe das Licht am Kabel.`};
}

export function strimerControlPresentation(control){
 const phase=['off','starting','active','restoring','error'].includes(control?.phase)?control.phase:'off';
 const enabled=control?.enabled===true;
 const changing=phase==='starting'||phase==='restoring';
 const returnRequired=enabled||phase==='active'||phase==='restoring';
 const title=phase==='starting'?'Strimer-Steuerung wird übernommen …':phase==='restoring'?'L-Connect wird wiederhergestellt …':phase==='error'?'Strimer-Steuerung benötigt Aufmerksamkeit':returnRequired?'Batto steuert Strimer Wireless':'Strimer-Steuerung ausgeschaltet';
 const message=typeof control?.message==='string'&&control.message.trim()?control.message:returnRequired?'L-Connect ist für diesen Modus pausiert. Effekte werden ausschließlich mit „Auf dieses Kabel übertragen“ ausgegeben.':'L-Connect bleibt zuständig. Du kannst die Strimer-Steuerung hier ausdrücklich an Batto übergeben.';
 return {phase,enabled,changing,returnRequired,title,message,button:returnRequired?'L-Connect wieder übernehmen lassen':'Strimer-Steuerung übernehmen'};
}

export function strimerControlRequest(control,consent){
 const view=strimerControlPresentation(control);
 if(view.changing)throw new Error('Die Strimer-Steuerung wird gerade umgeschaltet.');
 if(view.returnRequired)return {enabled:false};
 if(consent!==true)throw new Error('Bitte das Pausieren der L-Connect-Dienste ausdrücklich bestätigen.');
 return {enabled:true,confirmLConnectPause:true};
}
