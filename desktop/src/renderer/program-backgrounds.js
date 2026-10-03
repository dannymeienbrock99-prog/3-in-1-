(()=>{'use strict';
// Static packaged artwork only. No network requests, animation, preloading or timers.
const items=Object.freeze([
 {id:'original',name:'Original – Marmor',file:'../assets/marble.jpg'},
 {id:'gaming-room',name:'Gaming-Zimmer',file:'../assets/backgrounds/gaming-zimmer.png'},
 {id:'tiktok-banner',name:'TikTok-Banner',file:'../assets/backgrounds/tiktok-banner.png'},
 {id:'studio-clean',name:'Studio ohne Schrift',file:'../assets/backgrounds/studio-ohne-schrift.png'}
]);
function selected(appearance={}){return items.find(item=>item.id===appearance.programBackgroundId)||items[1];}
function apply(appearance={},view=''){
 const start=view==='start',item=start?items[0]:selected(appearance),root=document.documentElement,bg=document.querySelector('.bg-watermark');
 const artwork=!start&&appearance.programBackground!==false&&item.id!=='original';
 const url=`url("${item.file}")`;if(root.style.getPropertyValue('--program-background')!==url)root.style.setProperty('--program-background',url);
 document.body.classList.toggle('program-artwork',artwork);
 if(bg)bg.style.display=appearance.programBackground===false?'none':'block';
 root.style.setProperty('--background-darkness',String(Math.max(0,Math.min(.8,Number(appearance.backgroundDarkness??.28)))));
 document.body.dataset.programBackground=start?'original':item.id;
}
window.BattoProgramBackground=Object.freeze({items,selected,apply});
})();
