import {SCENES,MAX_PROFILES,MAX_PROFILE_IMPORT_BYTES,validProfile} from './data.js';
import {profileDocument} from '../server/profile-schema.mjs';

export function sceneLibrary(profiles=[]) {
 const saved=new Map(profiles.map(profile=>[profile.id,profile]));
 return [...SCENES.map(scene=>saved.has(scene.id)?{...scene,...saved.get(scene.id),modified:true}:scene),...profiles.filter(profile=>!SCENES.some(scene=>scene.id===profile.id))];
}

export function validateSceneCollection(profiles) {
 if(!Array.isArray(profiles)||profiles.length>MAX_PROFILES)throw new Error(`Maximal ${MAX_PROFILES} gespeicherte Szenen. Lösche zuerst eine eigene Szene.`);
 const safe=profiles.map(profile=>validProfile(profile));
 if(new Set(safe.map(profile=>profile.id)).size!==safe.length)throw new Error('Die Szenenbibliothek enthält doppelte Kennungen.');
 if(new TextEncoder().encode(JSON.stringify(profileDocument(safe))).length>MAX_PROFILE_IMPORT_BYTES)throw new Error('Die Szenenbibliothek ist zu groß (maximal 128 KB). Exportiere oder lösche zuerst Szenen.');
 return safe;
}

export function saveScene(profiles,scene) {
 const safe=validProfile(scene),index=profiles.findIndex(profile=>profile.id===safe.id);
 const next=[...profiles];if(index<0)next.push(safe);else next[index]=safe;
 return validateSceneCollection(next);
}

export function availableSceneTargets(scene,devices) {
 if(scene.targetDevices===undefined)return null;
 const available=new Set(devices.map(device=>device.id));
 return {available:scene.targetDevices.filter(id=>available.has(id)),missing:scene.targetDevices.filter(id=>!available.has(id))};
}
