import {validateCustomSettings} from '../server/effect-renderer.mjs';
import {MAX_LIGHT_PROFILES,MAX_PROFILE_BYTES,profileMetadata,profileDocumentItems,profileDocument} from '../server/profile-schema.mjs';

export const DEFAULT_CONFIG={effect:'rainbow',colors:['#a78bfa','#f34793','#3278ff','#00c6c9'],brightness:80,speed:50,direction:'forward',scale:50};
export const PREVIEW_DEVICES=[{id:0,name:'Lüfter',category:'fans',vendor:'Vorschau',ledCount:48},{id:1,name:'RAM',category:'ram',vendor:'Vorschau',ledCount:16},{id:2,name:'Mainboard',category:'motherboard',vendor:'Vorschau',ledCount:12},{id:3,name:'Grafikkarte',category:'gpu',vendor:'Vorschau',ledCount:12},{id:4,name:'LED-Strip',category:'strip',vendor:'Vorschau',ledCount:30}].map(d=>({...d,directMode:true,zones:[{id:0,name:'Alle LEDs',ledCount:d.ledCount,startIndex:0}]}));
const scenePreset=(name,effect,colors,settings)=>({name,effect,colors,config:{...DEFAULT_CONFIG,effect,colors,...settings}});
export const SCENES=[
 {name:'Neon Night',colors:['#a044ff','#e443c9','#4c37fa','#8d54ff'],effect:'wave'},
 {name:'Aurora',colors:['#00caaa','#16a5bf','#7761ff','#9c49eb'],effect:'gradient'},
 {name:'Sunset',colors:['#fa4e71','#ff7c26','#ffbf39','#e94139'],effect:'wave'},
 {name:'Ice Blue',colors:['#227aff','#00bdf3','#8ce8ff','#3985e8'],effect:'breathing'},
 scenePreset('Kaminfeuer','fire',['#620b02','#df3008','#ff8a15','#ffe27a'],{brightness:85,speed:40,scale:55}),
 scenePreset('Polarlicht','aurora',['#032423','#00b57f','#69f8c0','#584fe2'],{brightness:80,speed:22,scale:35}),
 scenePreset('Neon-Komet','comet',['#54f5ff','#386fff','#ca52ff','#ff49be'],{brightness:90,speed:60,scale:40}),
 scenePreset('Neon-Lauflicht','chase',['#e746aa','#956bff','#35d5f0','#fff3fa'],{brightness:80,speed:55,scale:45}),
 scenePreset('Goldglanz','twinkle',['#5c3103','#c99730','#f8de8b','#fff3cd'],{brightness:75,speed:25,scale:45}),
 scenePreset('Schwarz-Gold','stripes',['#080603','#c2953d','#f4dc91','#100b04'],{brightness:70,speed:25,scale:25}),
 scenePreset('Eissturm','meteorshower',['#073869','#29b5e0','#beeefe','#ffffff'],{brightness:85,speed:70,scale:55}),
 scenePreset('Glut','embers',['#3b0300','#aa1d03','#ee5b09','#f8b135'],{brightness:65,speed:20,scale:35}),
 scenePreset('Lava','fire',['#280003','#b51007','#ef4114','#ffb021'],{brightness:85,speed:50,scale:70}),
 scenePreset('Ozean','ripple',['#031b47','#07558c','#05abb0','#8ae5ef'],{brightness:75,speed:35,scale:40}),
 scenePreset('Sternenfeld','sparkle',['#050b2a','#4b478c','#a9baff','#f4efff'],{brightness:70,speed:25,scale:35}),
 scenePreset('Waldlicht','aurora',['#092315','#1f6d30','#67b85a','#d9eb91'],{brightness:65,speed:18,scale:35}),
 scenePreset('Polarweiß','breathing',['#8baacb','#d7e7f5','#f4f8ff','#ffffff'],{brightness:65,speed:18,scale:50}),
 scenePreset('Cyberpunk','gradientwave',['#ee1477','#693eff','#16d9ef','#fae639'],{brightness:85,speed:60,scale:50}),
].map((scene,index)=>({...scene,id:'preset-'+index,category:['Neon','Natur','Warm','Winter','Feuer','Natur','Neon','Neon','Gold','Gold','Winter','Feuer','Feuer','Wasser','Weltraum','Natur','Winter','Neon'][index],favorite:false,config:scene.config||{...DEFAULT_CONFIG,effect:scene.effect,colors:[...scene.colors]}}));
export const SCENE_CATEGORIES=['Neon','Gold','Natur','Warm','Winter','Feuer','Wasser','Weltraum','Eigene'];
export const EFFECT_NAMES={static:'Statisch',rainbow:'Regenbogen',breathing:'Atmen',wave:'Welle',gradient:'Farbverlauf',sparkle:'Funkeln',colorcycle:'Farbwechsel',comet:'Komet',chase:'Lauflicht',scanner:'Scanner',ripple:'Wasserwelle',fire:'Feuer',aurora:'Nordlicht',stripes:'Farbstreifen',rainbowbreathing:'Regenbogen-Atmen',rainbowcomet:'Regenbogen-Komet',rainbowsparkle:'Regenbogen-Funkeln',heartbeat:'Herzschlag',strobe:'Stroboskop',lightning:'Blitze',twinkle:'Sternenglanz',meteorshower:'Meteorschauer',stack:'Lichtstapel',pingpong:'Pingpong',marquee:'Theaterlicht',duel:'Lichtduell',police:'Wechselblitzer',gradientwave:'Verlaufwelle',pulse:'Lichtpuls',embers:'Glut',custom:'Eigener Effekt'};
export const EFFECT_DETAILS={
 static:{description:'Eine gleichmäßige Farbe, die dauerhaft leuchtet.',colors:'first',speed:false,direction:false},
 rainbow:{description:'Das komplette Farbspektrum wandert über die LEDs.',colors:'spectrum',speed:true,direction:true,scale:{label:'Spektrumdichte',help:'Höhere Werte verteilen mehr Regenbogenfarben über die LED-Reihe.'}},
 breathing:{description:'Deine Farben werden gemeinsam sanft heller und dunkler.',colors:'all',speed:true,direction:false},
 wave:{description:'Eine leuchtende Welle bewegt sich durch deine Farbpalette.',colors:'all',speed:true,direction:true,scale:{label:'Wellendichte',help:'Höhere Werte zeigen mehr Wellen gleichzeitig.'}},
 gradient:{description:'Deine Farben gehen entlang der LEDs weich ineinander über.',colors:'all',speed:false,direction:true,directionLabel:'Farbfolge'},
 sparkle:{description:'Einzelne LEDs funkeln in zufälligen Farben deiner Palette.',colors:'all',speed:true,direction:false,scale:{label:'Funkeldichte',help:'Höhere Werte lassen mehr LEDs gleichzeitig funkeln.'}},
 colorcycle:{description:'Alle LEDs wechseln gemeinsam weich zwischen deinen Farben.',colors:'all',speed:true,direction:false,note:'Wähle mindestens zwei Farben, um einen Farbwechsel zu sehen.'},
 comet:{description:'Ein heller Komet zieht einen weichen Farbschweif hinter sich her.',colors:'all',speed:true,direction:true,scale:{label:'Schweiflänge',help:'Höhere Werte verlängern den leuchtenden Schweif.'}},
 chase:{description:'Leuchtende Punkte laufen in deinen Farben über die LED-Reihe.',colors:'all',speed:true,direction:true,scale:{label:'Lichtdichte',help:'Höhere Werte zeigen mehr laufende Lichtpunkte.'}},
 scanner:{description:'Ein Lichtstrahl läuft hin und her, wie bei einem Scanner.',colors:'all',speed:true,direction:true,scale:{label:'Strahlbreite',help:'Höhere Werte verbreitern den wandernden Lichtstrahl.'}},
 ripple:{description:'Weiche Lichtwellen breiten sich aus und gehen ineinander über.',colors:'all',speed:true,direction:true,scale:{label:'Wellendichte',help:'Höhere Werte erzeugen mehr Lichtwellen gleichzeitig.'}},
 fire:{description:'Deine Farben flackern in einer lebendigen Flammenstruktur.',colors:'all',speed:true,direction:true,scale:{label:'Flammenstruktur',help:'Höhere Werte geben den Flammen mehr kleine Wirbel. Die Szene „Kaminfeuer“ liefert warme Farben.'}},
 aurora:{description:'Sanfte Farbbänder gleiten wie ein Nordlicht über die LEDs.',colors:'all',speed:true,direction:true,scale:{label:'Banddichte',help:'Höhere Werte zeigen mehr Nordlichtbänder gleichzeitig.'}},
 stripes:{description:'Klare Farbstreifen wandern in der Reihenfolge deiner Palette.',colors:'all',speed:true,direction:true,note:'Mit mindestens zwei Farben werden die bewegten Streifen sichtbar.',scale:{label:'Streifendichte',help:'Höhere Werte erzeugen mehr und schmalere Farbstreifen.'}},
 rainbowbreathing:{description:'Das Regenbogenspektrum wird sanft heller und dunkler.',colors:'spectrum',speed:true,direction:true,scale:{label:'Spektrumdichte',help:'Höhere Werte verteilen mehr Regenbogenfarben über die LEDs.'}},
 rainbowcomet:{description:'Ein Komet mit buntem Regenbogenschweif zieht über die LEDs.',colors:'spectrum',speed:true,direction:true,scale:{label:'Schweiflänge',help:'Höhere Werte verlängern den bunten Schweif.'}},
 rainbowsparkle:{description:'Einzelne LEDs blitzen in Farben des Regenbogens auf.',colors:'spectrum',speed:true,direction:false,scale:{label:'Funkeldichte',help:'Höhere Werte lassen mehr LEDs gleichzeitig funkeln.'}},
 heartbeat:{description:'Zwei kurze Lichtpulse folgen aufeinander wie ein Herzschlag.',colors:'all',speed:true,direction:false},
 strobe:{description:'Kurze Lichtblitze wechseln durch deine Farbpalette.',colors:'all',speed:true,direction:false,scale:{label:'Blitzdauer',help:'Höhere Werte verlängern jeden Lichtblitz.'}},
 lightning:{description:'Unregelmäßige Folgen kurzer Blitze leuchten in deinen Farben.',colors:'all',speed:true,direction:false,scale:{label:'Blitzhäufigkeit',help:'Höhere Werte erzeugen häufiger Blitzfolgen.'}},
 twinkle:{description:'Die LEDs glimmen unabhängig voneinander sanft auf und ab.',colors:'all',speed:true,direction:false,scale:{label:'Glanzdauer',help:'Höhere Werte erzeugen kürzere, deutlichere Glanzpunkte.'}},
 meteorshower:{description:'Drei Meteore ziehen mit verschiedenen Geschwindigkeiten über die LEDs.',colors:'all',speed:true,direction:true,scale:{label:'Schweiflänge',help:'Höhere Werte verlängern die Meteorschweife.'}},
 stack:{description:'Ein wandernder Lichtpunkt baut nach und nach einen leuchtenden Stapel auf.',colors:'all',speed:true,direction:true,scale:{label:'Blockanzahl',help:'Höhere Werte teilen den Lichtstapel in mehr Blöcke.'}},
 pingpong:{description:'Zwei farbige Lichtpunkte laufen gegeneinander und wieder auseinander.',colors:'all',speed:true,direction:true,scale:{label:'Punktbreite',help:'Höhere Werte verbreitern die beiden Lichtpunkte.'}},
 marquee:{description:'Jede dritte Lichtgruppe leuchtet als wanderndes Theaterlicht.',colors:'all',speed:true,direction:true,scale:{label:'Lichtdichte',help:'Höhere Werte erzeugen mehr und kleinere Lichtgruppen.'}},
 duel:{description:'Zwei Kometen laufen von entgegengesetzten Seiten aufeinander zu.',colors:'all',speed:true,direction:true,scale:{label:'Schweiflänge',help:'Höhere Werte verlängern beide Kometenschweife.'}},
 police:{description:'Die beiden Hälften der LED-Reihe blitzen abwechselnd auf.',colors:'all',speed:true,direction:true,note:'Die erste und zweite Farbe bestimmen die Seiten. Wähle beispielsweise Rot und Blau.'},
 gradientwave:{description:'Ein durchgehender weicher Farbverlauf wandert entlang der LEDs.',colors:'all',speed:true,direction:true,scale:{label:'Verlaufdichte',help:'Höhere Werte wiederholen deinen Farbverlauf häufiger.'}},
 pulse:{description:'Ein klarer einzelner Lichtpuls leuchtet auf und wechselt sanft die Farbe.',colors:'all',speed:true,direction:false},
 embers:{description:'Langsam glimmende Lichtpunkte bilden eine ruhige Glutstruktur.',colors:'all',speed:true,direction:true,scale:{label:'Glutstruktur',help:'Höhere Werte verteilen kleinere Glutpunkte über die LED-Reihe.'}},
 custom:{description:'Gestalte dein eigenes Lichtmuster: Farben, Bewegung, Umlaufzeit, Wiederholungen und Puls lassen sich frei kombinieren.',colors:'all',speed:false,direction:true,directionLabel:'Farbfolge und Bewegung',note:'Mit mindestens zwei Farben werden Farbverlauf und Bewegung sichtbar. Als Lichtprofil kannst du deinen Effekt speichern und teilen.'},
};
export const MAX_PROFILES=MAX_LIGHT_PROFILES;
export const MAX_PROFILE_IMPORT_BYTES=MAX_PROFILE_BYTES;
export function categorize(d){
 if(d.category && ['ram','motherboard','fans','gpu','strip','keyboard','mouse','headset','gamepad','light','peripheral','drive','microphone'].includes(d.category))return d.category;
 const names={0:'motherboard',1:'ram',2:'gpu',3:'fans',4:'strip',5:'keyboard',6:'mouse',7:'mouse',8:'headset',9:'headset',10:'gamepad',11:'light',12:'light',13:'light',14:'drive',15:'fans',16:'microphone',17:'peripheral',18:'keyboard',19:'peripheral',20:'peripheral'};
 const s=`${d.name} ${d.description??''}`.toLowerCase();
 if(/ram|dram|memory|dimm|vengeance|dominator|trident/.test(s))return 'ram';
 if(/gpu|graphics|geforce|radeon|grafik/.test(s))return 'gpu';
 if(/keyboard|tastatur/.test(s))return 'keyboard';
 if(/mouse|maus/.test(s))return 'mouse';
 if(/strip|led band/.test(s))return 'strip';
 if(/motherboard|mainboard|aura|mystic|baseboard/.test(s))return 'motherboard';
 if(/fan|lüfter|controller|commander/.test(s))return 'fans';
 return names[d.type]||'peripheral';
}
export async function api(path,body){const response=await fetch(`/api/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='strimer/control'?120000:path.startsWith('system')||path==='coverage'?24000:['corsair/setup','msi/setup'].includes(path)?120000:path==='strimer/refresh'?35000:['discover','rescan','connect','window/show'].includes(path)?25000:16000)});const data=await response.json();if(!response.ok)throw new Error(data.error||data.message||'Die Verbindung konnte nicht hergestellt werden.');return data;}
export function validConfig(raw){if(!raw||!Object.hasOwn(EFFECT_NAMES,raw.effect)||!Array.isArray(raw.colors)||raw.colors.length<1||raw.colors.length>8||!raw.colors.every(c=>/^#[0-9a-f]{6}$/i.test(c)))throw new Error('Das Profil enthält ungültige Farben oder Effekte.');for(const k of ['brightness','speed','scale'])if(!Number.isFinite(raw[k])||raw[k]<0||raw[k]>100)throw new Error('Die Profilwerte müssen zwischen 0 und 100 liegen.');if(!['forward','reverse'].includes(raw.direction))throw new Error('Ungültige Effektrichtung.');const config={effect:raw.effect,colors:[...raw.colors],brightness:raw.brightness,speed:Math.max(1,raw.speed),scale:Math.max(1,raw.scale),direction:raw.direction};if(raw.effect==='custom')config.custom=validateCustomSettings(raw.custom);return config;}
export function validProfile(p,{newId=false}={}){
 if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||/[\u0000-\u001f]/.test(p.name))throw new Error('Der Szenenname muss 1 bis 60 Zeichen enthalten.');
 const id=newId?crypto.randomUUID():p.id;
 if(typeof id!=='string'||!id||id.length>80||/[\u0000-\u001f]/.test(id))throw new Error('Die Szenenkennung ist ungültig.');
 return {id,name:p.name.trim(),config:validConfig(p.config),...profileMetadata(p)};
}
export function importProfileDocument(value){
 const data=profileDocumentItems(value,{allowArray:false});
 if(!data.length||data.length>MAX_PROFILES)throw new Error('Die Datei muss 1 bis 100 gültige Szenen enthalten.');
 if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_PROFILE_IMPORT_BYTES)throw new Error('Die Profildatei ist zu groß (maximal 128 KB).');
 return data.map(p=>validProfile(p,{newId:true}));
}
export function readProfiles(){try{const raw=localStorage.getItem('prism.profiles.v1')||'[]';if(new TextEncoder().encode(raw).length>MAX_PROFILE_IMPORT_BYTES)return [];const data=profileDocumentItems(JSON.parse(raw));const profiles=[],ids=new Set();for(const p of data){try{const candidate=validProfile(p,{newId:typeof p?.id!=='string'||!p.id||ids.has(p.id)});ids.add(candidate.id);profiles.push(candidate);if(profiles.length===MAX_PROFILES)break;}catch{}}return profiles;}catch{return [];}}
export function downloadProfiles(profiles){if(!Array.isArray(profiles)||!profiles.length||profiles.length>MAX_PROFILES)throw new Error('Exportiere 1 bis 100 Szenen pro Datei.');const safe=profiles.map(p=>validProfile(p));let data=JSON.stringify(profileDocument(safe),null,2);if(new TextEncoder().encode(data).length>MAX_PROFILE_IMPORT_BYTES)data=JSON.stringify(profileDocument(safe));if(new TextEncoder().encode(data).length>MAX_PROFILE_IMPORT_BYTES)throw new Error('Die exportierte Datei ist zu groß (maximal 128 KB).');const blob=new Blob([data],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Batto-RGB-Szenen.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export function hexToHsv(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255);const max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;let h=0;if(delta){const i=rgb.indexOf(max);h=(i===0?(rgb[1]-rgb[2])/delta:i===1?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4)*60;}return {h:(h+360)%360,s:max===0?0:delta/max,v:max};}
export function hsvToHex(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;const parts=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return '#'+parts.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');}
