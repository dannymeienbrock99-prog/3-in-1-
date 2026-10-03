'use strict';
let ws, uuid, action, settings = {}, definitions = [];
const $ = id => document.getElementById(id);
function send(event, payload) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({event,context:uuid,action,payload})); }
function requestCatalog() { send('sendToPlugin', {command:'catalog'}); }
function fill(id, items, selected, placeholder) {
  const control=$(id); control.replaceChildren(new Option(placeholder,''));
  for(const item of items || []) control.add(new Option(item.name,item.id));
  if(selected && ![...control.options].some(o=>o.value===selected)) control.add(new Option('Gespeicherte Auswahl (nicht verfügbar)',selected));
  control.value=selected || '';
}
function save() { settings={...settings,tileId:$('tile').value,mode:$('mode').value,curveId:$('curveId').value,sensorId:$('sensorId').value,command:$('commandText').value,label:$('label').value}; send('setSettings',settings); }
window.connectElgatoStreamDeckSocket = (port, propertyInspectorUUID, registerEvent, info, actionInfo) => {
  uuid=propertyInspectorUUID; const data=JSON.parse(actionInfo); action=data.action; settings=data.payload?.settings || {};
  for(const kind of ['fan','curve','sensor','command','listen']) $(kind).hidden=!action.endsWith('.'+kind); $('commandText').value=settings.command||''; $('label').value=settings.label||'Jarvis'; $('mode').value=settings.mode || 'percent';
  $('controls').hidden=!['.scene','.control','.combo'].some(x=>action.endsWith(x));$('controlLabel').value=settings.label||'Batto';$('addStep').hidden=!action.endsWith('.combo');
  ws=new WebSocket(`ws://127.0.0.1:${port}`);
  ws.onopen=()=>{ws.send(JSON.stringify({event:registerEvent,uuid}));requestCatalog();};
  ws.onmessage=message=>{const e=JSON.parse(message.data); if(e.event!=='sendToPropertyInspector')return;
    const p=e.payload || {}, catalog=p.catalog || {};
    definitions=p.controls?.actions||[];renderControls();
    $('status').textContent=(p.online||p.suiteOnline)?'Mit Batto 3-in-1 verbunden':'Batto 3-in-1 ist nicht erreichbar. Bitte die App öffnen.';
    fill('sensorId',(catalog.sensors||[]).map(s=>({...s,name:s.name+' ('+s.unit+')'})),settings.sensorId,'Messwert wählen …'); fill('tile',catalog.scene?.tiles,settings.tileId,'Lüfter wählen …'); fill('curveId',catalog.curves,settings.curveId,'Kurve wählen …');
  };
  ws.onclose=()=>{$('status').textContent='Verbindung zu Stream Deck geschlossen.';};
};
for(const id of ['tile','mode','curveId','sensorId','commandText','label']) $(id).addEventListener('change',save);
$('reload').addEventListener('click',requestCatalog);

function controlSteps(){if(action?.endsWith('.combo'))return settings.steps?.length?settings.steps:[{action:'scene',target:'Pause'}];return [settings.control||{action:action?.endsWith('.scene')?'scene':'navigate',target:action?.endsWith('.scene')?'Pause':'jarvis'}];}
function saveControls(steps){settings={...settings,label:$('controlLabel').value,...(action.endsWith('.combo')?{steps}:{control:steps[0]})};send('setSettings',settings);}
function renderControls(){
 if($('controls').hidden)return;const rows=controlSteps();$('steps').replaceChildren();
 rows.forEach((step,index)=>{const row=document.createElement('fieldset'),title=document.createElement('legend');title.textContent='Aktion '+(index+1);row.append(title);
  const field=(name,el)=>{const label=document.createElement('label');label.textContent=name;label.append(el);row.append(label);return el;};
  const select=(name,values,value,change)=>{const el=document.createElement('select');for(const item of values)el.add(new Option(item.name,item.id));if(value&&!values.some(x=>x.id===value))el.add(new Option('Gespeichert · aktuell nicht verfügbar',value));el.value=value;el.onchange=()=>change(el.value);field(name,el);};
  const set=(key,value,rebuild=false)=>{rows[index]={...rows[index],[key]:value};if(value===undefined)delete rows[index][key];saveControls(rows);if(rebuild)renderControls();};
  const list=action.endsWith('.scene')?definitions.filter(x=>x.id==='scene'):definitions;
  select('Funktion',list,step.action,value=>{const d=definitions.find(x=>x.id===value);rows[index]={action:value,...(d?.choices?{target:d.choices[0]?.id||''}:{})};saveControls(rows);renderControls();});
  const def=definitions.find(x=>x.id===step.action);
  if(def?.choices)select('Ziel',def.choices,step.target||'',v=>set('target',v));
  if(def?.switch)select('Schalten',[{id:'toggle',name:'Umschalten'},{id:'on',name:'Einschalten'},{id:'off',name:'Ausschalten'}],step.op||'toggle',v=>set('op',v));
  if(def?.text){const input=field('Befehl',document.createElement('input'));input.maxLength=500;input.value=step.text||'';input.onchange=()=>set('text',input.value);}
  if(def?.transition){const transitions=def.transitionChoices||definitions.find(item=>item.id==='transition')?.choices||[{id:'fade',name:'Überblenden'},{id:'cut',name:'Schnitt'}];select('Übergang',[{id:'',name:'Aktuellen Übergang verwenden'},...transitions],step.transition||'',v=>set('transition',v||undefined,true));const stinger=transitions.find(item=>item.id===step.transition)?.type==='stinger';const input=field(stinger?'Dauer: aus Stinger-Videodatei':'Dauer (ms; leer = aktuell)',document.createElement('input'));input.type='number';input.min=100;input.max=2000;input.step=50;input.value=step.durationMs??'';input.disabled=stinger;input.placeholder='Aktuelle Dauer';input.onchange=()=>set('durationMs',input.value===''?undefined:Number(input.value));}
  if(action.endsWith('.combo')&&rows.length>1){const remove=document.createElement('button');remove.textContent='Entfernen';remove.onclick=()=>{rows.splice(index,1);saveControls(rows);renderControls();};row.append(remove);}
  $('steps').append(row);
 });$('addStep').disabled=rows.length>=8;
}
$('controlLabel').onchange=()=>saveControls(controlSteps());$('addStep').onclick=()=>{const rows=controlSteps();if(rows.length>=8)return;rows.push({action:'navigate',target:'jarvis'});saveControls(rows);renderControls();};
