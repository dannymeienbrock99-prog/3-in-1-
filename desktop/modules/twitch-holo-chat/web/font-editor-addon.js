"use strict";
(() => {
  const STORAGE_KEY="batto-obs-tool-twitch-holo-config-v1";
  const fonts=["Inter","Segoe UI","Arial","Verdana","Tahoma","Trebuchet MS","Georgia","Times New Roman","Impact","Courier New"];
  const controls=document.querySelector(".editor-controls");
  const colorSection=[...document.querySelectorAll(".control-section")].find(s=>s.querySelector("h2")?.textContent.includes("Hologramm-Farben"));
  if(!controls||!colorSection||document.getElementById("holo-font-family"))return;
  const section=document.createElement("section");section.className="control-section";section.innerHTML=`<h2>Schriftart</h2><label>Chat-Schrift<select id="holo-font-family">${fonts.map(f=>`<option value="${f}">${f}</option>`).join("")}</select></label><small>Gilt für Twitch-Name und Chatnachricht im Hologramm-Overlay.</small>`;colorSection.before(section);
  const select=section.querySelector("select");
  function read(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}catch{return{}}}
  function apply(){const cfg=read();select.value=fonts.includes(cfg.fontFamily)?cfg.fontFamily:"Inter";try{const frame=document.getElementById("preview-frame");if(frame?.contentDocument)frame.contentDocument.documentElement.style.fontFamily=`${select.value}, \"Segoe UI\", Arial, sans-serif`;}catch{}}
  select.onchange=()=>{const cfg=read();cfg.fontFamily=select.value;localStorage.setItem(STORAGE_KEY,JSON.stringify(cfg));apply();};
  document.getElementById("preview-frame")?.addEventListener("load",()=>setTimeout(apply,50));apply();
})();