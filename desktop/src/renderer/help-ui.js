(() => {
  'use strict';
  const content = window.BattoHelpContent;
  if (!content || typeof renderSettingsModule !== 'function') return;
  let query = '', expanded = false;
  const openTopics = new Set();
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const matches = (topic, value) => [topic.title,topic.summary,topic.limit,...topic.steps].join(' ').toLocaleLowerCase('de-DE').includes(value.toLocaleLowerCase('de-DE').trim());
  function attach() {
    const host = document.getElementById('settingsModule');
    if (!host || host.querySelector('#battoHelp')) return;
    const section = document.createElement('section');
    section.className = 'panel-section batto-help'; section.id = 'battoHelp';
    section.innerHTML = `<h3>Hilfe</h3><p>${escape(content.intro)}</p><button id="battoHelpToggle" type="button" aria-controls="battoHelpGuide" aria-expanded="${expanded}">${expanded?'Hilfe schließen':'Hilfe A bis Z öffnen'}</button><div id="battoHelpGuide" ${expanded?'':'hidden'}><label for="battoHelpSearch">Hilfe durchsuchen</label><input id="battoHelpSearch" type="search" placeholder="Zum Beispiel RGB, Strimer, iCUE oder Chat" value="${escape(query)}"><p id="battoHelpCount" role="status" aria-live="polite"></p><div class="batto-help-letters" aria-label="Hilfethemen A bis Z">${content.topics.map(t=>`<button type="button" data-help-letter="${t.id}" aria-label="${escape(t.title)}">${t.id.toUpperCase()}</button>`).join('')}</div><div id="battoHelpTopics">${content.topics.map(t=>`<details data-help-topic="${t.id}" ${openTopics.has(t.id)?'open':''}><summary>${escape(t.title)}</summary><p>${escape(t.summary)}</p><ol>${t.steps.map(s=>`<li>${escape(s)}</li>`).join('')}</ol><p class="batto-help-limit"><strong>Voraussetzung / Grenze:</strong> ${escape(t.limit)}</p><button type="button" data-help-view="${t.view}">${escape(t.label)} öffnen</button></details>`).join('')}</div></div>`;
    host.prepend(section);
    const guide = section.querySelector('#battoHelpGuide');
    const toggle = section.querySelector('#battoHelpToggle');
    toggle.onclick = () => {expanded=!expanded;guide.hidden=!expanded;toggle.setAttribute('aria-expanded',String(expanded));toggle.textContent=expanded?'Hilfe schließen':'Hilfe A bis Z öffnen';if(expanded)section.querySelector('#battoHelpSearch').focus();};
    function filter() {
      let count=0;
      for (const t of content.topics) {const el=section.querySelector(`[data-help-topic="${t.id}"]`);el.hidden=!matches(t,query);if(!el.hidden)count++;}
      section.querySelector('#battoHelpCount').textContent=count?`${count} von ${content.topics.length} Themen. Zum Lesen ein Thema öffnen.`:'Keine passenden Themen. Versuche einen anderen Suchbegriff.';
    }
    section.querySelector('#battoHelpSearch').oninput=e=>{query=e.target.value;filter();};
    section.querySelectorAll('[data-help-topic]').forEach(el=>el.addEventListener('toggle',()=>{if(!el.isConnected)return;if(el.open)openTopics.add(el.dataset.helpTopic);else openTopics.delete(el.dataset.helpTopic);}));
    section.querySelectorAll('[data-help-letter]').forEach(button=>button.onclick=()=>{query='';section.querySelector('#battoHelpSearch').value='';filter();const topic=section.querySelector(`[data-help-topic="${button.dataset.helpLetter}"]`);topic.open=true;openTopics.add(button.dataset.helpLetter);topic.scrollIntoView({block:'nearest'});topic.querySelector('summary').focus();});
    section.querySelectorAll('[data-help-view]').forEach(button=>button.onclick=()=>setView(button.dataset.helpView));
    filter();
  }
  const previous=renderSettingsModule;
  renderSettingsModule=function(...args){const result=previous.apply(this,args);attach();return result;};
  document.addEventListener('batto:view',e=>{if(e.detail==='settings')attach();});
})();
