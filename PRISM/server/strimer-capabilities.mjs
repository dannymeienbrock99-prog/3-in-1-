// Manufacturer documentation is a reference, never a hardware transport mapping.
// sourceIndex is the printed row number, NOT an HID effect ID.
export const STRIMER_SOURCES=Object.freeze({
 manual:'https://lian-li.com/downloads/StrimerL-Connect3-manual.pdf',
 product:'https://lian-li.com/product/strimer-plus-v2/',
 controller:'https://lian-li.com/product/strimer-l-connect-3-controller/',
 software:'https://lian-li.com/l-connect3/l-connect3-manual-2/',
});

const names=['Regenbogen','Wellen','Statische Farbe','Atmen','Regenbogen-Verwandlung','Snooker','Mischen','Landebahn','Farbauftrag','Pingpong','Gezeiten','Explosion','Meteore','Farbübertragung','Ausblenden','Wettlauf','Kreuzung','Lichtstapel','Funkeln','Parallele Linien','Stoßwelle','Wasserwellen','Schallwellen','Nieselregen'];
export const STRIMER_LCONNECT_MODES=Object.freeze(names.map((name,index)=>Object.freeze({
 referenceId:`lconnect-strimer-${index+1}`,sourceIndex:index+1,name,
 documentedGroup:index<13?'individual':'combined',
 source:STRIMER_SOURCES.manual,nativeAvailable:false,firmwareModeId:null,
 // The manual illustrates these controls but does not specify ranges/counts per mode.
 controls:Object.freeze({colors:'effect-dependent',brightness:'documented',speed:'documented',direction:'documented'}),
 colorsMax:null,parameterRanges:null,
})));

export const STRIMER_CABLE_TYPES=Object.freeze([
 Object.freeze({id:'24pin',name:'24-Pin',strands:12,channels:6,ledCount:120}),
 Object.freeze({id:'dual8pin',name:'2×8-Pin',strands:8,channels:4,ledCount:108}),
 Object.freeze({id:'triple8pin',name:'3×8-Pin',strands:12,channels:6,ledCount:162}),
 Object.freeze({id:'12vhpwr12',name:'12+4-Pin · 12 Lichtleiter',strands:12,channels:null,ledCount:162}),
 Object.freeze({id:'12vhpwr8',name:'12+4-Pin · 8 Lichtleiter',strands:8,channels:null,ledCount:108}),
]);

export function strimerCapabilities(device) {
 const isStrimer=!!device&&/strimer/i.test(`${device.name??''} ${device.description??''} ${device.family??''}`);
 const wireless=isStrimer&&(device.backend==='lianli-wireless'||/wireless/i.test(`${device.name??''} ${device.family??''}`));
 const direct=!!device?.directMode&&Number.isInteger(device?.ledCount)&&device.ledCount>0;
 const native=Array.isArray(device?.nativeEffects)?device.nativeEffects.map(effect=>({...effect})):[];
 return {
  family:wireless?'wireless':isStrimer?'plus-v2-or-other-wired':'unassigned',
  nativeEffects:native,nativeAvailable:isStrimer&&native.length>0,
  directAvailable:isStrimer&&direct,
  // No checked per-channel transport exists in this release. UI-only channels
  // must never be turned into device IDs, zone indices or HID commands.
  separateChannelOutput:false,physicalOutputVerified:false,
  lconnectReference:STRIMER_LCONNECT_MODES,sources:STRIMER_SOURCES,
  limitation:wireless?'Strimer Wireless ist eine andere Controllerfamilie. Es stehen nur die vom erkannten Gerät gemeldeten Effekte zur Verfügung.'
   :isStrimer&&direct?'Die Ausgabe kann über das erkannte Gerät erfolgen. Eine getrennte L-Connect-Kanalzuordnung ist hier nicht geprüft.'
    :isStrimer&&native.length?device.wholeControllerOnly?'Die native Ausgabe ändert alle angeschlossenen Strimer-Kanäle dieses Controllers und benötigt deine ausdrückliche Bestätigung. Getrennt bleibt Vorschau; die reale Ausgabe ist in Batto noch nicht physisch geprüft.':'Verwende ausschließlich die vom erkannten Controller angebotenen Effekte. Eine Strimer-Plus-V2-Kanalsteuerung ist nicht geprüft.'
     :'Die native USB-Kanalsteuerung für Strimer Plus V2 ist hier noch nicht verfügbar. Die animierten Stränge sind eine Vorschau; L-Connect-Effekte bleiben ein dokumentierter Vergleich.',
  documentationConflict:'Die Produktseite nennt 11 Einzel- und 13 Gesamtmodi; die PDF-Tabelle ordnet 13 Einzel- und 11 Gesamtmodi zu. Die Kanalzuordnung wird deshalb nicht aus diesen Zahlen abgeleitet.',
 };
}
