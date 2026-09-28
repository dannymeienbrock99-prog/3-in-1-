"use strict";
(() => {
  const STORAGE_KEY="batto-obs-tool-twitch-holo-config-v1";
  const allowed=new Set(["Inter","Segoe UI","Arial","Verdana","Tahoma","Trebuchet MS","Georgia","Times New Roman","Impact","Courier New"]);
  function apply(){let cfg={};try{cfg=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}catch{}const font=allowed.has(cfg.fontFamily)?cfg.fontFamily:"Inter";document.documentElement.style.fontFamily=`${font}, \"Segoe UI\", Arial, sans-serif`;}
  window.addEventListener("storage",e=>{if(e.key===STORAGE_KEY)apply();});
  const observer=new MutationObserver(apply);observer.observe(document.documentElement,{subtree:true,childList:true});apply();
})();